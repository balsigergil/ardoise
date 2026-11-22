// SPDX-License-Identifier: AGPL-3.0-only
import { newId, positionBetween } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness.js';

const pos = positionBetween(null, null);

async function setup() {
  const h = createHarness();
  const owner = await h.createUser({ name: 'Olive' });
  const member = await h.createUser({ name: 'Max' });
  const outsider = await h.createUser({ name: 'Otto' });
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, member, 'member');
  await h.addMember(ws.id, outsider, 'member');
  await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: ts });
  const root = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Root');
  const child = await h.createPage(owner, ws.id, { kind: 'page', id: root }, 'Child');
  return { h, owner, member, outsider, ws: ws.id, ts, root, child };
}

const list = { limit: 100 };

describe('PageService: tree reads', () => {
  it('lists teamspace roots and children with hasChildren and the read seq', async () => {
    const { h, member, ws, ts, root, child } = await setup();
    const roots = await h.pages.teamspaceRoots(member, ws, ts, list);
    expect(roots.items.map((p) => [p.id, p.hasChildren])).toEqual([[root, true]]);
    expect(roots.seq).toBe(await h.store.changeLog.currentSeq(ws));
    expect((await h.pages.children(member, ws, root, list)).items.map((p) => p.id)).toEqual([
      child,
    ]);
  });

  it('hides children without access and paginates', async () => {
    const { h, owner, member, ws, root, child } = await setup();
    const hidden = await h.createPage(
      owner,
      ws,
      { kind: 'page', id: root },
      'Hidden',
      positionBetween(pos, null),
    );
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: hidden, restrict: true });
    expect((await h.pages.children(member, ws, root, list)).items.map((p) => p.id)).toEqual([
      child,
    ]);
    const first = await h.pages.children(owner, ws, root, { limit: 1 });
    const second = await h.pages.children(owner, ws, root, { limit: 1, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((p) => p.id)).toEqual([child, hidden]);
    expect(second.nextCursor).toBeNull();
  });

  it('refuses unknown teamspaces and pages without access', async () => {
    const { h, outsider, ws, root } = await setup();
    await expect(h.pages.children(outsider, ws, root, list)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(h.pages.teamspaceRoots(outsider, ws, newId(), list)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it("lists the user's private pages only", async () => {
    const { h, owner, member, ws } = await setup();
    const mine = await h.createPage(member, ws, { kind: 'private', id: member.id }, 'Mine');
    await h.createPage(owner, ws, { kind: 'private', id: owner.id }, 'Theirs');
    expect((await h.pages.privateRoots(member, ws, list)).items.map((p) => p.id)).toEqual([mine]);
  });

  it('lists topmost pages shared outside my teamspaces and private section', async () => {
    const { h, owner, outsider, ws, root } = await setup();
    const priv = await h.createPage(owner, ws, { kind: 'private', id: owner.id }, 'Plan');
    const sub = await h.createPage(owner, ws, { kind: 'page', id: priv }, 'Sub');
    for (const pageId of [priv, sub, root])
      await h.mutate(owner, ws, 'permission.grant', {
        pageId,
        principal: { kind: 'user', id: outsider.id },
        level: 'can_view',
      });
    const shared = await h.pages.shared(outsider, ws, list);
    expect(shared.items.map((p) => p.id).sort()).toEqual([priv, root].sort());
    // Teamspace members do not see their teamspace's pages under Shared.
    expect((await h.pages.shared(owner, ws, list)).items).toEqual([]);
  });
});

describe('PageService: page detail', () => {
  it('returns breadcrumbs, section, level and per-user flags', async () => {
    const { h, owner, member, ws, ts, root, child } = await setup();
    await h.mutate(member, ws, 'favorite.add', { pageId: child, position: pos });
    const detail = await h.pages.page(member, ws, child);
    expect(detail).toMatchObject({
      level: 'can_edit',
      isFavorite: true,
      isFollowing: false,
      section: { kind: 'teamspace', id: ts, name: 'Acme' },
      ancestors: [{ id: root, title: 'Root', accessible: true }],
    });
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: child, restrict: true });
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: child,
      principal: { kind: 'user', id: member.id },
      level: 'can_view',
    });
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: root, restrict: true });
    const restricted = await h.pages.page(member, ws, child);
    expect(restricted.ancestors).toEqual([{ id: root, title: '', icon: null, accessible: false }]);
    expect(restricted.level).toBe('can_view');
  });
});

describe('PageService: sharing', () => {
  it('explains who has access and why', async () => {
    const { h, owner, member, outsider, ws, ts, root, child } = await setup();
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: root,
      principal: { kind: 'user', id: outsider.id },
      level: 'can_comment',
    });
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: child,
      principal: { kind: 'workspace', id: ws },
      level: 'can_view',
    });
    const sharing = await h.pages.sharing(member, ws, child);
    expect(sharing.grants).toEqual([
      {
        principal: { kind: 'workspace', id: ws, name: 'Acme', email: null },
        level: 'can_view',
        inheritedFrom: null,
      },
      {
        principal: { kind: 'user', id: outsider.id, name: 'Otto', email: outsider.email },
        level: 'can_comment',
        inheritedFrom: { id: root, title: 'Root' },
      },
    ]);
    expect(sharing.root).toEqual({
      kind: 'teamspace',
      id: ts,
      name: 'Acme',
      defaultLevel: 'can_edit',
    });
    expect(sharing.mySources.map((s) => s.via)).toEqual(['grant', 'teamspace_default']);
    expect(sharing.publicLink).toEqual({ enabled: false, includeSubpages: false, url: null });
  });

  it('stops at restricted pages and shows the public link URL to full-access users only', async () => {
    const { h, owner, member, outsider, ws, root, child } = await setup();
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: root,
      principal: { kind: 'user', id: outsider.id },
      level: 'full_access',
    });
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: child, restrict: true });
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: child,
      principal: { kind: 'user', id: member.id },
      level: 'can_view',
    });
    await h.mutate(owner, ws, 'publicLink.set', { pageId: child, enabled: true });
    const mine = await h.pages.sharing(owner, ws, child);
    expect(mine.root).toBeNull();
    // The owner kept Full access through an automatic grant when restricting.
    expect(mine.grants.map((g) => [g.principal.id, g.level]).sort()).toEqual(
      [
        [member.id, 'can_view'],
        [owner.id, 'full_access'],
      ].sort(),
    );
    expect(mine.publicLink.url).toMatch(/^https:\/\/ardoise\.test\/share\/[\w-]{43}$/);
    const theirs = await h.pages.sharing(member, ws, child);
    expect(theirs.publicLink).toEqual({ enabled: true, includeSubpages: false, url: null });
    // The inherited grant on the root no longer reaches the restricted page.
    await expect(h.pages.sharing(outsider, ws, child)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets workspace owners recover access to restricted teamspace pages, never private ones', async () => {
    const { h, owner, member, ws, root } = await setup();
    const locked = await h.createPage(owner, ws, { kind: 'page', id: root }, 'Locked out');
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: locked,
      principal: { kind: 'user', id: member.id },
      level: 'full_access',
    });
    await h.mutate(member, ws, 'permission.setRestrict', { pageId: locked, restrict: true });
    await expect(h.pages.sharing(owner, ws, locked)).rejects.toMatchObject({ code: 'not_found' });
    expect(await h.tryMutate(member, ws, 'permission.recover', { pageId: locked })).toMatchObject({
      code: 'forbidden',
    });
    await h.mutate(owner, ws, 'permission.recover', { pageId: locked });
    expect((await h.pages.sharing(owner, ws, locked)).myLevel).toBe('full_access');
    const priv = await h.createPage(member, ws, { kind: 'private', id: member.id });
    expect(await h.tryMutate(owner, ws, 'permission.recover', { pageId: priv })).toMatchObject({
      code: 'forbidden',
    });
  });

  it('validates grant principals', async () => {
    const { h, owner, ws, root } = await setup();
    const stranger = await h.createUser();
    for (const principal of [
      { kind: 'user' as const, id: stranger.id },
      { kind: 'teamspace' as const, id: newId() },
      { kind: 'workspace' as const, id: newId() },
    ]) {
      expect(
        await h.tryMutate(owner, ws, 'permission.grant', {
          pageId: root,
          principal,
          level: 'can_view',
        }),
      ).toMatchObject({
        code: 'not_found',
      });
    }
  });
});

describe('PageService: trash, favorites, recents', () => {
  it('lists trash roots the user can view, newest first, with search', async () => {
    const { h, owner, member, ws, root, child } = await setup();
    const other = await h.createPage(
      owner,
      ws,
      { kind: 'page', id: root },
      'Other',
      positionBetween(pos, null),
    );
    await h.mutate(owner, ws, 'page.trash', { id: child });
    h.clock.advance(1000);
    await h.mutate(owner, ws, 'page.trash', { id: other });
    const priv = await h.createPage(owner, ws, { kind: 'private', id: owner.id }, 'Private');
    h.clock.advance(1000);
    await h.mutate(owner, ws, 'page.trash', { id: priv });
    expect((await h.pages.trash(member, ws, list)).items.map((p) => p.id)).toEqual([other, child]);
    expect((await h.pages.trash(member, ws, { ...list, q: 'chi' })).items.map((p) => p.id)).toEqual(
      [child],
    );
    const first = await h.pages.trash(owner, ws, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const rest = await h.pages.trash(owner, ws, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...rest.items].map((p) => p.id)).toEqual([priv, other, child]);
  });

  it('lists favorites in order, skipping trashed pages', async () => {
    const { h, owner, ws, root, child } = await setup();
    const a = positionBetween(null, null);
    const b = positionBetween(a, null);
    await h.mutate(owner, ws, 'favorite.add', { pageId: child, position: a });
    await h.mutate(owner, ws, 'favorite.add', { pageId: root, position: b });
    expect((await h.pages.favorites(owner, ws)).items.map((p) => p.id)).toEqual([child, root]);
    await h.mutate(owner, ws, 'page.trash', { id: child });
    expect((await h.pages.favorites(owner, ws)).items.map((p) => p.id)).toEqual([root]);
  });

  it('records recents without the change log, capped and filtered', async () => {
    const { h, owner, outsider, ws, root, child } = await setup();
    const before = h.store.sync.changeLog.length;
    await h.pages.touchRecent(owner, ws, root);
    h.clock.advance(1000);
    await h.pages.touchRecent(owner, ws, child);
    expect(h.store.sync.changeLog.length).toBe(before);
    expect((await h.pages.recents(owner, ws)).items.map((r) => r.page.id)).toEqual([child, root]);
    await expect(h.pages.touchRecent(outsider, ws, root)).rejects.toMatchObject({
      code: 'not_found',
    });
    for (let i = 0; i < 55; i++) {
      h.clock.advance(1000);
      await h.pages.touchRecent(
        owner,
        ws,
        await h.createPage(owner, ws, { kind: 'private', id: owner.id }),
      );
    }
    expect((await h.pages.recents(owner, ws)).items).toHaveLength(50);
  });
});

describe('PublicPageService', () => {
  async function shared(includeSubpages: boolean) {
    const s = await setup();
    await s.h.mutate(s.owner, s.ws, 'publicLink.set', {
      pageId: s.root,
      enabled: true,
      includeSubpages,
    });
    const url = (await s.h.pages.sharing(s.owner, s.ws, s.root)).publicLink.url!;
    return { ...s, token: url.split('/share/')[1]! };
  }

  it('serves the link page and, when included, its subpages', async () => {
    const { h, token, root, child } = await shared(true);
    expect(await h.publicPages.page(token)).toMatchObject({
      page: { id: root, title: 'Root', hasChildren: true },
      rootId: root,
      ancestors: [],
    });
    expect((await h.publicPages.children(token, root, list)).items.map((c) => c.id)).toEqual([
      child,
    ]);
    expect(await h.publicPages.page(token, child)).toMatchObject({
      page: { id: child },
      ancestors: [{ id: root, title: 'Root' }],
    });
  });

  it('does not cover subpages unless included, nor restricted or trashed pages', async () => {
    const without = await shared(false);
    await expect(without.h.publicPages.page(without.token, without.child)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await without.h.publicPages.page(without.token)).page.hasChildren).toBe(false);
    const { h, owner, ws, token, child } = await shared(true);
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: child, restrict: true });
    await expect(h.publicPages.page(token, child)).rejects.toMatchObject({ code: 'not_found' });
    await h.mutate(owner, ws, 'permission.setRestrict', { pageId: child, restrict: false });
    await h.mutate(owner, ws, 'page.trash', { id: child });
    await expect(h.publicPages.page(token, child)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('stops working when revoked; re-enabling issues a new token', async () => {
    const { h, owner, ws, root, token } = await shared(false);
    await h.mutate(owner, ws, 'publicLink.set', { pageId: root, enabled: false });
    await expect(h.publicPages.page(token)).rejects.toMatchObject({ code: 'not_found' });
    await h.mutate(owner, ws, 'publicLink.set', { pageId: root, enabled: true });
    const url = (await h.pages.sharing(owner, ws, root)).publicLink.url!;
    expect(url).not.toContain(token);
    await expect(h.publicPages.page('x'.repeat(43))).rejects.toMatchObject({ code: 'not_found' });
  });
});
