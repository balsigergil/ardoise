// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  applyMutation,
  newId,
  positionBetween,
  type AnyMutation,
  type Change,
  type ChangeEntry,
  type EntityMap,
  type EntityReader,
  type EntityType,
  type MutationResult,
  type PageDto,
  type PullResponse,
} from '@ardoise/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DexiePersistence } from './persistence.js';
import { SyncError, SyncStore, type SyncEvent, type SyncTransport } from './store.js';

const WS = newId();
const ME = newId();
const TS = newId();
const TEAMSPACE = { kind: 'teamspace' as const, id: TS };

/**
 * A tiny in-memory server: applies mutations with the shared apply functions and
 * keeps a change log, so client behaviour can be tested end to end.
 */
class FakeServer implements SyncTransport {
  entities = new Map<string, unknown>();
  log: ChangeEntry[] = [];
  seq = 0;
  pushes: AnyMutation[][] = [];
  failNextPush = false;
  rejectNames = new Set<string>();
  resyncBelow = 0;
  pullCalls = 0;
  private applied = new Map<string, MutationResult>();

  reader(): EntityReader {
    return {
      authoritative: true,
      get: <T extends EntityType>(type: T, id: string) =>
        this.entities.get(`${type}/${id}`) as EntityMap[T] | undefined,
    };
  }

  write(changes: Change[]): number {
    for (const c of changes) {
      this.seq++;
      const k = `${c.type}/${c.id}`;
      if (c.op === 'upsert') this.entities.set(k, c.data);
      else this.entities.delete(k);
      this.log.push({ ...c, seq: this.seq });
    }
    return this.seq;
  }

  /** Another user's change. */
  external(changes: Change[]): number {
    return this.write(changes);
  }

  push(mutations: AnyMutation[]): Promise<MutationResult[]> {
    this.pushes.push(mutations);
    if (this.failNextPush) {
      this.failNextPush = false;
      return Promise.reject(new SyncError('network'));
    }
    return Promise.resolve(
      mutations.map((m) => {
        const previous = this.applied.get(m.id);
        if (previous) return previous;
        let result: MutationResult;
        if (this.rejectNames.has(m.name))
          result = { id: m.id, status: 'rejected', code: 'forbidden' };
        else {
          const r = applyMutation(this.reader(), m, {
            actorId: ME,
            workspaceId: WS,
            now: m.clientTime,
          });
          result = r.ok
            ? { id: m.id, status: 'applied', seq: this.write(r.changes) }
            : { id: m.id, status: 'rejected', code: r.code };
        }
        this.applied.set(m.id, result);
        return result;
      }),
    );
  }

  pull(since: number, limit: number): Promise<PullResponse> {
    this.pullCalls++;
    if (since < this.resyncBelow) return Promise.reject(new SyncError('resync_required'));
    const entries = this.log.filter((e) => e.seq > since).slice(0, limit);
    return Promise.resolve({
      entries,
      cursor: entries.at(-1)?.seq ?? since,
      hasMore: this.log.filter((e) => e.seq > since).length > limit,
    });
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

const upsert = (p: PageDto): Change => ({ type: 'page', id: p.id, op: 'upsert', data: p });

async function setup() {
  const server = new FakeServer();
  server.entities.set(`teamspace/${TS}`, {
    id: TS,
    name: 'T',
    icon: null,
    description: '',
    visibility: 'open',
    defaultLevel: 'can_edit',
  });
  const store = new SyncStore({ workspaceId: WS, actorId: ME, transport: server, retryMs: 10 });
  const events: SyncEvent[] = [];
  store.onEvent((e) => events.push(e));
  // The UI loads the teamspace root list first (scoped read at seq 0).
  store.ingestChildren(TEAMSPACE, [], server.seq, { first: true, complete: true });
  await store.start();
  return { server, store, events };
}

const settle = async (store: SyncStore) => {
  for (let i = 0; i < 5; i++) {
    await store.flush();
    await store.pull();
  }
};

describe('SyncStore: optimistic writes', () => {
  it('applies a mutation locally before the server answers, then confirms it', async () => {
    const { server, store } = await setup();
    const id = newId();
    const result = store.mutate('page.create', {
      id,
      parent: TEAMSPACE,
      position: positionBetween(null, null),
      title: 'Draft',
    });
    expect(result.ok).toBe(true);
    expect(store.get('page', id)?.title).toBe('Draft');
    expect(store.children(TEAMSPACE).map((p) => p.id)).toEqual([id]);
    await settle(store);
    expect(server.entities.has(`page/${id}`)).toBe(true);
    expect(store.pendingCount).toBe(0);
    expect(store.currentCursor).toBe(server.seq);
    expect(store.get('page', id)?.title).toBe('Draft');
  });

  it('rejects invalid input and local invariant violations without sending', async () => {
    const { server, store } = await setup();
    expect(store.mutate('page.trash', { id: 'nope' })).toEqual({
      ok: false,
      code: 'validation_failed',
    });
    const a = newId();
    store.mutate('page.create', {
      id: a,
      parent: TEAMSPACE,
      position: positionBetween(null, null),
    });
    const b = newId();
    store.mutate('page.create', {
      id: b,
      parent: { kind: 'page', id: a },
      position: positionBetween(null, null),
    });
    expect(
      store.mutate('page.move', {
        id: a,
        parent: { kind: 'page', id: b },
        position: positionBetween(null, null),
      }),
    ).toEqual({
      ok: false,
      code: 'move_cycle',
    });
    await settle(store);
    expect(server.pushes.flat().map((m) => m.name)).toEqual(['page.create', 'page.create']);
  });

  it('resolves settled() with the server answer', async () => {
    const { server, store } = await setup();
    server.rejectNames.add('page.update');
    const p = page();
    server.external([upsert(p)]);
    await store.pull();
    const created = store.mutate('page.create', {
      id: newId(),
      parent: TEAMSPACE,
      position: positionBetween(null, null),
    });
    const updated = store.mutate('page.update', { id: p.id, title: 'x' });
    if (!created.ok || !updated.ok) throw new Error('local rejection');
    const [a, b] = await Promise.all([
      store.settled(created.id),
      store.settled(updated.id),
      settle(store),
    ]);
    expect(a.status).toBe('applied');
    expect(b).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('queues mutations on entities it does not hold (partial cache)', async () => {
    const { server, store } = await setup();
    const p = page();
    server.entities.set(`page/${p.id}`, p);
    expect(store.mutate('page.update', { id: p.id, title: 'Remote' }).ok).toBe(true);
    await settle(store);
    expect((server.entities.get(`page/${p.id}`) as PageDto).title).toBe('Remote');
  });

  it('rolls back and reports server rejections', async () => {
    const { server, store, events } = await setup();
    const p = page({ title: 'Original' });
    server.external([upsert(p)]);
    await store.pull();
    server.rejectNames.add('page.update');
    store.mutate('page.update', { id: p.id, title: 'Mine' });
    expect(store.get('page', p.id)?.title).toBe('Mine');
    await settle(store);
    expect(store.get('page', p.id)?.title).toBe('Original');
    expect(events).toContainEqual(expect.objectContaining({ type: 'rejected', code: 'forbidden' }));
  });

  it('keeps pending mutations across network failures and retries with the same ids', async () => {
    const { server, store, events } = await setup();
    server.failNextPush = true;
    const id = newId();
    store.mutate('page.create', { id, parent: TEAMSPACE, position: positionBetween(null, null) });
    await store.flush();
    expect(store.status).toBe('offline');
    expect(store.pendingCount).toBe(1);
    expect(store.get('page', id)).toBeDefined();
    await vi.waitFor(() => expect(server.entities.has(`page/${id}`)).toBe(true));
    expect(server.pushes[0]![0]!.id).toBe(server.pushes[1]![0]!.id);
    await settle(store);
    expect(events.some((e) => e.type === 'status' && e.status === 'offline')).toBe(true);
    expect(store.status).toBe('idle');
  });
});

describe('SyncStore: rebase', () => {
  it('replays pending mutations on top of newer server state', async () => {
    const { server, store } = await setup();
    const p = page({ title: 'v1' });
    server.external([upsert(p)]);
    await store.pull();
    // A pending local rename, then a concurrent remote icon change arrives first.
    server.failNextPush = true;
    store.mutate('page.update', { id: p.id, title: 'mine' });
    await store.flush();
    server.external([upsert({ ...p, title: 'theirs', icon: { type: 'emoji', value: '🌱' } })]);
    await store.pull();
    expect(store.get('page', p.id)).toMatchObject({
      title: 'mine',
      icon: { type: 'emoji', value: '🌱' },
    });
    await settle(store);
    // Server arrival order: the local rename landed last.
    expect(store.get('page', p.id)).toMatchObject({
      title: 'mine',
      icon: { type: 'emoji', value: '🌱' },
    });
  });

  it('drops a pending move that became invalid after a remote change', async () => {
    const { server, store } = await setup();
    const a = page();
    const b = page();
    server.external([upsert(a), upsert(b)]);
    await store.pull();
    server.failNextPush = true;
    store.mutate('page.move', {
      id: a.id,
      parent: { kind: 'page', id: b.id },
      position: positionBetween(null, null),
    });
    await store.flush();
    // Remotely, b moved under a: the pending move would now create a cycle.
    server.external([upsert({ ...b, parentKind: 'page', parentId: a.id })]);
    await store.pull();
    expect(store.get('page', a.id)?.parentId).toBe(TS);
    await settle(store);
    expect(store.get('page', a.id)?.parentId).toBe(TS);
  });
});

describe('SyncStore: entries and scoped reads', () => {
  it('ignores data older than what it holds (per-entity seq)', async () => {
    const { server, store } = await setup();
    const p = page({ title: 'new' });
    const seq = server.external([upsert(p)]);
    await store.pull();
    store.ingest([upsert({ ...p, title: 'stale' })], seq - 1);
    expect(store.get('page', p.id)?.title).toBe('new');
    store.ingest([upsert({ ...p, title: 'fresh read' })], seq + 1);
    expect(store.get('page', p.id)?.title).toBe('fresh read');
  });

  it('keeps tombstones so an older read cannot resurrect a deleted entity', async () => {
    const { server, store } = await setup();
    const p = page({ deletedAt: '2026-01-02T00:00:00.000Z', deletedRootId: null });
    server.external([upsert(p)]);
    const seq = server.external([{ type: 'page', id: p.id, op: 'delete' }]);
    await store.pull();
    store.ingest([upsert(p)], seq - 1);
    expect(store.get('page', p.id)).toBeUndefined();
  });

  it('keeps only entries in its scope: known entities, loaded lists, favorites', async () => {
    const { server, store } = await setup();
    const inLoaded = page();
    const elsewhere = page({ parentKind: 'page', parentId: newId() });
    server.external([upsert(inLoaded), upsert(elsewhere)]);
    await store.pull();
    expect(store.get('page', inLoaded.id)).toBeDefined();
    expect(store.get('page', elsewhere.id)).toBeUndefined();
    server.external([
      {
        type: 'favorite',
        id: elsewhere.id,
        op: 'upsert',
        data: { pageId: elsewhere.id, position: 'a0' },
      },
    ]);
    server.external([upsert({ ...elsewhere, title: 'fav' })]);
    await store.pull();
    expect(store.get('page', elsewhere.id)?.title).toBe('fav');
  });

  it('replaces a fully loaded children list and tracks hasChildren', async () => {
    const { store } = await setup();
    const parent = page({ hasChildren: true });
    const kid = page({ parentKind: 'page', parentId: parent.id });
    const gone = page({ parentKind: 'page', parentId: parent.id });
    store.ingestChildren(TEAMSPACE, [parent], 1, { first: true, complete: true });
    expect(store.hasChildren(store.get('page', parent.id)!)).toBe(true);
    store.ingestChildren({ kind: 'page', id: parent.id }, [kid, gone], 1, {
      first: true,
      complete: true,
    });
    store.ingestChildren({ kind: 'page', id: parent.id }, [kid], 2, {
      first: true,
      complete: true,
    });
    expect(store.children({ kind: 'page', id: parent.id }).map((p) => p.id)).toEqual([kid.id]);
    store.ingestChildren({ kind: 'page', id: parent.id }, [], 3, { first: true, complete: true });
    expect(store.hasChildren(store.get('page', parent.id)!)).toBe(false);
  });

  it('hides trashed pages and their subtree from children lists', async () => {
    const { server, store } = await setup();
    const parent = page();
    server.external([upsert(parent)]);
    await store.pull();
    store.mutate('page.trash', { id: parent.id });
    expect(store.children(TEAMSPACE)).toEqual([]);
    expect(store.isTrashed(parent.id)).toBe(true);
  });

  it('emits access entries and evicts on demand', async () => {
    const { server, store, events } = await setup();
    const parent = page();
    const kid = page({ parentKind: 'page', parentId: parent.id });
    server.external([upsert(parent)]);
    await store.pull();
    store.ingestChildren({ kind: 'page', id: parent.id }, [kid], server.seq, {
      first: true,
      complete: true,
    });
    server.external([
      {
        type: 'access',
        id: 'x',
        op: 'upsert',
        data: { scope: 'page', id: parent.id, userIds: null },
      },
    ]);
    await store.pull();
    expect(events).toContainEqual({
      type: 'access',
      access: { scope: 'page', id: parent.id, userIds: null },
    });
    store.evict(parent.id);
    expect(store.get('page', parent.id)).toBeUndefined();
    expect(store.get('page', kid.id)).toBeUndefined();
  });

  it('pulls on pokes ahead of its cursor, through every page', async () => {
    const { server, store } = await setup();
    for (let i = 0; i < 1200; i++) server.external([upsert(page({ title: `p${i}` }))]);
    store.poke(server.seq);
    await vi.waitFor(() => expect(store.currentCursor).toBe(server.seq));
    expect(store.children(TEAMSPACE)).toHaveLength(1200);
    const calls = server.pullCalls;
    store.poke(server.seq);
    expect(server.pullCalls).toBe(calls);
  });

  it('resyncs when the cursor is too old, keeping pending writes', async () => {
    const { server, store, events } = await setup();
    const p = page();
    server.external([upsert(p)]);
    await store.pull();
    server.failNextPush = true;
    const id = newId();
    store.mutate('page.create', { id, parent: TEAMSPACE, position: positionBetween(null, null) });
    await store.flush();
    server.resyncBelow = server.seq + 1;
    server.external([upsert({ ...p, title: 'later' })]);
    await store.pull();
    expect(events).toContainEqual({ type: 'resync' });
    expect(store.get('page', p.id)).toBeUndefined();
    expect(store.get('page', id)).toBeDefined();
    expect(store.currentCursor).toBeNull();
  });
});

describe('SyncStore: persistence', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('survives a reload with pending writes, the cursor and favorites', async () => {
    const server = new FakeServer();
    const persistence = new DexiePersistence(ME, WS);
    const store = new SyncStore({ workspaceId: WS, actorId: ME, transport: server, persistence });
    store.ingestChildren(TEAMSPACE, [], 0, { first: true, complete: true });
    await store.start();
    const fav = page({ title: 'Favorite' });
    const other = page({ title: 'Other' });
    server.external([
      upsert(fav),
      upsert(other),
      { type: 'favorite', id: fav.id, op: 'upsert', data: { pageId: fav.id, position: 'a0' } },
    ]);
    await store.pull();
    server.failNextPush = true;
    store.mutate('page.update', { id: fav.id, title: 'Renamed offline' });
    await store.flush();
    await vi.advanceTimersByTimeAsync(300);
    store.stop();

    const reloaded = new SyncStore({
      workspaceId: WS,
      actorId: ME,
      transport: server,
      persistence,
    });
    const state = await persistence.load();
    expect(state?.cursor).toBe(server.seq);
    expect(state?.pending).toHaveLength(1);
    expect(state?.entities.map((e) => e.type).sort()).toEqual(['favorite', 'page']);
    await reloaded.start();
    expect(reloaded.get('page', fav.id)?.title).toBe('Renamed offline');
    expect(reloaded.get('page', other.id)).toBeUndefined();
    await settle(reloaded);
    expect((server.entities.get(`page/${fav.id}`) as PageDto).title).toBe('Renamed offline');
    reloaded.stop();
    await persistence.clear();
    persistence.close();
  });
});
