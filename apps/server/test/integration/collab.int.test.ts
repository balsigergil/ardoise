// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M3 integration: Hocuspocus authorization, read-only enforcement and persistence
 * across two collab nodes sharing Valkey (ROADMAP M3), and server-written child page
 * blocks (ADR 0011).
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  collabDocumentName,
  COLLAB_PATH,
  newId,
  positionBetween,
  type CreatedInvitationDto,
  type WorkspaceDto,
} from '@ardoise/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../../src/bootstrap.js';
import { startStack, type TestStack } from '../containers.js';
import { TestClient } from '../http-client.js';

const PUBLIC_URL = 'http://localhost:3000';
const ADMIN = { email: 'admin@example.test', password: 'admin password 1234' };

let stack: TestStack;
let nodeA: NestExpressApplication;
let nodeB: NestExpressApplication;
let urlA: string;
let urlB: string;
let workspaceId: string;
let teamspaceId: string;
let admin: TestClient;
let bob: TestClient;
let bobId: string;

async function listen(app: NestExpressApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

async function login(base: string, email: string, password: string): Promise<TestClient> {
  const c = new TestClient(base, PUBLIC_URL);
  const res = await c.post('/api/auth/login', { email, password });
  expect(res.status).toBe(200);
  return c;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const providers: (() => void)[] = [];
afterEach(() => {
  while (providers.length) providers.pop()!();
});

function connect(base: string, client: TestClient, name: string) {
  const headers = { cookie: client.cookieHeader, origin: PUBLIC_URL };
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
  const events = { denied: [] as string[], closed: [] as string[] };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document,
    token: 'cookie',
    onAuthenticationFailed: ({ reason }) => events.denied.push(reason),
    onClose: ({ event }) => events.closed.push(String(event.reason)),
  });
  provider.attach();
  providers.push(() => {
    provider.destroy();
    socket.destroy();
  });
  return { provider, document, events };
}

const text = (doc: Y.Doc) => JSON.stringify(doc.getXmlFragment('content').toJSON());

function write(doc: Y.Doc, value: string) {
  const fragment = doc.getXmlFragment('content');
  const paragraph = new Y.XmlElement('paragraph');
  const blockText = new Y.XmlElement('blockText');
  blockText.insert(0, [new Y.XmlText(value)]);
  paragraph.insert(0, [blockText]);
  fragment.insert(fragment.length, [paragraph]);
}

async function createPage(title: string): Promise<string> {
  const id = newId();
  const result = await admin.mutate(workspaceId, 'page.create', {
    id,
    parent: { kind: 'teamspace', id: teamspaceId },
    position: positionBetween(null, null),
    title,
  });
  expect(result.status).toBe('applied');
  return id;
}

beforeAll(async () => {
  stack = await startStack();
  nodeA = await createApp(
    stack.config({ ARDOISE_ADMIN_EMAIL: ADMIN.email, ARDOISE_ADMIN_PASSWORD: ADMIN.password }),
    { webDist: '/nonexistent' },
  );
  urlA = await listen(nodeA);
  nodeB = await createApp(
    stack.config({ ARDOISE_ROLE: 'collab', ARDOISE_MIGRATE_ON_BOOT: 'false' }),
    { webDist: '/nonexistent' },
  );
  urlB = await listen(nodeB);

  admin = await login(urlA, ADMIN.email, ADMIN.password);
  workspaceId = (await admin.post<WorkspaceDto>('/api/workspaces', { name: 'Collab' })).body.id;
  const roots = await admin.get<{ items: { id: string }[] }>(
    `/api/workspaces/${workspaceId}/teamspaces`,
  );
  teamspaceId = roots.body.items[0]!.id;
  const invite = await admin.post<CreatedInvitationDto>(
    `/api/workspaces/${workspaceId}/invitations`,
    { email: 'bob@example.test', role: 'guest' },
  );
  const accept = await new TestClient(urlA, PUBLIC_URL).post('/api/invitations/accept', {
    token: invite.body.link.split('#token=')[1],
    name: 'Bob',
    password: 'bob password 12345',
  });
  expect(accept.status).toBe(200);
  bob = await login(urlA, 'bob@example.test', 'bob password 12345');
  bobId = (await bob.get<{ user: { id: string } }>('/api/auth/session')).body.user.id;
}, 180_000);

afterAll(async () => {
  await nodeB?.close();
  await nodeA?.close();
  await stack?.stop();
});

describe('collaboration across two collab nodes', () => {
  it('relays edits between nodes and persists them to Postgres', async () => {
    const pageId = await createPage('Shared doc');
    const name = collabDocumentName(workspaceId, pageId);
    const a = connect(urlA, admin, name);
    const b = connect(urlB, admin, name);
    await until(() => a.provider.isSynced && b.provider.isSynced);
    write(a.document, 'from node A');
    await until(() => text(b.document).includes('from node A'));
    write(b.document, 'from node B');
    await until(() => text(a.document).includes('from node B'));

    const client = new pg.Client({ connectionString: stack.env.DATABASE_URL });
    await client.connect();
    try {
      await until(async () => {
        const { rows } = await client.query<{ state: Buffer }>(
          'SELECT state FROM page_documents WHERE workspace_id = $1 AND doc_name = $2',
          [workspaceId, `page:${pageId}`],
        );
        if (!rows[0]) return false;
        const stored = new Y.Doc();
        Y.applyUpdate(stored, new Uint8Array(rows[0].state));
        return text(stored).includes('from node A') && text(stored).includes('from node B');
      });
    } finally {
      await client.end();
    }

    // A fresh client after everyone left loads the stored state.
    providers.splice(0).forEach((destroy) => destroy());
    await new Promise((r) => setTimeout(r, 500));
    const c = connect(urlB, admin, name);
    await until(() => c.provider.isSynced && text(c.document).includes('from node B'));
  });

  it('enforces read-only connections and closes them when access is revoked on another node', async () => {
    const pageId = await createPage('Guarded');
    const name = collabDocumentName(workspaceId, pageId);
    const grant = await admin.mutate(workspaceId, 'permission.grant', {
      pageId,
      principal: { kind: 'user', id: bobId },
      level: 'can_view',
    });
    expect(grant.status).toBe('applied');
    const editor = connect(urlA, admin, name);
    const reader = connect(urlB, bob, name);
    await until(() => editor.provider.isSynced && reader.provider.isSynced);
    expect(reader.provider.authorizedScope).toBe('readonly');
    write(reader.document, 'ignored');
    write(editor.document, 'visible');
    await until(() => text(reader.document).includes('visible'));
    await new Promise((r) => setTimeout(r, 300));
    expect(text(editor.document)).not.toContain('ignored');

    const revoke = await admin.mutate(workspaceId, 'permission.revoke', {
      pageId,
      principal: { kind: 'user', id: bobId },
    });
    expect(revoke.status).toBe('applied');
    await until(
      () =>
        reader.events.closed.includes('not_found') || reader.events.denied.includes('not_found'),
    );
  });

  it('adds the child page block of a subpage created outside the editor (ADR 0011)', async () => {
    const parent = await createPage('Parent');
    // The editor is on node B; the job runs on node A (role=all) and reaches B over Valkey.
    const editor = connect(urlB, admin, collabDocumentName(workspaceId, parent));
    await until(() => editor.provider.isSynced);
    write(editor.document, 'intro');
    const child = newId();
    const result = await admin.mutate(workspaceId, 'page.create', {
      id: child,
      parent: { kind: 'page', id: parent },
      position: positionBetween(null, null),
      title: 'From the sidebar',
    });
    expect(result.status).toBe('applied');
    await until(() => text(editor.document).includes(child));
    expect(text(editor.document).indexOf('intro')).toBeLessThan(
      text(editor.document).indexOf(child),
    );
    expect(text(editor.document).split(child)).toHaveLength(2);
  });

  it('rejects the reserved plugin: prefix', async () => {
    const pageId = await createPage('Plugin host');
    const plugin = connect(urlB, admin, `${workspaceId}/plugin:${pageId}`);
    await until(() => plugin.events.denied.length > 0);
    expect(plugin.events.denied).toEqual(['unsupported_document']);
  });

  it('refuses the upgrade without a session', async () => {
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${urlB.replace('http', 'ws')}${COLLAB_PATH}`, {
        headers: { origin: PUBLIC_URL },
      });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
    });
    expect(status).toBe(401);
  });
});
