// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/require-await -- fakes mirror the async repository interface */
/** In-memory M2 repositories for unit tests; same ordering rules as Drizzle. */
import { comparePositions } from '@ardoise/shared';
import type {
  AppliedMutationsRepo,
  ChangeLogRepo,
  ChangeLogRow,
  FavoriteRecord,
  GrantRow,
  GrantsRepo,
  PageRecord,
  PagesRepo,
  PublicLinkRecord,
  PublicLinksRepo,
  UserPagesRepo,
} from './sync-store.js';

export interface MemorySyncData {
  pages: Map<string, PageRecord>;
  grants: (GrantRow & { workspaceId: string })[];
  favorites: (FavoriteRecord & { workspaceId: string; userId: string })[];
  follows: { workspaceId: string; userId: string; pageId: string }[];
  recents: { workspaceId: string; userId: string; pageId: string; visitedAt: Date }[];
  publicLinks: PublicLinkRecord[];
  changeLog: ChangeLogRow[];
  applied: Map<string, unknown>;
  seqs: Map<string, number>;
  permEpochs: Map<string, number>;
}

export function emptySyncData(permEpochs: Map<string, number>): MemorySyncData {
  return {
    pages: new Map(),
    grants: [],
    favorites: [],
    follows: [],
    recents: [],
    publicLinks: [],
    changeLog: [],
    applied: new Map(),
    seqs: new Map(),
    permEpochs,
  };
}

const key = (ws: string, id: string) => `${ws}/${id}`;
const under = (path: string, root: string) => path === root || path.startsWith(`${root}.`);
const cmp = (a: string, b: string) => comparePositions(a, b);
const depthOf = (path: string) => path.split('.').length;

export function memoryPagesRepo(d: MemorySyncData): PagesRepo {
  const all = (ws: string) => [...d.pages.values()].filter((p) => p.workspaceId === ws);
  const liveChildren = (ws: string, parentId: string) =>
    all(ws).filter((p) => p.parentId === parentId && !p.deletedAt && !p.isInline);
  return {
    findById: async (ws, id) => {
      const p = d.pages.get(key(ws, id));
      return p && { ...p };
    },
    findMany: async (ws, ids) =>
      ids.flatMap((id) => {
        const p = d.pages.get(key(ws, id));
        return p ? [{ ...p }] : [];
      }),
    insert: async (page) => {
      if (d.pages.has(key(page.workspaceId, page.id))) throw new Error('duplicate page');
      d.pages.set(key(page.workspaceId, page.id), { ...page });
    },
    insertMany: async (list) => {
      for (const page of list) d.pages.set(key(page.workspaceId, page.id), { ...page });
    },
    update: async (ws, id, patch) => {
      const p = d.pages.get(key(ws, id));
      if (p) d.pages.set(key(ws, id), { ...p, ...patch });
    },
    children: async (ws, parentId, after, limit) =>
      liveChildren(ws, parentId)
        .sort((a, b) => cmp(a.position, b.position) || cmp(a.id, b.id))
        .filter(
          (p) =>
            !after ||
            cmp(p.position, after.position) > 0 ||
            (p.position === after.position && cmp(p.id, after.id) > 0),
        )
        .slice(0, limit + 1)
        .map((p) => ({ ...p, hasChildren: liveChildren(ws, p.id).length > 0 })),
    withChildren: async (ws, ids) => new Set(ids.filter((id) => liveChildren(ws, id).length > 0)),
    subtreeSize: async (ws, path, cap) =>
      Math.min(all(ws).filter((p) => under(p.path, path)).length, cap + 1),
    rewritePaths: async (ws, oldPath, newPath, options) => {
      let n = 0;
      for (const p of all(ws)) {
        if (!under(p.path, oldPath)) continue;
        if (options && (p.id === options.excludeId || n >= options.limit)) continue;
        p.path = newPath + p.path.slice(oldPath.length);
        d.pages.set(key(ws, p.id), p);
        n++;
      }
      return n;
    },
    trashSubtree: async (ws, path, rootId, at) => {
      let n = 0;
      for (const p of all(ws)) {
        if (under(p.path, path) && !p.deletedAt) {
          d.pages.set(key(ws, p.id), { ...p, deletedAt: at, deletedRootId: rootId });
          n++;
        }
      }
      return n;
    },
    restoreSubtree: async (ws, path, rootId) => {
      let n = 0;
      for (const p of all(ws)) {
        if (under(p.path, path) && p.deletedRootId === rootId) {
          d.pages.set(key(ws, p.id), { ...p, deletedAt: null, deletedRootId: null });
          n++;
        }
      }
      return n;
    },
    purgeSubtree: async (ws, path) => {
      const gone = new Set(
        all(ws)
          .filter((p) => under(p.path, path))
          .map((p) => p.id),
      );
      for (const id of gone) d.pages.delete(key(ws, id));
      const keep = <T extends { workspaceId: string; pageId: string }>(rows: T[]) =>
        rows.filter((r) => r.workspaceId !== ws || !gone.has(r.pageId));
      d.grants = keep(d.grants);
      d.favorites = keep(d.favorites);
      d.follows = keep(d.follows);
      d.recents = keep(d.recents);
      d.publicLinks = keep(d.publicLinks);
      return gone.size;
    },
    subtreeBatch: async (ws, path, after, limit) =>
      all(ws)
        .filter((p) => under(p.path, path))
        .map((p) => ({ ...p, depth: depthOf(p.path) }))
        .sort((a, b) => a.depth - b.depth || cmp(a.id, b.id))
        .filter(
          (p) =>
            !after || p.depth > after.depth || (p.depth === after.depth && cmp(p.id, after.id) > 0),
        )
        .slice(0, limit),
    trashRoots: async (ws, after, limit, q) =>
      all(ws)
        .filter((p) => p.deletedRootId === p.id && p.deletedAt)
        .filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime() || cmp(a.id, b.id))
        .filter(
          (p) =>
            !after ||
            p.deletedAt! < after.deletedAt ||
            (p.deletedAt!.getTime() === after.deletedAt.getTime() && cmp(p.id, after.id) > 0),
        )
        .slice(0, limit + 1),
    movingRoots: async (ws) => all(ws).filter((p) => p.moveState !== null),
    expiredTrashRoots: async (before, limit) =>
      [...d.pages.values()]
        .filter((p) => p.deletedRootId === p.id && p.deletedAt && p.deletedAt < before)
        .slice(0, limit),
  };
}

export function memoryGrantsRepo(d: MemorySyncData): GrantsRepo {
  const same = (
    g: GrantRow & { workspaceId: string },
    ws: string,
    pageId: string,
    kind: string,
    id: string,
  ) =>
    g.workspaceId === ws && g.pageId === pageId && g.principalKind === kind && g.principalId === id;
  return {
    forPages: async (ws, pageIds) => {
      const ids = new Set(pageIds);
      return d.grants
        .filter((g) => g.workspaceId === ws && ids.has(g.pageId))
        .map((g) => ({ ...g }));
    },
    upsert: async (ws, grant) => {
      const existing = d.grants.find((g) =>
        same(g, ws, grant.pageId, grant.principalKind, grant.principalId),
      );
      if (existing) existing.level = grant.level;
      else d.grants.push({ ...grant, workspaceId: ws });
    },
    insertMany: async (ws, grants) => {
      for (const grant of grants) {
        if (
          !d.grants.some((g) => same(g, ws, grant.pageId, grant.principalKind, grant.principalId))
        )
          d.grants.push({ ...grant, workspaceId: ws });
      }
    },
    delete: async (ws, pageId, principal) => {
      const before = d.grants.length;
      d.grants = d.grants.filter((g) => !same(g, ws, pageId, principal.kind, principal.id));
      return d.grants.length < before;
    },
    pagesFor: async (ws, principals, afterPageId, limit) => {
      const ids = new Set(
        d.grants
          .filter(
            (g) =>
              g.workspaceId === ws &&
              principals.some((p) => p.kind === g.principalKind && p.id === g.principalId),
          )
          .map((g) => g.pageId),
      );
      return [...ids]
        .map((id) => d.pages.get(key(ws, id)))
        .filter((p): p is PageRecord => !!p && !p.deletedAt)
        .filter((p) => !afterPageId || cmp(p.id, afterPageId) > 0)
        .sort((a, b) => cmp(a.id, b.id))
        .slice(0, limit + 1);
    },
  };
}

export function memoryUserPagesRepo(d: MemorySyncData): UserPagesRepo {
  const mine = <T extends { workspaceId: string; userId: string }>(
    rows: T[],
    ws: string,
    user: string,
  ) => rows.filter((r) => r.workspaceId === ws && r.userId === user);
  return {
    favorites: async (ws, user, limit) =>
      mine(d.favorites, ws, user)
        .sort((a, b) => cmp(a.position, b.position) || cmp(a.pageId, b.pageId))
        .slice(0, limit)
        .map(({ pageId, position }) => ({ pageId, position })),
    favorite: async (ws, user, pageId) => {
      const f = mine(d.favorites, ws, user).find((r) => r.pageId === pageId);
      return f && { pageId: f.pageId, position: f.position };
    },
    setFavorite: async (ws, user, favorite) => {
      const f = mine(d.favorites, ws, user).find((r) => r.pageId === favorite.pageId);
      if (f) f.position = favorite.position;
      else d.favorites.push({ workspaceId: ws, userId: user, ...favorite });
    },
    removeFavorite: async (ws, user, pageId) => {
      const before = d.favorites.length;
      d.favorites = d.favorites.filter(
        (r) => !(r.workspaceId === ws && r.userId === user && r.pageId === pageId),
      );
      return d.favorites.length < before;
    },
    isFollowing: async (ws, user, pageId) =>
      mine(d.follows, ws, user).some((r) => r.pageId === pageId),
    follow: async (ws, user, pageId) => {
      if (!mine(d.follows, ws, user).some((r) => r.pageId === pageId))
        d.follows.push({ workspaceId: ws, userId: user, pageId });
    },
    unfollow: async (ws, user, pageId) => {
      const before = d.follows.length;
      d.follows = d.follows.filter(
        (r) => !(r.workspaceId === ws && r.userId === user && r.pageId === pageId),
      );
      return d.follows.length < before;
    },
    touchRecent: async (ws, user, pageId, at, keep) => {
      d.recents = d.recents.filter(
        (r) => !(r.workspaceId === ws && r.userId === user && r.pageId === pageId),
      );
      d.recents.push({ workspaceId: ws, userId: user, pageId, visitedAt: at });
      const sorted = mine(d.recents, ws, user).sort(
        (a, b) => b.visitedAt.getTime() - a.visitedAt.getTime(),
      );
      const drop = new Set(sorted.slice(keep));
      d.recents = d.recents.filter((r) => !drop.has(r));
    },
    recents: async (ws, user, limit) =>
      mine(d.recents, ws, user)
        .sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime())
        .slice(0, limit)
        .map(({ pageId, visitedAt }) => ({ pageId, visitedAt })),
  };
}

export function memoryPublicLinksRepo(d: MemorySyncData): PublicLinksRepo {
  const active = (ws: string) => d.publicLinks.filter((l) => l.workspaceId === ws && !l.revokedAt);
  return {
    active: async (ws, pageId) => active(ws).find((l) => l.pageId === pageId),
    activeForPages: async (ws, pageIds) => active(ws).filter((l) => pageIds.includes(l.pageId)),
    findByTokenHash: async (hash) => d.publicLinks.find((l) => l.tokenHash === hash),
    insert: async (link) => {
      d.publicLinks.push({ ...link });
    },
    update: async (ws, id, patch) => {
      const link = d.publicLinks.find((l) => l.workspaceId === ws && l.id === id);
      if (link) Object.assign(link, patch);
    },
    revoke: async (ws, pageId, at) => {
      for (const link of active(ws)) if (link.pageId === pageId) link.revokedAt = at;
    },
  };
}

export function memoryChangeLogRepo(d: MemorySyncData): ChangeLogRepo {
  return {
    lockCounter: async (ws) => d.seqs.get(ws) ?? 0,
    allocate: async (ws, count) => {
      const next = (d.seqs.get(ws) ?? 0) + count;
      d.seqs.set(ws, next);
      return next;
    },
    append: async (rows) => {
      d.changeLog.push(...rows.map((r) => ({ ...r })));
    },
    since: async (ws, since, limit) =>
      d.changeLog
        .filter((r) => r.workspaceId === ws && r.seq > since)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit),
    currentSeq: async (ws) => d.seqs.get(ws) ?? 0,
    minSeq: async (ws) => {
      const seqs = d.changeLog.filter((r) => r.workspaceId === ws).map((r) => r.seq);
      return seqs.length ? Math.min(...seqs) : null;
    },
    permEpoch: async (ws) => d.permEpochs.get(ws) ?? 0,
    purgeBefore: async (before) => {
      const n = d.changeLog.length;
      d.changeLog = d.changeLog.filter((r) => r.createdAt >= before);
      return n - d.changeLog.length;
    },
  };
}

export function memoryAppliedMutationsRepo(d: MemorySyncData): AppliedMutationsRepo {
  return {
    find: async (ws, id) => d.applied.get(key(ws, id)),
    insert: async (ws, id, _actor, result) => {
      if (d.applied.has(key(ws, id))) return false;
      d.applied.set(key(ws, id), result);
      return true;
    },
  };
}
