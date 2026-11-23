// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `files` module (ARCHITECTURE §4.7, ADR 0004/0009): uploads streamed to S3 with the
 * admin size limit, downloads after a permission check (streamed with ranges, or a
 * presigned redirect when `S3_PUBLIC_URL` is set), thumbnails and purge jobs.
 */
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DomainError, newId, type FileDto, type Limits } from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import type { Clock } from '../common/clock.js';
import type { JobPayloads, JobQueue } from '../jobs/jobs.js';
import type { PermissionService } from '../permissions/permission.service.js';
import type { FileRecord } from '../store/content-store.js';
import type { PageRecord } from '../store/sync-store.js';
import type { Store, UserRecord } from '../store/store.js';
import type { ObjectStorage } from './object-storage.js';
import {
  cleanFileName,
  cleanMime,
  contentDisposition,
  IMAGE_MIMES,
  isInlineMime,
  sniffMime,
  SNIFF_BYTES,
} from './sniff.js';

/** Longest side of a thumbnail, in pixels. */
export const THUMBNAIL_SIZE = 800;
/** Images larger than this are not thumbnailed (decoding cost). */
const THUMBNAIL_SOURCE_MAX = 40 * 1024 * 1024;
/** Deleted files are kept this long before their objects are removed. */
const PURGE_DELAY_MS = 24 * 60 * 60 * 1000;
const PRESIGN_SECONDS = 300;

/** Resizes an image to WebP (sharp in production). */
export type Thumbnailer = (input: Uint8Array, size: number) => Promise<Uint8Array>;

export interface UploadInput {
  name: string | undefined;
  declaredMime: string | undefined;
  body: Readable;
}

export type DownloadResult =
  | { kind: 'redirect'; url: string }
  | {
      kind: 'stream';
      status: 200 | 206;
      body: Readable;
      headers: Record<string, string>;
    };

/** Counts bytes, keeps the first ones for sniffing, fails past the limit. */
class Meter extends Transform {
  size = 0;
  head = new Uint8Array(0);
  constructor(private readonly max: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.max) {
      done(new DomainError('file_too_large'));
      return;
    }
    if (this.head.length < SNIFF_BYTES) {
      this.head = new Uint8Array(Buffer.concat([this.head, chunk]).subarray(0, SNIFF_BYTES));
    }
    done(null, chunk);
  }
}

export const toFileDto = (f: FileRecord): FileDto => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
  isImage: IMAGE_MIMES.has(f.mime),
});

export class FileService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly storage: ObjectStorage,
    private readonly limits: () => Promise<Limits>,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
    private readonly options: { presign: boolean; thumbnailer?: Thumbnailer },
  ) {}

  private async requirePage(
    actor: UserRecord,
    workspaceId: string,
    pageId: string,
    level: 'can_view' | 'can_edit',
  ): Promise<PageRecord> {
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');
    const page = await this.store.pages.findById(workspaceId, pageId);
    if (!page) throw new DomainError('not_found');
    const subject = await this.permissions.subject(workspaceId, actor.id, member.role);
    await this.permissions.require(workspaceId, subject, page, level);
    return page;
  }

  /** Checks the upload is allowed before the body is read (no wasted transfer). */
  async authorizeUpload(actor: UserRecord, workspaceId: string, pageId: string): Promise<void> {
    const page = await this.requirePage(actor, workspaceId, pageId, 'can_edit');
    if (page.deletedAt) throw new DomainError('page_in_trash');
    if (page.isLocked) throw new DomainError('page_locked');
  }

  async upload(
    actor: UserRecord,
    workspaceId: string,
    pageId: string,
    input: UploadInput,
  ): Promise<FileDto> {
    await this.authorizeUpload(actor, workspaceId, pageId);
    const { maxUploadSizeMb } = await this.limits();
    const id = newId();
    const key = `ws/${workspaceId}/files/${id}`;
    const meter = new Meter(maxUploadSizeMb * 1024 * 1024);
    const passthrough = new Transform({ transform: (chunk, _e, done) => done(null, chunk) });
    const upload = this.storage
      .upload(key, passthrough, 'application/octet-stream')
      .catch((error: unknown) => {
        // Unblocks the pipeline when the store fails.
        passthrough.destroy(error as Error);
        throw error;
      });
    try {
      await Promise.all([pipeline(input.body, meter, passthrough), upload]);
    } catch (error) {
      input.body.resume();
      // The object may be partly written: remove it.
      await this.storage.delete([key]).catch(() => undefined);
      throw error;
    }
    const mime = sniffMime(meter.head) ?? cleanMime(input.declaredMime);
    const file: FileRecord = {
      workspaceId,
      id,
      pageId,
      s3Key: key,
      name: cleanFileName(input.name),
      // An image MIME is only trusted when the bytes say so.
      mime: IMAGE_MIMES.has(mime) && !sniffMime(meter.head) ? 'application/octet-stream' : mime,
      size: meter.size,
      status: 'ready',
      thumbnailKey: null,
      uploadedBy: actor.id,
      createdAt: this.clock.now(),
      deletedAt: null,
    };
    await this.store.files.insert(file);
    if (IMAGE_MIMES.has(file.mime) && file.size <= THUMBNAIL_SOURCE_MAX) {
      await this.jobs
        .enqueue('file.thumbnail', { workspaceId, fileId: id })
        .catch((error: unknown) => this.logger.error({ err: error }, 'thumbnail enqueue failed'));
    }
    return toFileDto(file);
  }

  /** The file if `page` may serve it (the file belongs to the page). */
  private async live(workspaceId: string, fileId: string): Promise<FileRecord> {
    const file = await this.store.files.findById(workspaceId, fileId);
    if (!file || file.deletedAt) throw new DomainError('not_found');
    return file;
  }

  async metadata(actor: UserRecord, workspaceId: string, fileId: string): Promise<FileDto> {
    const file = await this.live(workspaceId, fileId);
    await this.requirePage(actor, workspaceId, file.pageId, 'can_view');
    return toFileDto(file);
  }

  /** Download for a signed-in user (Can view on the file's page). */
  async download(
    actor: UserRecord,
    workspaceId: string,
    fileId: string,
    options: { thumb?: boolean; range?: string },
  ): Promise<DownloadResult> {
    const file = await this.live(workspaceId, fileId);
    await this.requirePage(actor, workspaceId, file.pageId, 'can_view');
    return this.serve(file, options);
  }

  /** Download through a public link: `covers` checks the link covers the file's page. */
  async downloadPublic(
    covers: (workspaceId: string, pageId: string) => Promise<boolean>,
    workspaceId: string,
    fileId: string,
    options: { thumb?: boolean; range?: string },
  ): Promise<DownloadResult> {
    const file = await this.live(workspaceId, fileId);
    if (!(await covers(workspaceId, file.pageId))) throw new DomainError('not_found');
    return this.serve(file, options);
  }

  private async serve(
    file: FileRecord,
    { thumb, range }: { thumb?: boolean; range?: string },
  ): Promise<DownloadResult> {
    const useThumb = thumb && file.thumbnailKey;
    const key = useThumb ? file.thumbnailKey! : file.s3Key;
    const mime = useThumb ? 'image/webp' : file.mime;
    const inline = isInlineMime(mime);
    const disposition = contentDisposition(inline ? 'inline' : 'attachment', file.name);
    const servedMime = inline ? mime : 'application/octet-stream';
    if (this.options.presign) {
      const url = await this.storage.presign(key, {
        disposition,
        contentType: servedMime,
        expiresIn: PRESIGN_SECONDS,
      });
      return { kind: 'redirect', url };
    }
    const validRange = range && /^bytes=\d*-\d*$/.test(range) ? range : undefined;
    const object = await this.storage.get(key, validRange);
    if (!object) throw new DomainError('not_found');
    return {
      kind: 'stream',
      status: object.status,
      body: object.body,
      headers: {
        'Content-Type': servedMime,
        'Content-Length': String(object.contentLength),
        'Content-Disposition': disposition,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        // A file never runs as a page of the origin.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        ...(object.contentRange && { 'Content-Range': object.contentRange }),
      },
    };
  }

  /** The `file.thumbnail` job. */
  async thumbnail({ workspaceId, fileId }: JobPayloads['file.thumbnail']): Promise<void> {
    const thumbnailer = this.options.thumbnailer;
    if (!thumbnailer) return;
    const file = await this.store.files.findById(workspaceId, fileId);
    if (!file || file.deletedAt || !IMAGE_MIMES.has(file.mime)) return;
    const source = await this.storage.read(file.s3Key);
    if (!source) return;
    let output: Uint8Array;
    try {
      output = await thumbnailer(source, THUMBNAIL_SIZE);
    } catch (error) {
      // A corrupt image keeps no thumbnail; the original is still served.
      this.logger.warn({ err: error, workspaceId, fileId }, 'thumbnail failed');
      return;
    }
    const key = `${file.s3Key}.thumb.webp`;
    await this.storage.put(key, output, 'image/webp');
    await this.store.files.update(workspaceId, fileId, { thumbnailKey: key });
  }

  /** The daily `files.purgeDeleted` job: objects first, then rows. */
  async purgeDeleted(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - PURGE_DELAY_MS);
    let purged = 0;
    for (;;) {
      const batch = await this.store.files.listDeleted(before, 500);
      if (batch.length === 0) return purged;
      const keys = batch.flatMap((f) => (f.thumbnailKey ? [f.s3Key, f.thumbnailKey] : [f.s3Key]));
      await this.storage.delete(keys);
      const byWorkspace = new Map<string, string[]>();
      for (const f of batch)
        byWorkspace.set(f.workspaceId, [...(byWorkspace.get(f.workspaceId) ?? []), f.id]);
      for (const [ws, ids] of byWorkspace) await this.store.files.deleteRows(ws, ids);
      purged += batch.length;
    }
  }
}

/** sharp-based thumbnails: fit inside `size`×`size`, WebP. */
export async function sharpThumbnailer(input: Uint8Array, size: number): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const out = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return new Uint8Array(out);
}
