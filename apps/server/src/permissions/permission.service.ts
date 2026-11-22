// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `permissions` module (ARCHITECTURE §9): loads ancestor chains through `path`, runs the
 * pure evaluator from `packages/shared`, and caches levels in Valkey under the
 * workspace `perm_epoch`. Every read path goes through here.
 */
import {
  atLeast,
  DomainError,
  evaluateAccess,
  idsFromPath,
  publicLinkCovers,
  type ChainNode,
  type Evaluation,
  type PageRootRef,
  type PermissionLevel,
  type Subject,
  type WorkspaceRole,
} from '@ardoise/shared';
import type { Redis } from 'ioredis';
import type { PageRecord, Store } from '../store/store.js';

/** Bounds the teamspaces loaded per subject (a user's own memberships). */
export const MAX_TEAMSPACES_PER_USER = 1000;
const CACHE_TTL_SECONDS = 600;

export interface PermissionCache {
  get(keys: readonly string[]): Promise<(PermissionLevel | null)[]>;
  set(entries: readonly [string, PermissionLevel][]): Promise<void>;
}

export class ValkeyPermissionCache implements PermissionCache {
  constructor(private readonly valkey: Redis) {}
  async get(keys: readonly string[]): Promise<(PermissionLevel | null)[]> {
    if (keys.length === 0) return [];
    return (await this.valkey.mget(...keys)) as (PermissionLevel | null)[];
  }
  async set(entries: readonly [string, PermissionLevel][]): Promise<void> {
    if (entries.length === 0) return;
    const pipeline = this.valkey.pipeline();
    for (const [key, level] of entries) pipeline.set(key, level, 'EX', CACHE_TTL_SECONDS);
    await pipeline.exec();
  }
}

export class NoPermissionCache implements PermissionCache {
  get(keys: readonly string[]): Promise<(PermissionLevel | null)[]> {
    return Promise.resolve(keys.map(() => null));
  }
  set(): Promise<void> {
    return Promise.resolve();
  }
}

export interface LoadedChain {
  /** Nearest first, the page itself first. */
  chain: ChainNode[];
  /** Same order as `chain`. */
  pages: PageRecord[];
  root: PageRootRef | null;
}

/**
 * The ancestor ids of a page, root first, the page last. While a large move is in
 * progress, ancestry above the moving root comes from the root's old path, so the whole
 * subtree keeps its pre-move permissions until the job completes (ADR 0003 item 5).
 */
export function ancestryIds(page: PageRecord, byId: ReadonlyMap<string, PageRecord>): string[] {
  const ids = idsFromPath(page.path);
  for (let i = 0; i < ids.length; i++) {
    const ancestor = byId.get(ids[i]!);
    if (ancestor?.moveState === 'moving') {
      return [...idsFromPath(ancestor.path), ...ids.slice(i + 1)];
    }
  }
  return ids;
}

export class PermissionService {
  constructor(
    private readonly store: Store,
    private readonly cache: PermissionCache,
  ) {}

  /** The evaluator's view of a user in a workspace. */
  async subject(
    workspaceId: string,
    userId: string,
    workspaceRole?: WorkspaceRole,
    store: Store = this.store,
  ): Promise<Subject> {
    const role = workspaceRole ?? (await store.workspaces.membership(workspaceId, userId))?.role;
    const teamspaceRoles = role
      ? await store.teamspaces.rolesForUser(workspaceId, userId, MAX_TEAMSPACES_PER_USER)
      : new Map();
    return { userId, workspaceRole: role, teamspaceRoles };
  }

  /** Loads the chains of several pages with one query per table. */
  async loadChains(
    workspaceId: string,
    pages: readonly PageRecord[],
    store: Store = this.store,
  ): Promise<Map<string, LoadedChain>> {
    const byId = new Map<string, PageRecord>(pages.map((p) => [p.id, p]));
    // First pass: labels of every path; second pass covers old paths of moving roots.
    for (let pass = 0; pass < 2; pass++) {
      const wanted = new Set<string>();
      for (const page of pages)
        for (const id of ancestryIds(page, byId)) if (!byId.has(id)) wanted.add(id);
      if (wanted.size === 0) break;
      for (const p of await store.pages.findMany(workspaceId, [...wanted])) byId.set(p.id, p);
    }
    const ancestry = new Map(pages.map((p) => [p.id, ancestryIds(p, byId)]));
    const allIds = new Set<string>();
    for (const ids of ancestry.values()) for (const id of ids) allIds.add(id);
    const grants = await store.grants.forPages(workspaceId, [...allIds]);
    const grantsByPage = new Map<string, typeof grants>();
    for (const g of grants) {
      const list = grantsByPage.get(g.pageId) ?? [];
      list.push(g);
      grantsByPage.set(g.pageId, list);
    }
    const teamspaceIds = new Set<string>();
    for (const ids of ancestry.values()) {
      const top = byId.get(ids[0]!);
      if (top?.parentKind === 'teamspace') teamspaceIds.add(top.parentId);
    }
    const teamspaces = new Map(
      (await store.teamspaces.findMany(workspaceId, [...teamspaceIds])).map((t) => [t.id, t]),
    );
    const out = new Map<string, LoadedChain>();
    for (const page of pages) {
      const ids = ancestry.get(page.id)!;
      const chainPages = ids
        .map((id) => byId.get(id))
        .filter((p): p is PageRecord => p !== undefined)
        .reverse();
      const top = byId.get(ids[0]!);
      let root: PageRootRef | null = null;
      if (top?.parentKind === 'teamspace') {
        const ts = teamspaces.get(top.parentId);
        if (ts) root = { kind: 'teamspace', teamspaceId: ts.id, defaultLevel: ts.defaultLevel };
      } else if (top?.parentKind === 'private') {
        root = { kind: 'private', userId: top.parentId };
      }
      out.set(page.id, {
        pages: chainPages,
        chain: chainPages.map((p) => ({
          id: p.id,
          restrictInheritance: p.restrictInheritance,
          grants: grantsByPage.get(p.id) ?? [],
        })),
        root,
      });
    }
    return out;
  }

  async evaluate(
    workspaceId: string,
    subject: Subject,
    page: PageRecord,
    store: Store = this.store,
  ): Promise<Evaluation & LoadedChain> {
    const loaded = (await this.loadChains(workspaceId, [page], store)).get(page.id)!;
    return { ...evaluateAccess(subject, loaded.chain, loaded.root), ...loaded };
  }

  /**
   * Levels for many pages, through the Valkey cache. Pass `store` inside a transaction
   * to bypass the cache (writes always evaluate fresh).
   */
  async levels(
    workspaceId: string,
    subject: Subject,
    pages: readonly PageRecord[],
    store?: Store,
  ): Promise<Map<string, PermissionLevel>> {
    const out = new Map<string, PermissionLevel>();
    if (pages.length === 0 || !subject.workspaceRole) {
      for (const p of pages) out.set(p.id, 'no_access');
      return out;
    }
    let missing = pages;
    let keyOf: ((id: string) => string) | undefined;
    if (!store) {
      const epoch = await this.store.changeLog.permEpoch(workspaceId);
      keyOf = (id) => `perm:${workspaceId}:${epoch}:${subject.userId}:${id}`;
      const cached = await this.cache.get(pages.map((p) => keyOf!(p.id)));
      missing = pages.filter((p, i) => {
        const level = cached[i];
        if (level) out.set(p.id, level);
        return !level;
      });
    }
    if (missing.length > 0) {
      const chains = await this.loadChains(workspaceId, missing, store ?? this.store);
      const fresh: [string, PermissionLevel][] = [];
      for (const page of missing) {
        const loaded = chains.get(page.id)!;
        const level = evaluateAccess(subject, loaded.chain, loaded.root).level;
        out.set(page.id, level);
        if (keyOf) fresh.push([keyOf(page.id), level]);
      }
      await this.cache.set(fresh);
    }
    return out;
  }

  async level(
    workspaceId: string,
    subject: Subject,
    page: PageRecord,
    store?: Store,
  ): Promise<PermissionLevel> {
    return (await this.levels(workspaceId, subject, [page], store)).get(page.id)!;
  }

  /** Throws `not_found` without view access (ids do not leak), `forbidden` below `required`. */
  async require(
    workspaceId: string,
    subject: Subject,
    page: PageRecord,
    required: PermissionLevel,
    store?: Store,
  ): Promise<PermissionLevel> {
    const level = await this.level(workspaceId, subject, page, store);
    if (!atLeast(level, 'can_view')) throw new DomainError('not_found');
    if (!atLeast(level, required)) throw new DomainError('forbidden');
    return level;
  }

  /** Access given by a section root alone (creating top-level pages). */
  rootLevel(subject: Subject, root: PageRootRef): PermissionLevel {
    return evaluateAccess(subject, [{ id: 'root', restrictInheritance: false, grants: [] }], root)
      .level;
  }

  /** True when an active public link covers the page. */
  async publicLinkCovers(
    workspaceId: string,
    linkPageId: string,
    includeSubpages: boolean,
    page: PageRecord,
  ): Promise<boolean> {
    const loaded = (await this.loadChains(workspaceId, [page])).get(page.id)!;
    return publicLinkCovers({ pageId: linkPageId, includeSubpages }, loaded.chain);
  }
}
