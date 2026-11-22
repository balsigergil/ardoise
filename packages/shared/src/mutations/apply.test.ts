// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { MAX_PAGE_DEPTH, type PageDto, type PageParent } from '../pages.js';
import { positionBetween } from '../position.js';
import type { Change, EntityMap, EntityType } from '../sync.js';
import { applyMutation, knownAncestors, type ApplyContext, type EntityReader } from './apply.js';
import { mutationArgs, parseMutation, type MutationInput, type MutationName } from './catalog.js';

const ME = newId();
const WS = newId();
const TS = newId();
const ctx: ApplyContext = { actorId: ME, workspaceId: WS, now: '2026-11-22T10:00:00.000Z' };

class MapReader implements EntityReader {
  readonly data = new Map<string, unknown>();
  sections = new Map<string, PageParent>();
  constructor(readonly authoritative = true) {}
  get<T extends EntityType>(type: T, id: string): EntityMap[T] | undefined {
    return this.data.get(`${type}/${id}`) as EntityMap[T] | undefined;
  }
  set<T extends EntityType>(type: T, id: string, value: EntityMap[T]): this {
    this.data.set(`${type}/${id}`, value);
    return this;
  }
  sectionOf(pageId: string): PageParent | undefined {
    return this.sections.get(pageId);
  }
}

function page(overrides: Partial<PageDto> = {}): PageDto {
  return {
    id: newId(),
    kind: 'page',
    parentKind: 'teamspace',
    parentId: TS,
    position: positionBetween(null, null),
    title: 'Page',
    icon: null,
    cover: null,
    width: 'normal',
    font: 'default',
    isLocked: false,
    restrictInheritance: false,
    isInline: false,
    isTemplate: false,
    moveState: null,
    createdBy: ME,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedBy: ME,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedRootId: null,
    hasChildren: false,
    ...overrides,
  };
}

/** A teamspace with a chain root → mid → leaf. */
function tree() {
  const reader = new MapReader();
  reader.set('teamspace', TS, {
    id: TS,
    name: 'T',
    icon: null,
    description: '',
    visibility: 'open',
    defaultLevel: 'can_edit',
  });
  const root = page({ title: 'root' });
  const mid = page({ parentKind: 'page', parentId: root.id, title: 'mid' });
  const leaf = page({ parentKind: 'page', parentId: mid.id, title: 'leaf' });
  for (const p of [root, mid, leaf]) {
    reader.set('page', p.id, p);
    reader.sections.set(p.id, { kind: 'teamspace', id: TS });
  }
  return { reader, root, mid, leaf };
}

function run<N extends MutationName>(reader: EntityReader, name: N, input: MutationInput[N]) {
  const args = mutationArgs[name].parse(input);
  return applyMutation(reader, { name, args }, ctx);
}

function single(result: ReturnType<typeof run>): Change {
  if (!result.ok) throw new Error(`rejected: ${result.code}`);
  expect(result.changes).toHaveLength(1);
  return result.changes[0]!;
}

function upserted<T extends EntityType>(result: ReturnType<typeof run>, type: T): EntityMap[T] {
  const change = single(result);
  expect(change.type).toBe(type);
  if (change.op !== 'upsert') throw new Error('expected upsert');
  return change.data as EntityMap[T];
}

const pos = positionBetween(null, null);

describe('catalog', () => {
  it('parses envelopes and rejects bad args', () => {
    const base = { id: newId(), workspaceId: WS, clientTime: ctx.now };
    expect(parseMutation({ ...base, name: 'page.trash', args: { id: newId() } })?.name).toBe(
      'page.trash',
    );
    expect(parseMutation({ ...base, name: 'page.trash', args: { id: 'x' } })).toBeUndefined();
    expect(parseMutation({ ...base, name: 'page.update', args: { id: newId() } })).toBeUndefined();
    expect(
      parseMutation({
        ...base,
        name: 'permission.grant',
        args: { pageId: newId(), principal: { kind: 'user', id: ME }, level: 'no_access' },
      }),
    ).toBeUndefined();
  });

  it('requires UUIDv7 for client-created ids', () => {
    const v4 = '0d0b7c43-4b1e-4b8e-9f3a-1f9b5b2c3d4e';
    expect(
      mutationArgs['page.create'].safeParse({
        id: v4,
        parent: { kind: 'private', id: ME },
        position: pos,
      }).success,
    ).toBe(false);
  });
});

describe('page.create', () => {
  it('creates under a teamspace, a private section or a page', () => {
    const { reader, leaf } = tree();
    for (const parent of [
      { kind: 'teamspace', id: TS },
      { kind: 'private', id: ME },
      { kind: 'page', id: leaf.id },
    ] as const) {
      const id = newId();
      const created = upserted(
        run(reader, 'page.create', { id, parent, position: pos, title: 'New' }),
        'page',
      );
      expect(created).toMatchObject({
        id,
        parentKind: parent.kind,
        parentId: parent.id,
        title: 'New',
        createdBy: ME,
      });
      expect(created.createdAt).toBe(ctx.now);
    }
  });

  it("rejects someone else's private section, unknown parents and bad parents", () => {
    const { reader, leaf } = tree();
    const create = (parent: { kind: 'teamspace' | 'private' | 'page'; id: string }) =>
      run(reader, 'page.create', { id: newId(), parent, position: pos });
    expect(create({ kind: 'private', id: newId() })).toEqual({ ok: false, code: 'forbidden' });
    expect(create({ kind: 'teamspace', id: newId() })).toEqual({ ok: false, code: 'not_found' });
    expect(create({ kind: 'page', id: newId() })).toEqual({ ok: false, code: 'not_found' });
    reader.set('page', leaf.id, { ...leaf, isLocked: true });
    expect(create({ kind: 'page', id: leaf.id })).toEqual({ ok: false, code: 'page_locked' });
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now, deletedRootId: leaf.id });
    expect(create({ kind: 'page', id: leaf.id })).toEqual({ ok: false, code: 'page_in_trash' });
    reader.set('page', leaf.id, { ...leaf, kind: 'row' });
    expect(create({ kind: 'page', id: leaf.id })).toEqual({ ok: false, code: 'invalid_parent' });
  });

  it('rejects an existing id', () => {
    const { reader, leaf } = tree();
    expect(
      run(reader, 'page.create', {
        id: leaf.id,
        parent: { kind: 'teamspace', id: TS },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'validation_failed' });
  });

  it('refuses a child beyond the depth limit when the chain is known', () => {
    const reader = new MapReader();
    let parent = page();
    reader.set('page', parent.id, parent);
    for (let i = 1; i < MAX_PAGE_DEPTH; i++) {
      const child = page({ parentKind: 'page', parentId: parent.id });
      reader.set('page', child.id, child);
      parent = child;
    }
    expect(
      run(reader, 'page.create', {
        id: newId(),
        parent: { kind: 'page', id: parent.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'too_deep' });
  });

  it('accepts unknown teamspaces on the client (partial cache)', () => {
    const reader = new MapReader(false);
    const result = run(reader, 'page.create', {
      id: newId(),
      parent: { kind: 'teamspace', id: TS },
      position: pos,
    });
    expect(result.ok).toBe(true);
  });
});

describe('page.update', () => {
  it('patches fields and stamps the editor', () => {
    const { reader, leaf } = tree();
    const updated = upserted(
      run(reader, 'page.update', {
        id: leaf.id,
        title: 'Renamed',
        icon: { type: 'emoji', value: '📘' },
        cover: { type: 'color', value: 'blue' },
        width: 'full',
        font: 'serif',
      }),
      'page',
    );
    expect(updated).toMatchObject({
      title: 'Renamed',
      icon: { type: 'emoji', value: '📘' },
      cover: { type: 'color', value: 'blue' },
      width: 'full',
      font: 'serif',
      updatedAt: ctx.now,
      updatedBy: ME,
    });
  });

  it('blocks edits on locked pages except unlocking', () => {
    const { reader, leaf } = tree();
    reader.set('page', leaf.id, { ...leaf, isLocked: true });
    expect(run(reader, 'page.update', { id: leaf.id, title: 'x' })).toEqual({
      ok: false,
      code: 'page_locked',
    });
    expect(
      upserted(run(reader, 'page.update', { id: leaf.id, isLocked: false }), 'page').isLocked,
    ).toBe(false);
    expect(
      upserted(run(reader, 'page.update', { id: leaf.id, isLocked: false, title: 'y' }), 'page')
        .title,
    ).toBe('y');
  });

  it('rejects missing and trashed pages', () => {
    const { reader, leaf } = tree();
    expect(run(reader, 'page.update', { id: newId(), title: 'x' })).toEqual({
      ok: false,
      code: 'not_found',
    });
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now });
    expect(run(reader, 'page.update', { id: leaf.id, title: 'x' })).toEqual({
      ok: false,
      code: 'page_in_trash',
    });
  });
});

describe('page.move', () => {
  it('moves across parents and sections', () => {
    const { reader, root, leaf } = tree();
    const moved = upserted(
      run(reader, 'page.move', {
        id: leaf.id,
        parent: { kind: 'page', id: root.id },
        position: pos,
      }),
      'page',
    );
    expect(moved).toMatchObject({ parentKind: 'page', parentId: root.id, position: pos });
    const toPrivate = upserted(
      run(reader, 'page.move', { id: leaf.id, parent: { kind: 'private', id: ME }, position: pos }),
      'page',
    );
    expect(toPrivate).toMatchObject({ parentKind: 'private', parentId: ME });
  });

  it('prevents cycles', () => {
    const { reader, root, mid, leaf } = tree();
    expect(
      run(reader, 'page.move', {
        id: root.id,
        parent: { kind: 'page', id: leaf.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'move_cycle' });
    expect(
      run(reader, 'page.move', { id: mid.id, parent: { kind: 'page', id: mid.id }, position: pos }),
    ).toEqual({ ok: false, code: 'move_cycle' });
  });

  it('respects locks on the page, the old parent and the new parent', () => {
    const { reader, root, mid, leaf } = tree();
    reader.set('page', mid.id, { ...mid, isLocked: true });
    expect(
      run(reader, 'page.move', {
        id: leaf.id,
        parent: { kind: 'page', id: root.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_locked' });
    expect(
      run(reader, 'page.move', { id: mid.id, parent: { kind: 'private', id: ME }, position: pos }),
    ).toEqual({ ok: false, code: 'page_locked' });
    const other = page();
    reader.set('page', other.id, other);
    expect(
      run(reader, 'page.move', {
        id: other.id,
        parent: { kind: 'page', id: mid.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_locked' });
  });

  it('rejects moves into, out of or within a moving subtree', () => {
    const { reader, root, mid, leaf } = tree();
    reader.set('page', mid.id, { ...mid, moveState: 'moving' });
    expect(
      run(reader, 'page.move', {
        id: leaf.id,
        parent: { kind: 'page', id: root.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_moving' });
    const other = page();
    reader.set('page', other.id, other);
    expect(
      run(reader, 'page.move', {
        id: other.id,
        parent: { kind: 'page', id: leaf.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_moving' });
    expect(
      run(reader, 'page.move', {
        id: other.id,
        parent: { kind: 'page', id: mid.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_moving' });
  });

  it('rejects trashed targets', () => {
    const { reader, root, leaf } = tree();
    reader.set('page', root.id, { ...root, deletedAt: ctx.now });
    expect(
      run(reader, 'page.move', {
        id: leaf.id,
        parent: { kind: 'page', id: root.id },
        position: pos,
      }),
    ).toEqual({ ok: false, code: 'page_in_trash' });
  });
});

describe('page.trash / restore / purge', () => {
  it('trashes the root of a subtree', () => {
    const { reader, mid } = tree();
    const trashed = upserted(run(reader, 'page.trash', { id: mid.id }), 'page');
    expect(trashed).toMatchObject({ deletedAt: ctx.now, deletedRootId: mid.id });
  });

  it('refuses locked pages or children of locked pages', () => {
    const { reader, root, mid } = tree();
    reader.set('page', mid.id, { ...mid, isLocked: true });
    expect(run(reader, 'page.trash', { id: mid.id })).toEqual({ ok: false, code: 'page_locked' });
    reader.set('page', mid.id, mid).set('page', root.id, { ...root, isLocked: true });
    expect(run(reader, 'page.trash', { id: mid.id })).toEqual({ ok: false, code: 'page_locked' });
  });

  it('restores to the original parent when it is alive', () => {
    const { reader, mid, leaf } = tree();
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now, deletedRootId: leaf.id });
    const restored = upserted(run(reader, 'page.restore', { id: leaf.id }), 'page');
    expect(restored).toMatchObject({
      deletedAt: null,
      deletedRootId: null,
      parentKind: 'page',
      parentId: mid.id,
    });
  });

  it('falls back to the section root when the parent is gone or trashed', () => {
    const { reader, mid, leaf } = tree();
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now, deletedRootId: leaf.id });
    reader.set('page', mid.id, { ...mid, deletedAt: ctx.now, deletedRootId: mid.id });
    expect(upserted(run(reader, 'page.restore', { id: leaf.id }), 'page')).toMatchObject({
      parentKind: 'teamspace',
      parentId: TS,
    });
    reader.data.delete(`page/${mid.id}`);
    expect(upserted(run(reader, 'page.restore', { id: leaf.id }), 'page')).toMatchObject({
      parentKind: 'teamspace',
      parentId: TS,
    });
  });

  it("falls back to the owner's private section, or the restorer's", () => {
    const { reader, leaf } = tree();
    const owner = newId();
    reader.set('page', leaf.id, {
      ...leaf,
      parentId: newId(),
      deletedAt: ctx.now,
      deletedRootId: leaf.id,
    });
    reader.sections.set(leaf.id, { kind: 'private', id: owner });
    expect(upserted(run(reader, 'page.restore', { id: leaf.id }), 'page')).toMatchObject({
      parentKind: 'private',
      parentId: owner,
    });
    reader.sections.set(leaf.id, { kind: 'teamspace', id: newId() });
    expect(upserted(run(reader, 'page.restore', { id: leaf.id }), 'page')).toMatchObject({
      parentKind: 'private',
      parentId: ME,
    });
  });

  it('keeps an unknown parent on the client', () => {
    const reader = new MapReader(false);
    const p = page({ parentKind: 'page', parentId: newId(), deletedAt: ctx.now });
    reader.set('page', p.id, { ...p, deletedRootId: p.id });
    expect(upserted(run(reader, 'page.restore', { id: p.id }), 'page').parentId).toBe(p.parentId);
  });

  it('only restores or purges trash roots', () => {
    const { reader, mid, leaf } = tree();
    expect(run(reader, 'page.restore', { id: leaf.id })).toEqual({
      ok: false,
      code: 'page_not_in_trash',
    });
    expect(run(reader, 'page.purge', { id: leaf.id })).toEqual({
      ok: false,
      code: 'page_not_in_trash',
    });
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now, deletedRootId: mid.id });
    expect(run(reader, 'page.restore', { id: leaf.id })).toEqual({
      ok: false,
      code: 'page_not_in_trash',
    });
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now, deletedRootId: leaf.id });
    expect(single(run(reader, 'page.purge', { id: leaf.id }))).toEqual({
      type: 'page',
      id: leaf.id,
      op: 'delete',
    });
    expect(run(reader, 'page.purge', { id: newId() })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('page.duplicate', () => {
  it('copies the page under a new id', () => {
    const { reader, mid } = tree();
    const newPageId = newId();
    const copy = upserted(
      run(reader, 'page.duplicate', { id: mid.id, newId: newPageId, position: pos }),
      'page',
    );
    expect(copy).toMatchObject({
      id: newPageId,
      title: 'mid',
      parentId: mid.parentId,
      position: pos,
      createdBy: ME,
      createdAt: ctx.now,
    });
  });

  it('rejects a taken id, a locked parent or a moving page', () => {
    const { reader, root, mid, leaf } = tree();
    expect(run(reader, 'page.duplicate', { id: mid.id, newId: leaf.id, position: pos }).ok).toBe(
      false,
    );
    reader.set('page', root.id, { ...root, isLocked: true });
    expect(run(reader, 'page.duplicate', { id: mid.id, newId: newId(), position: pos })).toEqual({
      ok: false,
      code: 'page_locked',
    });
    reader.set('page', root.id, root).set('page', mid.id, { ...mid, moveState: 'moving' });
    expect(run(reader, 'page.duplicate', { id: leaf.id, newId: newId(), position: pos })).toEqual({
      ok: false,
      code: 'page_moving',
    });
  });
});

describe('favorites and follows', () => {
  it('adds, moves and removes favorites', () => {
    const { reader, leaf } = tree();
    expect(
      upserted(run(reader, 'favorite.add', { pageId: leaf.id, position: pos }), 'favorite'),
    ).toEqual({ pageId: leaf.id, position: pos });
    expect(run(reader, 'favorite.move', { pageId: leaf.id, position: pos })).toEqual({
      ok: false,
      code: 'not_found',
    });
    reader.set('favorite', leaf.id, { pageId: leaf.id, position: pos });
    const next = positionBetween(pos, null);
    expect(
      upserted(run(reader, 'favorite.move', { pageId: leaf.id, position: next }), 'favorite')
        .position,
    ).toBe(next);
    expect(single(run(reader, 'favorite.remove', { pageId: leaf.id }))).toMatchObject({
      op: 'delete',
      type: 'favorite',
    });
  });

  it('follows and unfollows', () => {
    const { reader, leaf } = tree();
    expect(upserted(run(reader, 'follow.add', { pageId: leaf.id }), 'follow')).toEqual({
      pageId: leaf.id,
    });
    expect(single(run(reader, 'follow.remove', { pageId: leaf.id }))).toMatchObject({
      op: 'delete',
      type: 'follow',
    });
  });

  it('refuses to favorite or follow trashed pages', () => {
    const { reader, leaf } = tree();
    reader.set('page', leaf.id, { ...leaf, deletedAt: ctx.now });
    expect(run(reader, 'favorite.add', { pageId: leaf.id, position: pos })).toEqual({
      ok: false,
      code: 'page_in_trash',
    });
    expect(run(reader, 'follow.add', { pageId: leaf.id })).toEqual({
      ok: false,
      code: 'page_in_trash',
    });
  });
});

describe('permissions and public links', () => {
  it('grants and revokes', () => {
    const { reader, leaf } = tree();
    const user = newId();
    const change = single(
      run(reader, 'permission.grant', {
        pageId: leaf.id,
        principal: { kind: 'user', id: user },
        level: 'can_comment',
      }),
    );
    expect(change).toEqual({
      type: 'grant',
      id: `${leaf.id}:user:${user}`,
      op: 'upsert',
      data: { pageId: leaf.id, principalKind: 'user', principalId: user, level: 'can_comment' },
    });
    expect(
      single(
        run(reader, 'permission.revoke', {
          pageId: leaf.id,
          principal: { kind: 'user', id: user },
        }),
      ),
    ).toEqual({
      type: 'grant',
      id: `${leaf.id}:user:${user}`,
      op: 'delete',
    });
    expect(
      run(reader, 'permission.grant', {
        pageId: newId(),
        principal: { kind: 'user', id: user },
        level: 'can_view',
      }),
    ).toEqual({ ok: false, code: 'not_found' });
  });

  it('sets restrict inheritance', () => {
    const { reader, leaf } = tree();
    expect(
      upserted(run(reader, 'permission.setRestrict', { pageId: leaf.id, restrict: true }), 'page')
        .restrictInheritance,
    ).toBe(true);
  });

  it('recovers access as a full-access grant for the actor', () => {
    const { reader, leaf } = tree();
    expect(upserted(run(reader, 'permission.recover', { pageId: leaf.id }), 'grant')).toEqual({
      pageId: leaf.id,
      principalKind: 'user',
      principalId: ME,
      level: 'full_access',
    });
  });

  it('enables and disables a public link', () => {
    const { reader, leaf } = tree();
    expect(
      upserted(
        run(reader, 'publicLink.set', { pageId: leaf.id, enabled: true, includeSubpages: true }),
        'publicLink',
      ),
    ).toEqual({ pageId: leaf.id, includeSubpages: true });
    expect(
      single(run(reader, 'publicLink.set', { pageId: leaf.id, enabled: false })),
    ).toMatchObject({ op: 'delete', type: 'publicLink' });
  });
});

describe('workspace, teamspaces and members', () => {
  function setup() {
    const { reader } = tree();
    reader.set('workspace', WS, { id: WS, name: 'W', icon: null });
    return reader;
  }

  it('updates the workspace', () => {
    const reader = setup();
    expect(upserted(run(reader, 'workspace.update', { name: 'New' }), 'workspace')).toEqual({
      id: WS,
      name: 'New',
      icon: null,
    });
    expect(run(new MapReader(), 'workspace.update', { name: 'x' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('creates a teamspace owned by the actor', () => {
    const reader = setup();
    const id = newId();
    const result = run(reader, 'teamspace.create', { id, name: 'Eng' });
    expect(result.ok && result.changes.map((c) => c.type)).toEqual([
      'teamspace',
      'teamspaceMember',
    ]);
    expect(result.ok && result.changes[1]).toMatchObject({
      op: 'upsert',
      data: { teamspaceId: id, userId: ME, role: 'owner' },
    });
    expect(run(reader, 'teamspace.create', { id: TS, name: 'dup' })).toEqual({
      ok: false,
      code: 'validation_failed',
    });
  });

  it('updates teamspaces and their members', () => {
    const reader = setup();
    expect(
      upserted(run(reader, 'teamspace.update', { id: TS, visibility: 'private' }), 'teamspace')
        .visibility,
    ).toBe('private');
    expect(run(reader, 'teamspace.update', { id: newId(), name: 'x' })).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(upserted(run(reader, 'teamspace.join', { teamspaceId: TS }), 'teamspaceMember')).toEqual(
      { teamspaceId: TS, userId: ME, role: 'member' },
    );
    reader.set('teamspaceMember', `${TS}:${ME}`, { teamspaceId: TS, userId: ME, role: 'member' });
    expect(run(reader, 'teamspace.join', { teamspaceId: TS })).toEqual({
      ok: false,
      code: 'already_member',
    });
    expect(run(reader, 'teamspace.addMember', { teamspaceId: TS, userId: ME })).toEqual({
      ok: false,
      code: 'already_member',
    });
    const other = newId();
    expect(
      upserted(
        run(reader, 'teamspace.addMember', { teamspaceId: TS, userId: other }),
        'teamspaceMember',
      ).role,
    ).toBe('member');
    expect(
      run(reader, 'teamspace.setMemberRole', { teamspaceId: TS, userId: other, role: 'owner' }),
    ).toEqual({ ok: false, code: 'not_found' });
    expect(
      upserted(
        run(reader, 'teamspace.setMemberRole', { teamspaceId: TS, userId: ME, role: 'owner' }),
        'teamspaceMember',
      ).role,
    ).toBe('owner');
    expect(
      single(run(reader, 'teamspace.removeMember', { teamspaceId: TS, userId: ME })),
    ).toMatchObject({ op: 'delete', id: `${TS}:${ME}` });
  });

  it('changes roles and removes members', () => {
    const reader = setup();
    const user = newId();
    expect(run(reader, 'member.setRole', { userId: user, role: 'admin' })).toEqual({
      ok: false,
      code: 'not_found',
    });
    reader.set('member', user, { userId: user, email: 'a@b.c', name: 'A', role: 'member' });
    expect(
      upserted(run(reader, 'member.setRole', { userId: user, role: 'admin' }), 'member').role,
    ).toBe('admin');
    expect(single(run(reader, 'member.remove', { userId: user }))).toEqual({
      type: 'member',
      id: user,
      op: 'delete',
    });
  });
});

describe('knownAncestors', () => {
  it('walks parents nearest first and stops at unknown ones', () => {
    const { reader, root, mid, leaf } = tree();
    expect(knownAncestors(reader, leaf).map((p) => p.id)).toEqual([mid.id, root.id]);
    reader.data.delete(`page/${mid.id}`);
    expect(knownAncestors(reader, leaf)).toEqual([]);
  });
});
