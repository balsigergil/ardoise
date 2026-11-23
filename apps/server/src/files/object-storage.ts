// SPDX-License-Identifier: AGPL-3.0-only
/** Object storage port (S3 API) and an in-memory fake for unit tests. */
import { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObject {
  body: Readable;
  /** 200, or 206 for a range. */
  status: 200 | 206;
  contentLength: number;
  contentRange?: string;
}

export interface ObjectStorage {
  /** Streams `body` to `key` (multipart for large bodies). */
  upload(key: string, body: Readable, contentType: string): Promise<void>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Reads an object, or a byte range (`bytes=0-99`). Undefined when it does not exist. */
  get(key: string, range?: string): Promise<StoredObject | undefined>;
  read(key: string): Promise<Uint8Array | undefined>;
  /** A short-lived URL on the browser-reachable endpoint (ADR 0004). */
  presign(
    key: string,
    options: { disposition: string; contentType: string; expiresIn: number },
  ): Promise<string>;
  delete(keys: readonly string[]): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    /** Client for presigned URLs, built on `S3_PUBLIC_URL`. */
    private readonly publicClient?: S3Client,
  ) {}

  async upload(key: string, body: Readable, contentType: string): Promise<void> {
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    }).done();
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string, range?: string): Promise<StoredObject | undefined> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range && { Range: range }) }),
      );
      return {
        body: out.Body as Readable,
        status: out.ContentRange ? 206 : 200,
        contentLength: out.ContentLength ?? 0,
        ...(out.ContentRange && { contentRange: out.ContentRange }),
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array | undefined> {
    const object = await this.get(key);
    if (!object) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(chunk as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
  }

  presign(
    key: string,
    options: { disposition: string; contentType: string; expiresIn: number },
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient ?? this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.disposition,
        ResponseContentType: options.contentType,
      }),
      { expiresIn: options.expiresIn },
    );
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }
}

/** In-memory storage (unit tests). */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async upload(key: string, body: Readable, contentType: string): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
  }

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string, range?: string): Promise<StoredObject | undefined> {
    const object = this.objects.get(key);
    if (!object) return Promise.resolve(undefined);
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (!match) {
      return Promise.resolve({
        body: Readable.from([object.body]),
        status: 200,
        contentLength: object.body.length,
      });
    }
    const start = Number(match[1]);
    const end = match[2]
      ? Math.min(Number(match[2]), object.body.length - 1)
      : object.body.length - 1;
    const slice = object.body.subarray(start, end + 1);
    return Promise.resolve({
      body: Readable.from([slice]),
      status: 206,
      contentLength: slice.length,
      contentRange: `bytes ${start}-${end}/${object.body.length}`,
    });
  }

  read(key: string): Promise<Uint8Array | undefined> {
    const object = this.objects.get(key);
    return Promise.resolve(object ? new Uint8Array(object.body) : undefined);
  }

  presign(key: string, options: { expiresIn: number }): Promise<string> {
    return Promise.resolve(`https://s3.test/${key}?expires=${options.expiresIn}`);
  }

  delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
    return Promise.resolve();
  }
}
