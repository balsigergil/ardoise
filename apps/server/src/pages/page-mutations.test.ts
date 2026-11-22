// SPDX-License-Identifier: AGPL-3.0-only
import { MAX_PAGE_DEPTH, newId, positionBetween, uuidToLabel } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import type { PageRecord } from '../store/store.js';
import { createHarness, type Harness } from '../testing/harness.js';
import { SUBTREE_INLINE_LIMIT } from './page-tree.js';

const pos = positionBetween(null, null);

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const member = await h.createUser();
  const outsider = await h.createUser();
  const guest = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  await h.addMember(ws.id, member, 'member');
  await h.addMember(ws.id, outsider, 'member');
  await h.addMember(ws.id, guest, 'guest');
  await h.mutate(member, ws.id, 'teamspace.join', { teamspaceId: ts });
  const root = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Root');
  const child = await h.createPage(owner, ws.id, { kind: 'page', id: root }, 'Child');
  const grandchild = await h.createPage(owner, ws.id, { kind: 'page', id: child }, 'Grandchild');
  return { h, owner, member, outsider, guest, ws: ws.id, ts, root, child, grandchild };
}

const get = async (h: Harness, ws: string, id: string) => (await h.store.pages.findById(ws, id))!;
const label = uuidToLabel;

/** Inserts `count` children under `parent` directly in the store (large subtree fixtures). */
async function bulkChildren(h: Harness, parent: PageRecord, count: number): Promise<void> {
  const rows: PageRecord[] = [];
  let position: string | null = null;
  for (let i = 0; i < count; i++) {
    const id = newId();
    position = positionBetween(position, null);
    rows.push({
      ...parent,
      id,
      parentKind: 'page',
      parentId: parent.id,
      path: `${parent.path}.${label(id)}`,
      position,
      title: `n${i}`,
    });
  }
  await h.store.pages.insertMany(rows);
}

describe('page.create', () => {
  it('creates pages with materialized paths', async () => {
    const { h, ws, root, child, grandchild } = await setup();
    expect((await get(h, ws, grandchild)).path).toBe(
      [root, child, grandchild].map(label).join('.'),
    );
  });

  it('needs Can edit on the parent, teamspace membership or the own private section', async () => {
    const { h, owner, member, outsider, guest, ws, ts, root } = await setup();
    const create = (
      actor: typeof owner,
      parent: { kind: 'teamspace' | 'private' | 'page'; id: string },
    ) => h.tryMutate(actor, ws, 'page.create', { id: newId(), parent, position: pos });
    expect((await create(member, { kind: 'page', id: root })).status).toBe('applied');
    expect(await create(outsider, { kind: 'page', id: root })).toMatchObject({ code: 'not_found' });
    expect(await create(outsider, { kind: 'teamspace', id: ts })).toMatchObject({
      code: 'forbidden',
    });
    expect(await create(guest, { kind: 'private', id: guest.id })).toMatchObject({
      code: 'forbidden',
    });
    expect(await create(member, { kind: 'private', id: owner.id })).toMatchObject({
      code: 'forbidden',
    });
    expect((await create(outsider, { kind: 'private', id: outsider.id })).status).toBe('applied');
  });

  it('respects the teamspace default level', async () => {
    const { h, owner, member, ws, ts, root } = await setup();
    await h.mutate(owner, ws, 'teamspace.update', { id: ts, defaultLevel: 'can_view' });
    const result = await h.tryMutate(member, ws, 'page.create', {
      id: newId(),
      parent: { kind: 'page', id: root },
      position: pos,
    });
    expect(result).toMatchObject({ code: 'forbidden' });
  });
});

describe('depth limit (ADR 0007)', () => {
  it('refuses pages deeper than MAX_PAGE_DEPTH, and moves that would push a subtree past it', async () => {
    const { h, owner, ws, ts } = await setup();
    let parent: { kind: 'teamspace' | 'page'; id: string } = { kind: 'teamspace', id: ts };
    const chain: string[] = [];
    for (let i = 0; i < MAX_PAGE_DEPTH; i++) {
      const id = await h.createPage(owner, ws, parent, `d${i + 1}`);
      chain.push(id);
      parent = { kind: 'page', id };
    }
    expect(
      await h.tryMutate(owner, ws, 'page.create', { id: newId(), parent, position: pos }),
    ).toMatchObject({ code: 'too_deep' });
    // A two-level subtree fits under depth 38, not under depth 39.
    const top = await h.createPage(owner, ws, { kind: 'teamspace', id: ts }, 'top');
    await h.createPage(owner, ws, { kind: 'page', id: top }, 'kid');
    expect(
      await h.tryMutate(owner, ws, 'page.move', {
        id: top,
        parent: { kind: 'page', id: chain[38]! },
        position: pos,
      }),
    ).toMatchObject({ code: 'too_deep' });
    expect(
      (
        await h.tryMutate(owner, ws, 'page.move', {
          id: top,
          parent: { kind: 'page', id: chain[37]! },
          position: pos,
        })
      ).status,
    ).toBe('applied');
  });
});

describe('page.update', () => {
  it('needs Full access to lock, and a locked page refuses edits', async () => {
    const { h, owner, member, ws, root } = await setup();
    expect(
      await h.tryMutate(member, ws, 'page.update', { id: root, isLocked: true }),
    ).toMatchObject({ code: 'forbidden' });
    await h.mutate(owner, ws, 'page.update', { id: root, isLocked: true });
    expect(await h.tryMutate(owner, ws, 'page.update', { id: root, title: 'x' })).toMatchObject({
      code: 'page_locked',
    });
    expect(
      await h.tryMutate(owner, ws, 'page.create', {
        id: newId(),
        parent: { kind: 'page', id: root },
        position: pos,
      }),
    ).toMatchObject({ code: 'page_locked' });
    await h.mutate(owner, ws, 'page.update', { id: root, isLocked: false, title: 'Unlocked' });
    expect((await get(h, ws, root)).title).toBe('Unlocked');
  });

  it('logs the post-change state', async () => {
    const { h, owner, ws, root } = await setup();
    await h.mutate(owner, ws, 'page.update', {
      id: root,
      title: 'New',
      width: 'full',
      cover: { type: 'gradient', value: 'ocean' },
    });
    const last = h.store.sync.changeLog.at(-1)!;
    expect(last).toMatchObject({ entityType: 'page', entityId: root, pageId: root, op: 'upsert' });
    expect(last.data).toMatchObject({ title: 'New', width: 'full', hasChildren: true });
  });
});

describe('page.move', () => {
  it('rewrites the subtree path and logs the root only, with an access entry', async () => {
    const { h, owner, ws, root, child, grandchild } = await setup();
    const before = h.store.sync.changeLog.length;
    await h.mutate(owner, ws, 'page.move', {
      id: child,
      parent: { kind: 'private', id: owner.id },
      position: pos,
    });
    expect((await get(h, ws, child)).path).toBe(label(child));
    expect((await get(h, ws, grandchild)).path).toBe(`${label(child)}.${label(grandchild)}`);
    expect((await get(h, ws, child)).parentKind).toBe('private');
    const entries = h.store.sync.changeLog.slice(before);
    expect(entries.map((e) => e.entityType)).toEqual(['access', 'page']);
    expect((await get(h, ws, root)).path).toBe(label(root));
  });

  it('moves pages to a teamspace root', async () => {
    const { h, owner, ws, ts, child } = await setup();
    await h.mutate(owner, ws, 'page.move', {
      id: child,
      parent: { kind: 'teamspace', id: ts },
      position: pos,
    });
    expect(await get(h, ws, child)).toMatchObject({
      parentKind: 'teamspace',
      parentId: ts,
      path: label(child),
    });
  });

  it('reorders within a parent without touching paths or permissions', async () => {
    const { h, owner, ws, root, child } = await setup();
    const epoch = h.store.data.permEpochs.get(ws) ?? 0;
    const next = positionBetween(pos, null);
    await h.mutate(owner, ws, 'page.move', {
      id: child,
      parent: { kind: 'page', id: root },
      position: next,
    });
    expect((await get(h, ws, child)).position).toBe(next);
    expect(h.store.data.permEpochs.get(ws) ?? 0).toBe(epoch);
  });

  it('prevents cycles using the server-side path', async () => {
    const { h, owner, ws, root, grandchild } = await setup();
    expect(
      await h.tryMutate(owner, ws, 'page.move', {
        id: root,
        parent: { kind: 'page', id: grandchild },
        position: pos,
      }),
    ).toMatchObject({
      code: 'move_cycle',
    });
  });

  it('needs Can edit on the destination', async () => {
    const { h, member, outsider, ws, child } = await setup();
    const secret = await h.createPage(outsider, ws, { kind: 'private', id: outsider.id });
    expect(
      await h.tryMutate(member, ws, 'page.move', {
        id: child,
        parent: { kind: 'page', id: secret },
        position: pos,
      }),
    ).toMatchObject({
      code: 'not_found',
    });
  });

  it('hands large subtrees to a job and keeps pre-move permissions until it completes', async () => {
    const { h, owner, member, ws, root, child } = await setup();
    const big = await h.createPage(owner, ws, { kind: 'page', id: root }, 'Big');
    await bulkChildren(h, await get(h, ws, big), SUBTREE_INLINE_LIMIT + 5);
    const target = await h.createPage(owner, ws, { kind: 'private', id: owner.id }, 'Mine');
    await h.mutate(owner, ws, 'page.move', {
      id: big,
      parent: { kind: 'page', id: target },
      position: pos,
    });
    const moving = await get(h, ws, big);
    expect(moving).toMatchObject({ moveState: 'moving', parentId: target });
    expect(moving.path).toBe(`${label(root)}.${label(big)}`);
    expect(h.jobs.jobs).toEqual([
      { name: 'page.moveSubtree', data: { workspaceId: ws, pageId: big, actorId: owner.id } },
    ]);

    // While moving: further structural changes are rejected, and the teamspace member
    // keeps their access to the subtree (pre-move ancestry).
    expect(
      await h.tryMutate(owner, ws, 'page.move', {
        id: child,
        parent: { kind: 'page', id: big },
        position: pos,
      }),
    ).toMatchObject({
      code: 'page_moving',
    });
    expect(await h.tryMutate(owner, ws, 'page.trash', { id: target })).toMatchObject({
      code: 'page_moving',
    });
    const subject = await h.permissions.subject(ws, member.id);
    const deep = h.store.sync.changeLog.length; // unchanged by reads
    const anyChild = [...h.store.sync.pages.values()].find((p) => p.parentId === big)!;
    expect(await h.permissions.level(ws, subject, anyChild)).toBe('can_edit');

    await h.processors.moveSubtree({ workspaceId: ws, pageId: big, actorId: owner.id });
    const done = await get(h, ws, big);
    expect(done).toMatchObject({ moveState: null, path: `${label(target)}.${label(big)}` });
    const moved = await get(h, ws, anyChild.id);
    expect(moved.path).toBe(`${label(target)}.${label(big)}.${label(anyChild.id)}`);
    expect(await h.permissions.level(ws, subject, moved)).toBe('no_access');
    const tail = h.store.sync.changeLog.slice(deep);
    expect(tail.map((e) => e.entityType)).toEqual(['page', 'access']);
    expect(h.bus.published.at(-1)).toMatchObject({ type: 'poke', workspaceId: ws });
  });
});

describe('trash, restore and purge', () => {
  it('trashes and restores a whole subtree', async () => {
    const { h, owner, ws, child, grandchild } = await setup();
    await h.mutate(owner, ws, 'page.trash', { id: child });
    expect(await get(h, ws, grandchild)).toMatchObject({ deletedRootId: child });
    expect((await get(h, ws, grandchild)).deletedAt).not.toBeNull();
    await h.mutate(owner, ws, 'page.restore', { id: child });
    expect(await get(h, ws, grandchild)).toMatchObject({ deletedAt: null, deletedRootId: null });
  });

  it('keeps separately trashed descendants in the trash', async () => {
    const { h, owner, ws, child, grandchild } = await setup();
    await h.mutate(owner, ws, 'page.trash', { id: grandchild });
    await h.mutate(owner, ws, 'page.trash', { id: child });
    await h.mutate(owner, ws, 'page.restore', { id: child });
    expect(await get(h, ws, grandchild)).toMatchObject({ deletedRootId: grandchild });
  });

  it('restores to the section root when the parent is still in the trash', async () => {
    const { h, owner, ws, ts, root, child } = await setup();
    await h.mutate(owner, ws, 'page.trash', { id: child });
    await h.mutate(owner, ws, 'page.trash', { id: root });
    await h.mutate(owner, ws, 'page.restore', { id: child });
    expect(await get(h, ws, child)).toMatchObject({
      parentKind: 'teamspace',
      parentId: ts,
      deletedAt: null,
      path: label(child),
    });
  });

  it('purges trash roots only, with Full access', async () => {
    const { h, owner, member, ws, child, grandchild } = await setup();
    expect(await h.tryMutate(owner, ws, 'page.purge', { id: child })).toMatchObject({
      code: 'page_not_in_trash',
    });
    await h.mutate(owner, ws, 'page.trash', { id: child });
    expect(await h.tryMutate(member, ws, 'page.purge', { id: child })).toMatchObject({
      code: 'forbidden',
    });
    await h.mutate(owner, ws, 'page.purge', { id: child });
    expect(await h.store.pages.findById(ws, grandchild)).toBeUndefined();
    expect(h.store.sync.changeLog.at(-1)).toMatchObject({
      entityType: 'page',
      op: 'delete',
      entityId: child,
    });
  });
});

describe('page.duplicate', () => {
  it('copies a small subtree with new ids and grants', async () => {
    const { h, owner, member, ws, root, child } = await setup();
    await h.mutate(owner, ws, 'permission.grant', {
      pageId: child,
      principal: { kind: 'user', id: member.id },
      level: 'full_access',
    });
    const copyId = newId();
    await h.mutate(owner, ws, 'page.duplicate', {
      id: child,
      newId: copyId,
      position: positionBetween(pos, null),
    });
    const copy = await get(h, ws, copyId);
    expect(copy).toMatchObject({
      title: 'Child',
      parentId: root,
      createdBy: owner.id,
      path: `${label(root)}.${label(copyId)}`,
    });
    const copiedChildren = [...h.store.sync.pages.values()].filter((p) => p.parentId === copyId);
    expect(copiedChildren.map((p) => p.title)).toEqual(['Grandchild']);
    expect(copiedChildren[0]!.path).toBe(`${copy.path}.${label(copiedChildren[0]!.id)}`);
    expect(await h.store.grants.forPages(ws, [copyId])).toMatchObject([
      { principalId: member.id, level: 'full_access' },
    ]);
  });

  it('copies large subtrees in a job', async () => {
    const { h, owner, ws, root } = await setup();
    const big = await h.createPage(owner, ws, { kind: 'page', id: root }, 'Big');
    await bulkChildren(h, await get(h, ws, big), SUBTREE_INLINE_LIMIT + 1);
    const copyId = newId();
    await h.mutate(owner, ws, 'page.duplicate', {
      id: big,
      newId: copyId,
      position: positionBetween(pos, null),
    });
    expect(await get(h, ws, copyId)).toMatchObject({ moveState: 'moving' });
    await h.processors.duplicateSubtree({
      workspaceId: ws,
      sourceId: big,
      newId: copyId,
      actorId: owner.id,
    });
    expect(await get(h, ws, copyId)).toMatchObject({ moveState: null });
    expect([...h.store.sync.pages.values()].filter((p) => p.parentId === copyId)).toHaveLength(
      SUBTREE_INLINE_LIMIT + 1,
    );
    // A retried job does not copy twice.
    await h.store.pages.update(ws, copyId, { moveState: 'moving' });
    await h.processors.duplicateSubtree({
      workspaceId: ws,
      sourceId: big,
      newId: copyId,
      actorId: owner.id,
    });
    expect([...h.store.sync.pages.values()].filter((p) => p.parentId === copyId)).toHaveLength(
      SUBTREE_INLINE_LIMIT + 1,
    );
  });
});

describe('favorites and follows', () => {
  it('are user-private entries and need view access', async () => {
    const { h, owner, outsider, ws, root } = await setup();
    await h.mutate(owner, ws, 'favorite.add', { pageId: root, position: pos });
    expect(h.store.sync.changeLog.at(-1)).toMatchObject({
      entityType: 'favorite',
      userId: owner.id,
    });
    expect(
      await h.tryMutate(outsider, ws, 'favorite.add', { pageId: root, position: pos }),
    ).toMatchObject({ code: 'not_found' });
    await h.mutate(owner, ws, 'follow.add', { pageId: root });
    expect(await h.store.userPages.isFollowing(ws, owner.id, root)).toBe(true);
    await h.mutate(owner, ws, 'follow.remove', { pageId: root });
    await h.mutate(owner, ws, 'favorite.remove', { pageId: root });
    expect(await h.store.userPages.favorites(ws, owner.id, 10)).toEqual([]);
  });
});
