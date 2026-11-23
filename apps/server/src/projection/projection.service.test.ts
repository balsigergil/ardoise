// SPDX-License-Identifier: AGPL-3.0-only
import { docFromJSON } from '@ardoise/editor';
import { newId } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHarness } from '../testing/harness.js';

const bt = (...content: unknown[]) => ({ type: 'blockText', content });
const t = (text: string) => ({ type: 'text', text });

async function setup() {
  const h = createHarness();
  const owner = await h.createUser({ name: 'Olive' });
  const reader = await h.createUser({ name: 'Rita' });
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, reader, 'member');
  await h.mutate(reader, ws.id, 'teamspace.join', { teamspaceId: ts });
  const target = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Target');
  const source = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Source');
  /** Stores a document for `pageId` as the collab node would. */
  async function store(pageId: string, content: unknown[], at = h.clock.now()) {
    const state = Y.encodeStateAsUpdate(docFromJSON({ type: 'doc', content }));
    await h.store.documents.upsert({
      workspaceId: ws.id,
      docName: `page:${pageId}`,
      pageId,
      state,
      stateVector: new Uint8Array(),
      size: state.byteLength,
      updatedAt: at,
    });
  }
  const project = (pageId: string) =>
    h.processors.run('projection.document', {
      workspaceId: ws.id,
      pageId,
      docName: `page:${pageId}`,
    });
  return { h, owner, reader, ws, ts, target, source, store, project };
}

describe('projection job', () => {
  it('writes search text, links (no self-links) and user mentions', async () => {
    const { h, ws, source, target, reader, store, project } = await setup();
    await store(source, [
      {
        type: 'paragraph',
        attrs: { blockId: 'b1' },
        content: [
          bt(t('Hello world'), { type: 'mention', attrs: { kind: 'user', id: reader.id } }),
        ],
      },
      { type: 'pageLink', attrs: { pageId: target } },
      { type: 'pageLink', attrs: { pageId: source } },
      {
        type: 'paragraph',
        content: [bt({ type: 'mention', attrs: { kind: 'page', id: target } })],
      },
    ]);
    await project(source);
    const content = h.store.content;
    expect(content.search.get(`${ws.id}/${source}`)).toMatchObject({
      title: 'Source',
      plainText: 'Hello world',
    });
    expect(content.links.map((l) => `${l.targetPageId}:${l.kind}`).sort()).toEqual([
      `${target}:link`,
      `${target}:mention`,
    ]);
    expect(content.mentions).toEqual([
      { workspaceId: ws.id, pageId: source, userId: reader.id, blockId: 'b1' },
    ]);
  });

  it('replaces the previous projection', async () => {
    const { h, source, target, store, project } = await setup();
    await store(source, [{ type: 'pageLink', attrs: { pageId: target } }]);
    await project(source);
    await store(source, [{ type: 'paragraph', content: [bt(t('no links'))] }]);
    await project(source);
    expect(h.store.content.links).toEqual([]);
  });

  it('skips missing documents and purged pages', async () => {
    const { h, ws, project } = await setup();
    await project(newId());
    await expect(
      h.processors.run('projection.document', {
        workspaceId: ws.id,
        pageId: newId(),
        docName: 'page:x',
      }),
    ).resolves.toBeUndefined();
  });

  it('runs again when the document was stored meanwhile', async () => {
    const { h, ws, source, store } = await setup();
    await store(source, []);
    const row = (await h.store.documents.find(ws.id, `page:${source}`))!;
    // A store lands while the job runs: the job sees a newer updatedAt afterwards.
    const find = h.store.documents.find.bind(h.store.documents);
    let calls = 0;
    h.store.documents.find = async (w, n) => {
      calls++;
      const r = await find(w, n);
      return calls === 1 ? r : r && { ...r, updatedAt: new Date(row.updatedAt.getTime() + 1) };
    };
    await h.projection.projectDocument({
      workspaceId: ws.id,
      pageId: source,
      docName: `page:${source}`,
    });
    expect(h.jobs.jobs.filter((j) => j.name === 'projection.document')).toHaveLength(1);
  });

  it('makes titles searchable at once through page.update', async () => {
    const { h, ws, owner, target } = await setup();
    await h.mutate(owner, ws.id, 'page.update', { id: target, title: 'Renamed' });
    expect(h.store.content.search.get(`${ws.id}/${target}`)?.title).toBe('Renamed');
  });
});

describe('backlinks', () => {
  it('lists viewable linking pages with their kinds, paginated', async () => {
    const { h, ws, owner, reader, ts, source, target, store, project } = await setup();
    const hidden = await h.createPage(owner, ws.id, { kind: 'private', id: owner.id }, 'Secret');
    const other = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Other');
    for (const page of [source, hidden, other]) {
      await store(page, [
        { type: 'pageLink', attrs: { pageId: target } },
        {
          type: 'paragraph',
          content: [bt({ type: 'mention', attrs: { kind: 'page', id: target } })],
        },
      ]);
      await project(page);
    }
    const all = await h.projection.backlinks(reader, ws.id, target, { limit: 50 });
    expect(all.items.map((i) => i.page.title).sort()).toEqual(['Other', 'Source']);
    expect(all.items[0]!.kinds).toEqual(['link', 'mention']);
    const first = await h.projection.backlinks(owner, ws.id, target, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const next = await h.projection.backlinks(owner, ws.id, target, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it('requires view access to the target', async () => {
    const { h, ws, owner, reader } = await setup();
    const secret = await h.createPage(owner, ws.id, { kind: 'private', id: owner.id }, 'Secret');
    await expect(
      h.projection.backlinks(reader, ws.id, secret, { limit: 10 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
