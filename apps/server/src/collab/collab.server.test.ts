// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { docToJSON } from '@ardoise/editor';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { collabDocumentName, COLLAB_PATH, limitsSchema } from '@ardoise/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createHarness, PUBLIC_URL, silentLogger } from '../testing/harness.js';
import { CollabAccess } from './collab-access.js';
import { CollabPersistence } from './collab-persistence.js';
import { CollabServer } from './collab.server.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setup() {
  const h = createHarness();
  const owner = await h.createUser({ name: 'Olive' });
  const viewer = await h.createUser({ name: 'Vic' });
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, viewer, 'member');
  const page = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Doc');
  await h.mutate(owner, ws.id, 'permission.grant', {
    pageId: page,
    principal: { kind: 'user', id: viewer.id },
    level: 'can_view',
  });
  const collab = new CollabServer(
    new CollabAccess(h.store, h.permissions, (token) => h.auth.authenticate(token)),
    new CollabPersistence(
      h.store,
      () => Promise.resolve(limitsSchema.parse({})),
      h.jobs,
      h.clock,
      silentLogger,
    ),
    h.bus,
    { publicUrl: PUBLIC_URL, debounceMs: 20, maxDebounceMs: 50 },
    silentLogger,
  );
  const server: Server = createServer();
  collab.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${COLLAB_PATH}`;
  cleanups.push(
    () => collab.close(),
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const tokenOf = async (u: { email: string }) =>
    (await h.auth.login(u.email, 'correct horse battery', h.meta)).token;

  /** A browser-like client: cookie and Origin headers on the upgrade. */
  function connect(
    token: string | null,
    name = collabDocumentName(ws.id, page),
    origin = PUBLIC_URL,
  ) {
    const headers: Record<string, string> = { origin };
    if (token) headers['cookie'] = `ardoise_session=${token}`;
    class HeaderWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers });
      }
    }
    const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: HeaderWebSocket });
    const document = new Y.Doc();
    const events = { denied: [] as string[], closed: [] as string[], stateless: [] as string[] };
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name,
      document,
      token: 'cookie',
      onAuthenticationFailed: ({ reason }) => events.denied.push(reason),
      onClose: ({ event }) => events.closed.push(String(event.reason)),
      onStateless: ({ payload }) => events.stateless.push(payload),
    });
    provider.attach();
    cleanups.push(() => {
      provider.destroy();
      socket.destroy();
    });
    return { provider, document, events, socket };
  }
  return { h, owner, viewer, ws, page, connect, tokenOf, collab };
}

const text = (doc: Y.Doc) => JSON.stringify(doc.getXmlFragment('content').toJSON());

function write(doc: Y.Doc, value: string) {
  const fragment = doc.getXmlFragment('content');
  doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    const blockText = new Y.XmlElement('blockText');
    blockText.insert(0, [new Y.XmlText(value)]);
    paragraph.insert(0, [blockText]);
    fragment.insert(fragment.length, [paragraph]);
  });
}

describe('CollabServer', () => {
  it('syncs two editors and persists the document', async () => {
    const { h, owner, ws, page, connect, tokenOf } = await setup();
    const token = await tokenOf(owner);
    const a = connect(token);
    const b = connect(token);
    await until(() => a.provider.isSynced && b.provider.isSynced);
    write(a.document, 'hello');
    await until(() => text(b.document).includes('hello'));
    await until(() => h.store.content.documents.size === 1);
    const row = await h.store.documents.find(ws.id, `page:${page}`);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, row!.state);
    expect(JSON.stringify(docToJSON(stored))).toContain('hello');
    expect(h.jobs.jobs.some((j) => j.name === 'projection.document')).toBe(true);
  });

  it('drops edits from read-only connections', async () => {
    const { owner, viewer, connect, tokenOf } = await setup();
    const editor = connect(await tokenOf(owner));
    const reader = connect(await tokenOf(viewer));
    await until(() => editor.provider.isSynced && reader.provider.isSynced);
    expect(reader.provider.authorizedScope).toBe('readonly');
    write(reader.document, 'sneaky');
    write(editor.document, 'legit');
    await until(() => text(reader.document).includes('legit'));
    await new Promise((r) => setTimeout(r, 100));
    expect(text(editor.document)).not.toContain('sneaky');
  });

  it('refuses reserved document names and pages the user cannot see', async () => {
    const { h, owner, ws, page, connect, tokenOf } = await setup();
    const outsider = await h.createUser();
    await h.addMember(ws.id, outsider, 'guest');
    const plugin = connect(await tokenOf(owner), `${ws.id}/plugin:${page}`);
    const hidden = connect(await tokenOf(outsider));
    await until(() => plugin.events.denied.length > 0 && hidden.events.denied.length > 0);
    expect(plugin.events.denied).toEqual(['unsupported_document']);
    expect(hidden.events.denied).toEqual(['not_found']);
  });

  it('rejects upgrades without a session or from another origin', async () => {
    const { owner, connect, tokenOf } = await setup();
    const anonymous = connect(null);
    const foreign = connect(await tokenOf(owner), undefined, 'https://evil.example');
    await new Promise((r) => setTimeout(r, 200));
    expect(anonymous.provider.isSynced).toBe(false);
    expect(foreign.provider.isSynced).toBe(false);
  });

  it('closes connections that lose access and reconnects those whose level changed', async () => {
    const { h, owner, viewer, ws, page, connect, tokenOf } = await setup();
    const reader = connect(await tokenOf(viewer));
    const editor = connect(await tokenOf(owner));
    await until(() => reader.provider.isSynced && editor.provider.isSynced);
    await h.mutate(owner, ws.id, 'permission.revoke', {
      pageId: page,
      principal: { kind: 'user', id: viewer.id },
    });
    await until(
      () =>
        reader.events.closed.includes('not_found') || reader.events.denied.includes('not_found'),
    );
    // Locking makes the editor read-only: it is asked to reconnect, then gets readonly.
    await h.mutate(owner, ws.id, 'page.update', { id: page, isLocked: true });
    await until(() => editor.events.closed.includes('reconnect'));
  });

  it('rewrites presence with the authenticated identity', async () => {
    const { owner, viewer, connect, tokenOf } = await setup();
    const a = connect(await tokenOf(owner));
    const b = connect(await tokenOf(viewer));
    await until(() => a.provider.isSynced && b.provider.isSynced);
    a.provider.setAwarenessField('user', { id: 'spoofed', name: 'Mallory', color: '#000' });
    await until(() =>
      [...b.provider.awareness!.getStates().values()].some(
        (s) => (s['user'] as { name?: string } | undefined)?.name === 'Olive',
      ),
    );
    const names = [...b.provider.awareness!.getStates().values()].map(
      (s) => (s['user'] as { id?: string; name?: string } | undefined) ?? {},
    );
    expect(names).toContainEqual(expect.objectContaining({ id: owner.id, name: 'Olive' }));
    expect(names.some((n) => n.name === 'Mallory')).toBe(false);
  });
});
