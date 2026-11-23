// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M3 integration: uploads to RustFS (limits, ranges, thumbnails), projection of a
 * document stored through Hocuspocus, Postgres search, backlinks, public content and
 * files, and the SSRF guard of link previews (ROADMAP M3).
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  collabDocumentName,
  COLLAB_PATH,
  newId,
  positionBetween,
  type BacklinksDto,
  type FileDto,
  type PublicContentDto,
  type QuickFindDto,
  type SearchResultsDto,
  type WorkspaceDto,
} from '@ardoise/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../../src/bootstrap.js';
import { startStack, type TestStack } from '../containers.js';
import { TestClient } from '../http-client.js';

const PUBLIC_URL = 'http://localhost:3000';
const ADMIN = { email: 'admin@example.test', password: 'admin password 1234' };

let stack: TestStack;
let app: NestExpressApplication;
let base: string;
let admin: TestClient;
let workspaceId: string;
let teamspaceId: string;

async function until<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function createPage(title: string, parent?: string): Promise<string> {
  const id = newId();
  const result = await admin.mutate(workspaceId, 'page.create', {
    id,
    parent: parent ? { kind: 'page', id: parent } : { kind: 'teamspace', id: teamspaceId },
    position: positionBetween(null, null),
    title,
  });
  expect(result.status).toBe('applied');
  return id;
}

async function upload(pageId: string, body: Uint8Array, name: string, type: string) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(body)], { type }), name);
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/pages/${pageId}/files`, {
    method: 'POST',
    headers: {
      cookie: admin.cookieHeader,
      origin: PUBLIC_URL,
      'x-csrf-token': admin.csrfToken ?? '',
    },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as FileDto & { error?: { code: string } } };
}

/** Writes paragraphs into a page through Hocuspocus, then disconnects. */
async function writeContent(pageId: string, blocks: Y.XmlElement[]): Promise<void> {
  const headers = { cookie: admin.cookieHeader, origin: PUBLIC_URL };
  class HeaderWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({
    url: `${base.replace('http', 'ws')}${COLLAB_PATH}`,
    WebSocketPolyfill: HeaderWebSocket,
  });
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: collabDocumentName(workspaceId, pageId),
    document,
    token: 'cookie',
  });
  provider.attach();
  await until(() => provider.isSynced);
  document.getXmlFragment('content').insert(0, blocks);
  await until(() => !provider.hasUnsyncedChanges);
  provider.destroy();
  socket.destroy();
}

function paragraph(...children: (string | Y.XmlElement)[]): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  p.setAttribute('blockId', newId());
  const text = new Y.XmlElement('blockText');
  text.insert(
    0,
    children.map((c) => (typeof c === 'string' ? new Y.XmlText(c) : c)),
  );
  p.insert(0, [text]);
  return p;
}

function pageMention(pageId: string): Y.XmlElement {
  const m = new Y.XmlElement('mention');
  m.setAttribute('kind', 'page');
  m.setAttribute('id', pageId);
  return m;
}

beforeAll(async () => {
  stack = await startStack();
  app = await createApp(
    stack.config({
      ARDOISE_ADMIN_EMAIL: ADMIN.email,
      ARDOISE_ADMIN_PASSWORD: ADMIN.password,
    }),
    { webDist: '/nonexistent' },
  );
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  admin = new TestClient(base, PUBLIC_URL);
  expect((await admin.post('/api/auth/login', ADMIN)).status).toBe(200);
  workspaceId = (await admin.post<WorkspaceDto>('/api/workspaces', { name: 'Content' })).body.id;
  teamspaceId = (
    await admin.get<{ items: { id: string }[] }>(`/api/workspaces/${workspaceId}/teamspaces`)
  ).body.items[0]!.id;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await stack?.stop();
});

describe('files', () => {
  it('uploads, downloads with ranges, and generates a thumbnail', async () => {
    const pageId = await createPage('With files');
    const png = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#3366ff' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(pageId, new Uint8Array(png), 'photo.png', 'image/png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ name: 'photo.png', mime: 'image/png', isImage: true });

    const url = `/files/${workspaceId}/${uploaded.body.id}`;
    const full = await admin.request('GET', url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('image/png');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    const part = await fetch(`${base}${url}`, {
      headers: { cookie: admin.cookieHeader, range: 'bytes=0-7' },
    });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array(png.subarray(0, 8)));

    const thumb = await until(async () => {
      const res = await fetch(`${base}${url}?thumb=1`, { headers: { cookie: admin.cookieHeader } });
      return res.headers.get('content-type') === 'image/webp' ? res : undefined;
    });
    const meta = await sharp(new Uint8Array(await thumb.arrayBuffer())).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(800);

    const anonymous = await fetch(`${base}${url}`);
    expect(anonymous.status).toBe(401);
  });

  it('enforces the upload size limit', async () => {
    const pageId = await createPage('Big file');
    await admin.request('PATCH', '/api/admin/settings', { limits: { maxUploadSizeMb: 1 } });
    try {
      const big = await upload(
        pageId,
        new Uint8Array(1_200_000),
        'big.bin',
        'application/octet-stream',
      );
      expect(big.status).toBe(413);
      expect(big.body.error?.code).toBe('file_too_large');
    } finally {
      await admin.request('PATCH', '/api/admin/settings', { limits: { maxUploadSizeMb: 100 } });
    }
  });
});

describe('projection, search and backlinks', () => {
  it('projects stored content into full-text search, backlinks and quick find', async () => {
    const target = await createPage('Cible');
    const source = await createPage('Réunion d’été');
    await writeContent(source, [paragraph('Le budget prévisionnel ', pageMention(target))]);

    const results = await until(async () => {
      const res = await admin.get<SearchResultsDto>(
        `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent('previsionnel')}`,
      );
      return res.body.items.length ? res.body : undefined;
    });
    expect(results.items[0]).toMatchObject({ id: source });
    expect(results.items[0]!.snippet).toContain('\u0002prévisionnel\u0003');

    const backlinks = await admin.get<BacklinksDto>(
      `/api/workspaces/${workspaceId}/pages/${target}/backlinks`,
    );
    expect(backlinks.body.items).toMatchObject([{ page: { id: source }, kinds: ['mention'] }]);

    const quick = await admin.get<QuickFindDto>(
      `/api/workspaces/${workspaceId}/search/quick?q=${encodeURIComponent('reunion ete')}`,
    );
    expect(quick.body.items.map((i) => i.id)).toContain(source);
    const short = await admin.get<QuickFindDto>(`/api/workspaces/${workspaceId}/search/quick?q=ci`);
    expect(short.body.items.map((i) => i.id)).toContain(target);
  });

  it('finds renamed titles at once and respects the title-only filter', async () => {
    const pageId = await createPage('Draft');
    await admin.mutate(workspaceId, 'page.update', { id: pageId, title: 'Quarterly roadmap' });
    const res = await admin.get<SearchResultsDto>(
      `/api/workspaces/${workspaceId}/search?q=roadmap&titleOnly=true`,
    );
    expect(res.body.items.map((i) => i.id)).toContain(pageId);
  });
});

describe('public pages and link previews', () => {
  it('serves the content and files of a shared page to its public link', async () => {
    const pageId = await createPage('Published');
    await writeContent(pageId, [paragraph('Hello public')]);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const file = await upload(pageId, new Uint8Array(png), 'dot.png', 'image/png');
    const link = await admin.mutate(workspaceId, 'publicLink.set', {
      pageId,
      enabled: true,
      includeSubpages: false,
    });
    expect(link.status).toBe('applied');
    const sharing = await admin.get<{ publicLink: { url: string } | null }>(
      `/api/workspaces/${workspaceId}/pages/${pageId}/sharing`,
    );
    const token = sharing.body.publicLink!.url.split('/share/')[1]!;
    const content = await until(async () => {
      const res = await fetch(`${base}/api/public/${token}/content`);
      const body = (await res.json()) as PublicContentDto;
      return JSON.stringify(body.doc).includes('Hello public') ? body : undefined;
    });
    expect(content.doc.type).toBe('doc');
    const served = await fetch(`${base}/api/public/${token}/files/${file.body.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('refuses previews of internal addresses', async () => {
    const res = await admin.post<{ error: { code: string } }>(
      `/api/workspaces/${workspaceId}/link-preview`,
      { url: `${base}/healthz` },
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('preview_unavailable');
  });
});
