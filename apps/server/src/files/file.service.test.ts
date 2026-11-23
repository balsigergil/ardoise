// SPDX-License-Identifier: AGPL-3.0-only
import { Readable } from 'node:stream';
import { limitsSchema } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { createHarness, silentLogger } from '../testing/harness.js';
import { FileService } from './file.service.js';
import { MemoryObjectStorage } from './object-storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const viewer = await h.createUser();
  const outsider = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, viewer, 'member');
  await h.addMember(ws.id, outsider, 'member');
  const page = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Doc');
  await h.mutate(owner, ws.id, 'permission.grant', {
    pageId: page,
    principal: { kind: 'user', id: viewer.id },
    level: 'can_view',
  });
  const upload = (user = owner, body: Buffer = PNG, name = 'pic.png', mime = 'image/png') =>
    h.files.upload(user, ws.id, page, { name, declaredMime: mime, body: Readable.from([body]) });
  return { h, owner, viewer, outsider, ws, ts, page, upload };
}

async function read(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('FileService uploads', () => {
  it('streams to storage, records the file and queues a thumbnail for images', async () => {
    const { h, ws, page, upload } = await setup();
    const dto = await upload();
    expect(dto).toMatchObject({
      name: 'pic.png',
      mime: 'image/png',
      size: PNG.length,
      isImage: true,
    });
    const row = await h.store.files.findById(ws.id, dto.id);
    expect(row).toMatchObject({
      pageId: page,
      s3Key: `ws/${ws.id}/files/${dto.id}`,
      status: 'ready',
    });
    expect(h.objects.objects.get(row!.s3Key)?.body.equals(PNG)).toBe(true);
    expect(h.jobs.jobs.at(-1)).toMatchObject({
      name: 'file.thumbnail',
      data: { workspaceId: ws.id, fileId: dto.id },
    });
  });

  it('trusts the bytes, not the declared type', async () => {
    const { upload } = await setup();
    const fake = await upload(
      undefined,
      Buffer.from('<svg onload=alert(1)>'),
      'x.png',
      'image/png',
    );
    expect(fake.mime).toBe('application/octet-stream');
    expect(fake.isImage).toBe(false);
    const doc = await upload(undefined, Buffer.from('hello'), 'notes.txt', 'text/plain');
    expect(doc.mime).toBe('text/plain');
  });

  it('enforces the size limit and removes the partial object', async () => {
    const { h, owner, ws, page } = await setup();
    const files = new FileService(
      h.store,
      h.permissions,
      h.objects,
      () => Promise.resolve(limitsSchema.parse({ maxUploadSizeMb: 1 })),
      h.jobs,
      h.clock,
      silentLogger,
      { presign: false },
    );
    const big = Readable.from([Buffer.alloc(700_000), Buffer.alloc(700_000)]);
    await expect(
      files.upload(owner, ws.id, page, { name: 'big.bin', declaredMime: undefined, body: big }),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    expect(h.objects.objects.size).toBe(0);
    expect(h.store.content.files.size).toBe(0);
  });

  it('requires Can edit, and refuses locked or trashed pages', async () => {
    const { h, owner, viewer, outsider, ws, page, upload } = await setup();
    await expect(upload(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(upload(outsider)).rejects.toMatchObject({ code: 'not_found' });
    await h.mutate(owner, ws.id, 'page.update', { id: page, isLocked: true });
    await expect(upload()).rejects.toMatchObject({ code: 'page_locked' });
    await h.mutate(owner, ws.id, 'page.update', { id: page, isLocked: false });
    await h.mutate(owner, ws.id, 'page.trash', { id: page });
    await expect(upload()).rejects.toMatchObject({ code: 'page_in_trash' });
  });
});

describe('FileService downloads', () => {
  it('streams to viewers with safe headers and supports ranges', async () => {
    const { h, viewer, ws, upload } = await setup();
    const { id } = await upload();
    const full = await h.files.download(viewer, ws.id, id, {});
    if (full.kind !== 'stream') throw new Error('expected a stream');
    expect(full.status).toBe(200);
    expect(full.headers).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="pic.png"; filename*=UTF-8''pic.png`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    expect((await read(full.body)).equals(PNG)).toBe(true);
    const part = await h.files.download(viewer, ws.id, id, { range: 'bytes=2-5' });
    if (part.kind !== 'stream') throw new Error('expected a stream');
    expect(part.status).toBe(206);
    expect(part.headers['Content-Range']).toBe(`bytes 2-5/${PNG.length}`);
    expect((await read(part.body)).equals(PNG.subarray(2, 6))).toBe(true);
  });

  it('serves other types as attachments', async () => {
    const { h, owner, ws, upload } = await setup();
    const { id } = await upload(undefined, Buffer.from('<html>'), 'page.html', 'text/html');
    const result = await h.files.download(owner, ws.id, id, {});
    if (result.kind !== 'stream') throw new Error('expected a stream');
    expect(result.headers['Content-Type']).toBe('application/octet-stream');
    expect(result.headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it('hides files from users who cannot view the page', async () => {
    const { h, outsider, ws, upload } = await setup();
    const { id } = await upload();
    await expect(h.files.download(outsider, ws.id, id, {})).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('redirects to a presigned URL when S3_PUBLIC_URL is set', async () => {
    const { h, owner, ws, upload } = await setup();
    const { id } = await upload();
    const presigning = new FileService(
      h.store,
      h.permissions,
      h.objects,
      () => h.settings.limits(),
      h.jobs,
      h.clock,
      silentLogger,
      { presign: true },
    );
    const result = await presigning.download(owner, ws.id, id, {});
    expect(result).toEqual({
      kind: 'redirect',
      url: `https://s3.test/ws/${ws.id}/files/${id}?expires=300`,
    });
  });

  it('serves public-link downloads only for covered pages', async () => {
    const { h, ws, upload } = await setup();
    const { id } = await upload();
    await expect(
      h.files.downloadPublic(() => Promise.resolve(false), ws.id, id, {}),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    const ok = await h.files.downloadPublic(() => Promise.resolve(true), ws.id, id, {});
    expect(ok.kind).toBe('stream');
  });
});

describe('file jobs', () => {
  it('stores a thumbnail and serves it with ?thumb', async () => {
    const { h, owner, ws, upload } = await setup();
    const { id } = await upload();
    await h.processors.run('file.thumbnail', { workspaceId: ws.id, fileId: id });
    const row = (await h.store.files.findById(ws.id, id))!;
    expect(row.thumbnailKey).toBe(`${row.s3Key}.thumb.webp`);
    const result = await h.files.download(owner, ws.id, id, { thumb: true });
    if (result.kind !== 'stream') throw new Error('expected a stream');
    expect(result.headers['Content-Type']).toBe('image/webp');
  });

  it('marks files deleted on purge and removes objects a day later', async () => {
    const { h, owner, ws, page, upload } = await setup();
    const { id } = await upload();
    await h.processors.run('file.thumbnail', { workspaceId: ws.id, fileId: id });
    await h.mutate(owner, ws.id, 'page.trash', { id: page });
    await h.mutate(owner, ws.id, 'page.purge', { id: page });
    expect((await h.store.files.findById(ws.id, id))?.deletedAt).not.toBeNull();
    await expect(h.files.download(owner, ws.id, id, {})).rejects.toMatchObject({
      code: 'not_found',
    });
    await h.processors.run('files.purgeDeleted', {});
    expect(h.objects.objects.size).toBe(2); // within the grace period
    h.clock.advance(25 * 60 * 60 * 1000);
    await h.processors.run('files.purgeDeleted', {});
    expect(h.objects.objects.size).toBe(0);
    expect(await h.store.files.findById(ws.id, id)).toBeUndefined();
  });

  it('skips thumbnails for corrupt images', async () => {
    const { h, owner, ws, page } = await setup();
    const failing = new FileService(
      h.store,
      h.permissions,
      new MemoryObjectStorage(),
      () => h.settings.limits(),
      h.jobs,
      h.clock,
      silentLogger,
      { presign: false, thumbnailer: () => Promise.reject(new Error('bad image')) },
    );
    const dto = await failing.upload(owner, ws.id, page, {
      name: 'a.png',
      declaredMime: 'image/png',
      body: Readable.from([PNG]),
    });
    await expect(
      failing.thumbnail({ workspaceId: ws.id, fileId: dto.id }),
    ).resolves.toBeUndefined();
  });
});
