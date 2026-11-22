// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client store (ARCHITECTURE §8.1–8.2): normalized entities, optimistic apply through
 * the shared apply functions, a pending queue, rebase on pull, per-entity seqs and
 * rejection events. Framework-free; React binds to it with `subscribe` + `version`.
 */
import {
  applyMutation,
  compareSiblings,
  isErrorCode,
  MAX_PUSH_BATCH,
  mutationArgs,
  newId,
  parentKey,
  type AccessEntityDto,
  type AnyMutation,
  type Change,
  type ChangeEntry,
  type EntityMap,
  type EntityReader,
  type EntityType,
  type ErrorCode,
  type MutationInput,
  type MutationName,
  type MutationResult,
  type PageDto,
  type PageParent,
  type PullResponse,
} from '@ardoise/shared';

export interface SyncTransport {
  push(mutations: AnyMutation[]): Promise<MutationResult[]>;
  /** Throws a `SyncError('resync_required')` when the cursor is too old. */
  pull(since: number, limit: number): Promise<PullResponse>;
}

export class SyncError extends Error {
  constructor(readonly code: ErrorCode | 'network') {
    super(code);
    this.name = 'SyncError';
  }
}

interface Stored {
  data: unknown;
  seq: number;
  /** Tombstone: deleted at `seq`, kept so older reads cannot resurrect it. */
  deleted?: true;
}

export interface PendingMutation {
  mutation: AnyMutation;
  /** Seq of the server entries once applied; dropped when the cursor reaches it. */
  appliedSeq?: number;
}

export interface PersistedState {
  cursor: number | null;
  entities: { type: EntityType; id: string; data: unknown; seq: number }[];
  pending: PendingMutation[];
}

export interface SyncPersistence {
  load(): Promise<PersistedState | undefined>;
  save(state: PersistedState): Promise<void>;
  clear(): Promise<void>;
}

export type SyncEvent =
  | { type: 'rejected'; mutation: AnyMutation; code: ErrorCode }
  | { type: 'access'; access: AccessEntityDto }
  | { type: 'resync' }
  | { type: 'status'; status: SyncStatus }
  /** Entity types changed by pulled entries (for caches outside the store). */
  | { type: 'changed'; types: ReadonlySet<EntityType> };

export type SyncStatus = 'idle' | 'syncing' | 'offline';

export interface SyncStoreOptions {
  workspaceId: string;
  actorId: string;
  transport: SyncTransport;
  persistence?: SyncPersistence;
  now?: () => Date;
  /** Retry delay after a network failure (ms). */
  retryMs?: number;
}

const key = (type: EntityType, id: string) => `${type}/${id}`;
const PULL_LIMIT = 500;

/** Entity types kept even when not already known (small, per-user or per-workspace). */
const ALWAYS_KEPT = new Set<EntityType>(['workspace', 'teamspace', 'favorite', 'follow']);

export class SyncStore {
  readonly workspaceId: string;
  readonly actorId: string;
  private readonly transport: SyncTransport;
  private readonly persistence: SyncPersistence | undefined;
  private readonly now: () => Date;
  private readonly retryMs: number;

  private confirmed = new Map<string, Stored>();
  private pending: PendingMutation[] = [];
  private view = new Map<string, unknown>();
  private childIndex = new Map<string, PageDto[]>();
  /** Parents with at least one fetched page of children: their new children are kept. */
  private readonly listedParents = new Set<string>();
  /** Parents whose children were fetched completely. */
  private readonly completeParents = new Set<string>();
  private readonly settlers = new Map<string, ((result: MutationResult) => void)[]>();
  private cursor: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: SyncEvent) => void>();
  private flushing: Promise<void> | undefined;
  private pulling: Promise<void> | undefined;
  private pullAgain = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private statusValue: SyncStatus = 'idle';
  private disposed = false;
  /** Bumped on every change, for `useSyncExternalStore`. */
  version = 0;

  constructor(options: SyncStoreOptions) {
    this.workspaceId = options.workspaceId;
    this.actorId = options.actorId;
    this.transport = options.transport;
    this.persistence = options.persistence;
    this.now = options.now ?? (() => new Date());
    this.retryMs = options.retryMs ?? 3000;
  }

  // --- lifecycle ------------------------------------------------------------------

  private restored = false;

  /**
   * Restores the persisted state (first start only), then pushes leftovers and pulls.
   * `stop()` then `start()` again resumes (React strict mode mounts effects twice).
   */
  async start(): Promise<void> {
    this.disposed = false;
    if (this.restored) {
      void this.flush();
      if (this.cursor !== null) void this.pull();
      return;
    }
    this.restored = true;
    const state = await this.persistence?.load().catch(() => undefined);
    if (state && this.cursor === null && this.confirmed.size === 0) {
      this.cursor = state.cursor;
      for (const e of state.entities)
        this.confirmed.set(key(e.type, e.id), { data: e.data, seq: e.seq });
      this.pending = state.pending;
      this.recompute();
    }
    void this.flush();
    if (this.cursor !== null) void this.pull();
  }

  /** Stops background work (retries, saves); listeners are left to their owners. */
  stop(): void {
    this.disposed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.persistence?.save(this.snapshot()).catch(() => undefined);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  get status(): SyncStatus {
    return this.statusValue;
  }

  get currentCursor(): number | null {
    return this.cursor;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  // --- subscriptions ----------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  onEvent(listener: (event: SyncEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: SyncEvent): void {
    for (const l of this.eventListeners) l(event);
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.statusValue) return;
    this.statusValue = status;
    this.emit({ type: 'status', status });
    this.notify();
  }

  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // --- reads ----------------------------------------------------------------------

  get<T extends EntityType>(type: T, id: string): EntityMap[T] | undefined {
    return this.view.get(key(type, id)) as EntityMap[T] | undefined;
  }

  /** Live children of a parent, in sibling order. */
  children(parent: PageParent): PageDto[] {
    return this.childIndex.get(parentKey(parent)) ?? [];
  }

  isListed(parent: PageParent): boolean {
    return this.listedParents.has(parentKey(parent));
  }

  /** True when the page has live children (known locally or reported by the server). */
  hasChildren(page: PageDto): boolean {
    const known = this.childIndex.get(parentKey({ kind: 'page', id: page.id }));
    if (known && known.length > 0) return true;
    if (this.completeParents.has(parentKey({ kind: 'page', id: page.id }))) return false;
    return page.hasChildren;
  }

  all<T extends EntityType>(type: T): EntityMap[T][] {
    const prefix = `${type}/`;
    const out: EntityMap[T][] = [];
    for (const [k, v] of this.view) if (k.startsWith(prefix)) out.push(v as EntityMap[T]);
    return out;
  }

  /** Ancestors known locally, nearest first. */
  ancestors(pageId: string): PageDto[] {
    const out: PageDto[] = [];
    let page = this.get('page', pageId);
    while (page && page.parentKind === 'page' && out.length < 1000) {
      const parent = this.get('page', page.parentId);
      if (!parent) break;
      out.push(parent);
      page = parent;
    }
    return out;
  }

  /** True if the page or a known ancestor is in the trash. */
  isTrashed(pageId: string): boolean {
    const page = this.get('page', pageId);
    if (!page) return false;
    return page.deletedAt !== null || this.ancestors(pageId).some((p) => p.deletedAt !== null);
  }

  // --- writes ---------------------------------------------------------------------

  /**
   * Validates, applies optimistically and queues a mutation. Local rejections (for
   * example a cycle visible in the cache) are reported immediately and not sent.
   */
  mutate<N extends MutationName>(
    name: N,
    input: MutationInput[N],
  ): { ok: true; id: string } | { ok: false; code: ErrorCode } {
    const parsed = mutationArgs[name].safeParse(input);
    if (!parsed.success) return { ok: false, code: 'validation_failed' };
    const mutation = {
      id: newId(),
      workspaceId: this.workspaceId,
      name,
      args: parsed.data,
      clientTime: this.now().toISOString(),
    } as AnyMutation;
    const result = applyMutation(this.reader(this.view), mutation, this.context());
    // The cache is partial: an entity it does not hold may well exist on the server,
    // so `not_found` is the server's call. The mutation is queued without local effect.
    if (!result.ok && result.code !== 'not_found') return { ok: false, code: result.code };
    this.pending.push({ mutation });
    this.recompute();
    this.scheduleSave();
    void this.flush();
    return { ok: true, id: mutation.id };
  }

  /** Resolves with the server's answer for a mutation queued by `mutate`. */
  settled(id: string): Promise<MutationResult> {
    return new Promise((resolve) => {
      const list = this.settlers.get(id) ?? [];
      list.push(resolve);
      this.settlers.set(id, list);
    });
  }

  private settle(result: MutationResult): void {
    const list = this.settlers.get(result.id);
    if (!list) return;
    this.settlers.delete(result.id);
    for (const resolve of list) resolve(result);
  }

  /** Pushes pending mutations in order, one batch in flight at a time. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    for (;;) {
      if (this.disposed) return;
      const batch = this.pending.filter((p) => p.appliedSeq === undefined).slice(0, MAX_PUSH_BATCH);
      if (batch.length === 0) return;
      let results: MutationResult[];
      try {
        this.setStatus('syncing');
        results = await this.transport.push(batch.map((p) => p.mutation));
      } catch {
        this.setStatus('offline');
        this.scheduleRetry();
        return;
      }
      let maxSeq = 0;
      for (const result of results) {
        const index = this.pending.findIndex((p) => p.mutation.id === result.id);
        if (index < 0) continue;
        const entry = this.pending[index]!;
        this.settle(result);
        if (result.status === 'rejected') {
          this.pending.splice(index, 1);
          const code = result.code && isErrorCode(result.code) ? result.code : 'internal_error';
          this.emit({ type: 'rejected', mutation: entry.mutation, code });
        } else if (result.seq === undefined) {
          this.pending.splice(index, 1);
        } else {
          entry.appliedSeq = result.seq;
          maxSeq = Math.max(maxSeq, result.seq);
        }
      }
      this.dropConfirmed();
      this.recompute();
      this.scheduleSave();
      this.setStatus('idle');
      if (maxSeq > (this.cursor ?? 0)) await this.pull();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush();
      void this.pull();
    }, this.retryMs);
  }

  // --- pull -----------------------------------------------------------------------

  /** A poke: pull when the server is ahead. */
  poke(seq: number): void {
    if (this.cursor === null || seq > this.cursor) void this.pull();
  }

  /** Pulls until caught up; concurrent calls coalesce into one more round. */
  pull(): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }
    this.pulling = this.doPull().finally(() => {
      this.pulling = undefined;
      if (this.pullAgain) {
        this.pullAgain = false;
        void this.pull();
      }
    });
    return this.pulling;
  }

  private async doPull(): Promise<void> {
    if (this.cursor === null) return;
    for (;;) {
      if (this.disposed) return;
      let response: PullResponse;
      try {
        response = await this.transport.pull(this.cursor ?? 0, PULL_LIMIT);
      } catch (error) {
        if (error instanceof SyncError && error.code === 'resync_required') {
          this.resync();
          return;
        }
        this.setStatus('offline');
        this.scheduleRetry();
        return;
      }
      this.applyEntries(response.entries);
      this.cursor = Math.max(this.cursor ?? 0, response.cursor);
      this.dropConfirmed();
      this.recompute();
      this.scheduleSave();
      if (this.statusValue === 'offline') this.setStatus('idle');
      if (!response.hasMore) return;
    }
  }

  /** Drops the cache (pending mutations survive) and asks the UI to reload its scopes. */
  private resync(): void {
    this.confirmed.clear();
    this.listedParents.clear();
    this.completeParents.clear();
    this.cursor = null;
    for (const p of this.pending) delete p.appliedSeq;
    this.recompute();
    this.scheduleSave();
    this.emit({ type: 'resync' });
    void this.flush();
  }

  private keeps(change: Change): boolean {
    const k = key(change.type, change.id);
    if (this.confirmed.has(k)) return true;
    if (change.op === 'delete') return false;
    if (ALWAYS_KEPT.has(change.type)) return true;
    if (change.type === 'teamspaceMember') return change.data.userId === this.actorId;
    if (change.type === 'page') {
      const page = change.data;
      return (
        this.listedParents.has(parentKey({ kind: page.parentKind, id: page.parentId })) ||
        this.confirmed.has(key('favorite', page.id))
      );
    }
    return false;
  }

  /** Applies pulled entries to the confirmed state (older-than-held data is ignored). */
  applyEntries(entries: readonly ChangeEntry[]): void {
    const types = new Set<EntityType>();
    for (const entry of entries) types.add(entry.type);
    if (types.size > 0) this.emit({ type: 'changed', types });
    for (const entry of entries) {
      if (entry.type === 'access') {
        if (entry.op === 'upsert') this.emit({ type: 'access', access: entry.data });
        continue;
      }
      if (!this.keeps(entry)) continue;
      const k = key(entry.type, entry.id);
      const held = this.confirmed.get(k);
      if (held && held.seq >= entry.seq) continue;
      this.confirmed.set(
        k,
        entry.op === 'upsert'
          ? { data: entry.data, seq: entry.seq }
          : { data: undefined, seq: entry.seq, deleted: true },
      );
    }
  }

  // --- scoped reads -----------------------------------------------------------------

  /** Ingests entities from a scoped read made at `seq` (§7). */
  ingest(changes: readonly Change[], seq: number): void {
    if (this.cursor === null) {
      this.cursor = seq;
      void this.pull();
    }
    for (const change of changes) {
      const k = key(change.type, change.id);
      const held = this.confirmed.get(k);
      if (held && held.seq > seq) continue;
      this.confirmed.set(
        k,
        change.op === 'upsert'
          ? { data: change.data, seq }
          : { data: undefined, seq, deleted: true },
      );
    }
    this.recompute();
    this.scheduleSave();
  }

  /**
   * Ingests one page of a parent's children. When `complete`, known children of that
   * parent absent from the response are dropped (moved away or no longer accessible).
   */
  ingestChildren(
    parent: PageParent,
    pages: readonly PageDto[],
    seq: number,
    options: { first: boolean; complete: boolean },
  ): void {
    const pk = parentKey(parent);
    if (options.first && options.complete) {
      const ids = new Set(pages.map((p) => p.id));
      for (const [k, stored] of this.confirmed) {
        if (!k.startsWith('page/') || stored.deleted || stored.seq > seq) continue;
        const page = stored.data as PageDto;
        if (parentKey({ kind: page.parentKind, id: page.parentId }) === pk && !ids.has(page.id))
          this.confirmed.delete(k);
      }
    }
    this.listedParents.add(pk);
    if (options.first && options.complete) this.completeParents.add(pk);
    else if (options.first) this.completeParents.delete(pk);
    this.ingest(
      pages.map((p) => ({ type: 'page', id: p.id, op: 'upsert', data: p })),
      seq,
    );
  }

  /** Forgets a page and its known descendants (lost access). */
  evict(pageId: string): void {
    const drop = new Set([pageId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [k, stored] of this.confirmed) {
        if (!k.startsWith('page/') || stored.deleted) continue;
        const page = stored.data as PageDto;
        if (page.parentKind === 'page' && drop.has(page.parentId) && !drop.has(page.id)) {
          drop.add(page.id);
          grew = true;
        }
      }
    }
    for (const id of drop) {
      this.confirmed.delete(key('page', id));
      this.listedParents.delete(parentKey({ kind: 'page', id }));
      this.completeParents.delete(parentKey({ kind: 'page', id }));
    }
    this.recompute();
    this.scheduleSave();
  }

  // --- internals --------------------------------------------------------------------

  private context() {
    return { actorId: this.actorId, workspaceId: this.workspaceId, now: this.now().toISOString() };
  }

  private reader(map: Map<string, unknown>): EntityReader {
    return {
      authoritative: false,
      get: <T extends EntityType>(type: T, id: string) =>
        map.get(key(type, id)) as EntityMap[T] | undefined,
    };
  }

  /** Pending mutations whose entries were pulled are part of the confirmed state now. */
  private dropConfirmed(): void {
    const cursor = this.cursor ?? 0;
    this.pending = this.pending.filter((p) => p.appliedSeq === undefined || p.appliedSeq > cursor);
  }

  /** Rebase (§8.2): confirmed state, then every pending mutation replayed on top. */
  private recompute(): void {
    const view = new Map<string, unknown>();
    for (const [k, stored] of this.confirmed) if (!stored.deleted) view.set(k, stored.data);
    const reader = this.reader(view);
    for (const { mutation } of this.pending) {
      const result = applyMutation(reader, mutation, {
        ...this.context(),
        now: mutation.clientTime,
      });
      if (!result.ok) continue;
      for (const change of result.changes) {
        const k = key(change.type, change.id);
        if (change.op === 'upsert') view.set(k, change.data);
        else view.delete(k);
      }
    }
    this.view = view;
    const index = new Map<string, PageDto[]>();
    for (const [k, value] of view) {
      if (!k.startsWith('page/')) continue;
      const page = value as PageDto;
      if (page.deletedAt !== null || page.isInline) continue;
      const pk = parentKey({ kind: page.parentKind, id: page.parentId });
      const list = index.get(pk);
      if (list) list.push(page);
      else index.set(pk, [page]);
    }
    for (const list of index.values()) list.sort(compareSiblings);
    this.childIndex = index;
    this.notify();
  }

  private scheduleSave(): void {
    if (!this.persistence || this.saveTimer || this.disposed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persistence?.save(this.snapshot()).catch(() => undefined);
    }, 250);
  }

  /** What survives a reload (§8.3): pending writes, the cursor and the small cached scope. */
  snapshot(): PersistedState {
    const favorites = new Set(
      [...this.confirmed.keys()]
        .filter((k) => k.startsWith('favorite/'))
        .map((k) => k.slice('favorite/'.length)),
    );
    const keepPage = new Set<string>();
    for (const id of favorites) {
      keepPage.add(id);
      for (const a of this.ancestors(id)) keepPage.add(a.id);
    }
    const entities: PersistedState['entities'] = [];
    for (const [k, stored] of this.confirmed) {
      if (stored.deleted) continue;
      const [type, ...rest] = k.split('/') as [EntityType, ...string[]];
      const id = rest.join('/');
      if (type === 'page' && !keepPage.has(id)) continue;
      if (type === 'grant' || type === 'member' || type === 'publicLink') continue;
      entities.push({ type, id, data: stored.data, seq: stored.seq });
    }
    // Without every cached page, the cursor only stays valid for what is kept, which is
    // exactly what the log keeps updated (known entities are never skipped).
    return { cursor: this.cursor, entities, pending: this.pending };
  }
}
