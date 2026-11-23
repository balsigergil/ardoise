// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';
import { decodeCursor, encodeCursor } from './search.service.js';

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const member = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, member, 'member');
  await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: ts });
  const root = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Projets');
  const child = await h.createPage(owner, ws.id, { kind: 'page', id: root }, 'Été 2026');
  const secret = await h.createPage(owner, ws.id, { kind: 'private', id: owner.id }, 'Été secret');
  const body = async (pageId: string, text: string) => {
    const page = (await h.store.pages.findById(ws.id, pageId))!;
    await h.store.projection.upsertContent(ws.id, pageId, page.title, text);
  };
  return { h, owner, member, ws, ts, root, child, secret, body };
}

describe('quick find', () => {
  it('matches titles without accents and filters by permission', async () => {
    const { h, member, owner, ws } = await setup();
    const forMember = await h.search.quickFind(member, ws.id, 'ete', 20);
    expect(forMember.items.map((i) => i.title)).toEqual(['Été 2026']);
    expect(forMember.items[0]!.path).toEqual(['Projets']);
    const forOwner = await h.search.quickFind(owner, ws.id, 'été', 20);
    expect(forOwner.items.map((i) => i.title).sort()).toEqual(['Été 2026', 'Été secret']);
  });

  it('hides the titles of ancestors the user cannot see', async () => {
    const { h, owner, member, ws, secret } = await setup();
    const shared = await h.createPage(owner, ws.id, { kind: 'page', id: secret }, 'Shared plan');
    await h.mutate(owner, ws.id, 'permission.grant', {
      pageId: shared,
      principal: { kind: 'user', id: member.id },
      level: 'can_view',
    });
    const result = await h.search.quickFind(member, ws.id, 'shared', 20);
    expect(result.items).toMatchObject([{ title: 'Shared plan', path: [] }]);
  });

  it('returns nothing for an empty query and refuses non-members', async () => {
    const { h, member, ws } = await setup();
    expect((await h.search.quickFind(member, ws.id, '  ', 20)).items).toEqual([]);
    const stranger = await h.createUser();
    await expect(h.search.quickFind(stranger, ws.id, 'x', 20)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('full search', () => {
  it('finds body text with snippets, filtered by permission', async () => {
    const { h, member, ws, child, secret, body } = await setup();
    await body(child, 'Le budget du festival');
    await body(secret, 'Le budget caché');
    const result = await h.search.search(member, ws.id, {
      q: 'budget',
      limit: 20,
      titleOnly: false,
    });
    expect(result.items.map((i) => i.id)).toEqual([child]);
    expect(result.items[0]!.snippet).toContain('\u0002budget\u0003');
    expect(result.items[0]!.path).toEqual(['Projets']);
  });

  it('applies filters (title only, teamspace, author, dates)', async () => {
    const { h, owner, member, ws, ts, root, child, body } = await setup();
    await body(root, 'mentions été');
    await body(child, 'rien');
    const titleOnly = await h.search.search(member, ws.id, {
      q: 'ete',
      limit: 20,
      titleOnly: true,
    });
    expect(titleOnly.items.map((i) => i.id)).toEqual([child]);
    const inTeamspace = await h.search.search(owner, ws.id, {
      q: 'ete',
      limit: 20,
      titleOnly: false,
      teamspaceId: ts,
    });
    expect(inTeamspace.items.map((i) => i.id).sort()).toEqual([root, child].sort());
    const byOther = await h.search.search(owner, ws.id, {
      q: 'ete',
      limit: 20,
      titleOnly: false,
      createdBy: member.id,
    });
    expect(byOther.items).toEqual([]);
    const future = await h.search.search(owner, ws.id, {
      q: 'ete',
      limit: 20,
      titleOnly: false,
      editedAfter: '2099-01-01T00:00:00Z',
    });
    expect(future.items).toEqual([]);
  });

  it('paginates with an opaque cursor', async () => {
    const { h, owner, ws, ts } = await setup();
    for (let i = 0; i < 5; i++) {
      const id = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, `Note ${i}`);
      await h.store.projection.upsertContent(ws.id, id, `Note ${i}`, 'shared keyword');
    }
    const first = await h.search.search(owner, ws.id, { q: 'keyword', limit: 3, titleOnly: false });
    expect(first.items).toHaveLength(3);
    const second = await h.search.search(owner, ws.id, {
      q: 'keyword',
      limit: 3,
      titleOnly: false,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(5);
  });

  it('rejects tampered cursors', () => {
    expect(
      decodeCursor(encodeCursor({ rank: 0.5, pageId: '0190a000-0000-7000-8000-000000000001' })),
    ).toEqual({
      rank: 0.5,
      pageId: '0190a000-0000-7000-8000-000000000001',
    });
    expect(() => decodeCursor('not-base64-json')).toThrow();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
