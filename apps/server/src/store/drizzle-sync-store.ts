// SPDX-License-Identifier: AGPL-3.0-only
/** Drizzle implementations of the M2 repositories (see `sync-store.ts`). */
import {
  appliedMutations,
  changeLog,
  favorites,
  pageFollows,
  pagePermissions,
  pages,
  publicLinks,
  recents,
  workspaceCounters,
  type Database,
} from '@ardoise/db';
import type { PageCover, PageIcon } from '@ardoise/shared';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { likeContains } from './cursor.js';
import type {
  AppliedMutationsRepo,
  ChangeLogRepo,
  GrantRow,
  GrantsRepo,
  PageRecord,
  PagesRepo,
  PublicLinksRepo,
  UserPagesRepo,
} from './sync-store.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

const toPage = (row: typeof pages.$inferSelect): PageRecord => ({
  workspaceId: row.workspaceId,
  id: row.id,
  kind: row.kind,
  parentKind: row.parentKind,
  parentId: row.parentId,
  path: row.path,
  isInline: row.isInline,
  moveState: row.moveState,
  position: row.position,
  title: row.title,
  icon: (row.icon ?? null) as PageIcon,
  cover: (row.cover ?? null) as PageCover,
  restrictInheritance: row.restrictInheritance,
  isLocked: row.isLocked,
  isTemplate: row.isTemplate,
  width: row.width,
  font: row.font,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
  deletedRootId: row.deletedRootId,
});

const fromPage = (p: PageRecord): typeof pages.$inferInsert => ({ ...p, properties: null });

const inSubtree = (path: string): SQL => sql`${pages.path} <@ ${path}::ltree`;

// Drizzle renders column references unqualified inside `sql`, which would bind them to
// the inner table: the outer row is named explicitly.
const hasLiveChild = sql<boolean>`EXISTS (
  SELECT 1 FROM ${pages} c
  WHERE c.workspace_id = "pages"."workspace_id" AND c.parent_id = "pages"."id"
    AND c.deleted_at IS NULL AND NOT c.is_inline
)`;

export function pagesRepo(db: Executor): PagesRepo {
  return {
    async findById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(pages)
        .where(and(eq(pages.workspaceId, workspaceId), eq(pages.id, id)));
      return row && toPage(row);
    },
    async findMany(workspaceId, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(pages)
        .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, [...ids])));
      return rows.map(toPage);
    },
    async insert(page) {
      await db.insert(pages).values(fromPage(page));
    },
    async insertMany(list) {
      for (let i = 0; i < list.length; i += 500) {
        await db.insert(pages).values(list.slice(i, i + 500).map(fromPage));
      }
    },
    async update(workspaceId, id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db
        .update(pages)
        .set(patch)
        .where(and(eq(pages.workspaceId, workspaceId), eq(pages.id, id)));
    },
    async children(workspaceId, parentId, after, limit) {
      const conditions: SQL[] = [
        eq(pages.workspaceId, workspaceId),
        eq(pages.parentId, parentId),
        isNull(pages.deletedAt),
        eq(pages.isInline, false),
      ];
      if (after) {
        conditions.push(
          or(
            gt(pages.position, after.position),
            and(eq(pages.position, after.position), gt(pages.id, after.id)),
          )!,
        );
      }
      const rows = await db
        .select({ page: pages, hasChildren: hasLiveChild })
        .from(pages)
        .where(and(...conditions))
        .orderBy(asc(pages.position), asc(pages.id))
        .limit(limit + 1);
      return rows.map((r) => ({ ...toPage(r.page), hasChildren: r.hasChildren }));
    },
    async withChildren(workspaceId, ids) {
      if (ids.length === 0) return new Set();
      const rows = await db
        .selectDistinct({ id: pages.parentId })
        .from(pages)
        .where(
          and(
            eq(pages.workspaceId, workspaceId),
            inArray(pages.parentId, [...ids]),
            isNull(pages.deletedAt),
            eq(pages.isInline, false),
          ),
        );
      return new Set(rows.map((r) => r.id));
    },
    async subtreeHeight(workspaceId, path) {
      const result = await db.execute<{ h: number }>(sql`
        SELECT coalesce(max(nlevel(path)), 0)::int - nlevel(${path}::ltree) AS h FROM ${pages}
        WHERE workspace_id = ${workspaceId} AND path <@ ${path}::ltree`);
      return Math.max(0, result.rows[0]?.h ?? 0);
    },
    async subtreeSize(workspaceId, path, cap) {
      const result = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM (
          SELECT 1 FROM ${pages}
          WHERE ${pages.workspaceId} = ${workspaceId} AND ${inSubtree(path)}
          LIMIT ${cap + 1}
        ) s`);
      return result.rows[0]?.n ?? 0;
    },
    async rewritePaths(workspaceId, oldPath, newPath, options) {
      // subpath() rejects an offset equal to the length, hence the root case.
      const newValue = sql`CASE WHEN ${pages.path} = ${oldPath}::ltree THEN ${newPath}::ltree
        ELSE ${newPath}::ltree || subpath(${pages.path}, nlevel(${oldPath}::ltree)) END`;
      if (!options) {
        const result = await db
          .update(pages)
          .set({ path: newValue })
          .where(and(eq(pages.workspaceId, workspaceId), inSubtree(oldPath)));
        return result.rowCount ?? 0;
      }
      const result = await db.execute(sql`
        UPDATE ${pages} SET path = ${newPath}::ltree || subpath(path, nlevel(${oldPath}::ltree))
        WHERE workspace_id = ${workspaceId} AND id IN (
          SELECT id FROM ${pages}
          WHERE workspace_id = ${workspaceId} AND path <@ ${oldPath}::ltree AND id <> ${options.excludeId}
          LIMIT ${options.limit}
        )`);
      return result.rowCount ?? 0;
    },
    async trashSubtree(workspaceId, path, rootId, at) {
      const result = await db
        .update(pages)
        .set({ deletedAt: at, deletedRootId: rootId })
        .where(and(eq(pages.workspaceId, workspaceId), inSubtree(path), isNull(pages.deletedAt)));
      return result.rowCount ?? 0;
    },
    async restoreSubtree(workspaceId, path, rootId) {
      const result = await db
        .update(pages)
        .set({ deletedAt: null, deletedRootId: null })
        .where(
          and(eq(pages.workspaceId, workspaceId), inSubtree(path), eq(pages.deletedRootId, rootId)),
        );
      return result.rowCount ?? 0;
    },
    async purgeSubtree(workspaceId, path) {
      const result = await db
        .delete(pages)
        .where(and(eq(pages.workspaceId, workspaceId), inSubtree(path)));
      return result.rowCount ?? 0;
    },
    async subtreeBatch(workspaceId, path, after, limit) {
      const depth = sql<number>`nlevel(${pages.path})`;
      const conditions: SQL[] = [eq(pages.workspaceId, workspaceId), inSubtree(path)];
      if (after) {
        conditions.push(
          sql`(nlevel(${pages.path}), ${pages.id}) > (${after.depth}, ${after.id}::uuid)`,
        );
      }
      const rows = await db
        .select({ page: pages, depth })
        .from(pages)
        .where(and(...conditions))
        .orderBy(asc(depth), asc(pages.id))
        .limit(limit);
      return rows.map((r) => ({ ...toPage(r.page), depth: Number(r.depth) }));
    },
    async trashRoots(workspaceId, after, limit, q) {
      const conditions: SQL[] = [
        eq(pages.workspaceId, workspaceId),
        sql`${pages.deletedRootId} = ${pages.id}`,
      ];
      if (q) conditions.push(ilike(pages.title, likeContains(q)));
      if (after) {
        conditions.push(
          or(
            lt(pages.deletedAt, after.deletedAt),
            and(eq(pages.deletedAt, after.deletedAt), gt(pages.id, after.id)),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(pages)
        .where(and(...conditions))
        .orderBy(desc(pages.deletedAt), asc(pages.id))
        .limit(limit + 1);
      return rows.map(toPage);
    },
    async movingRoots(workspaceId) {
      const rows = await db
        .select()
        .from(pages)
        .where(and(eq(pages.workspaceId, workspaceId), sql`${pages.moveState} IS NOT NULL`))
        .limit(100);
      return rows.map(toPage);
    },
    async expiredTrashRoots(before, limit) {
      const rows = await db
        .select()
        .from(pages)
        .where(and(sql`${pages.deletedRootId} = ${pages.id}`, lt(pages.deletedAt, before)))
        .limit(limit);
      return rows.map(toPage);
    },
  };
}

const grantColumns = {
  pageId: pagePermissions.pageId,
  principalKind: pagePermissions.principalKind,
  principalId: pagePermissions.principalId,
  level: pagePermissions.level,
  createdBy: pagePermissions.createdBy,
  createdAt: pagePermissions.createdAt,
};

export function grantsRepo(db: Executor): GrantsRepo {
  return {
    async forPages(workspaceId, pageIds) {
      if (pageIds.length === 0) return [];
      const rows = await db
        .select(grantColumns)
        .from(pagePermissions)
        .where(
          and(
            eq(pagePermissions.workspaceId, workspaceId),
            inArray(pagePermissions.pageId, [...pageIds]),
          ),
        );
      return rows as GrantRow[];
    },
    async upsert(workspaceId, grant) {
      await db
        .insert(pagePermissions)
        .values({ workspaceId, ...grant })
        .onConflictDoUpdate({
          target: [
            pagePermissions.workspaceId,
            pagePermissions.pageId,
            pagePermissions.principalKind,
            pagePermissions.principalId,
          ],
          set: { level: grant.level },
        });
    },
    async insertMany(workspaceId, grants) {
      for (let i = 0; i < grants.length; i += 500) {
        await db
          .insert(pagePermissions)
          .values(grants.slice(i, i + 500).map((g) => ({ workspaceId, ...g })))
          .onConflictDoNothing();
      }
    },
    async delete(workspaceId, pageId, principal) {
      const result = await db
        .delete(pagePermissions)
        .where(
          and(
            eq(pagePermissions.workspaceId, workspaceId),
            eq(pagePermissions.pageId, pageId),
            eq(pagePermissions.principalKind, principal.kind),
            eq(pagePermissions.principalId, principal.id),
          ),
        );
      return (result.rowCount ?? 0) > 0;
    },
    async pagesFor(workspaceId, principals, afterPageId, limit) {
      if (principals.length === 0) return [];
      const matches = or(
        ...principals.map((p) =>
          and(eq(pagePermissions.principalKind, p.kind), eq(pagePermissions.principalId, p.id)),
        ),
      )!;
      const conditions: SQL[] = [eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)];
      if (afterPageId) conditions.push(gt(pages.id, afterPageId));
      const rows = await db
        .selectDistinct({ page: pages })
        .from(pagePermissions)
        .innerJoin(
          pages,
          and(
            eq(pages.workspaceId, pagePermissions.workspaceId),
            eq(pages.id, pagePermissions.pageId),
          ),
        )
        .where(and(eq(pagePermissions.workspaceId, workspaceId), matches, ...conditions))
        .orderBy(asc(pages.id))
        .limit(limit + 1);
      return rows.map((r) => toPage(r.page));
    },
  };
}

export function userPagesRepo(db: Executor): UserPagesRepo {
  const fav = (ws: string, user: string) =>
    and(eq(favorites.workspaceId, ws), eq(favorites.userId, user));
  const fol = (ws: string, user: string, page: string) =>
    and(
      eq(pageFollows.workspaceId, ws),
      eq(pageFollows.userId, user),
      eq(pageFollows.pageId, page),
    );
  return {
    async favorites(workspaceId, userId, limit) {
      return db
        .select({ pageId: favorites.pageId, position: favorites.position })
        .from(favorites)
        .where(fav(workspaceId, userId))
        .orderBy(asc(favorites.position), asc(favorites.pageId))
        .limit(limit);
    },
    async favorite(workspaceId, userId, pageId) {
      const [row] = await db
        .select({ pageId: favorites.pageId, position: favorites.position })
        .from(favorites)
        .where(and(fav(workspaceId, userId), eq(favorites.pageId, pageId)));
      return row;
    },
    async setFavorite(workspaceId, userId, favorite) {
      await db
        .insert(favorites)
        .values({ workspaceId, userId, ...favorite })
        .onConflictDoUpdate({
          target: [favorites.workspaceId, favorites.userId, favorites.pageId],
          set: { position: favorite.position },
        });
    },
    async removeFavorite(workspaceId, userId, pageId) {
      const result = await db
        .delete(favorites)
        .where(and(fav(workspaceId, userId), eq(favorites.pageId, pageId)));
      return (result.rowCount ?? 0) > 0;
    },
    async isFollowing(workspaceId, userId, pageId) {
      const [row] = await db
        .select({ pageId: pageFollows.pageId })
        .from(pageFollows)
        .where(fol(workspaceId, userId, pageId));
      return row !== undefined;
    },
    async follow(workspaceId, userId, pageId) {
      await db.insert(pageFollows).values({ workspaceId, userId, pageId }).onConflictDoNothing();
    },
    async unfollow(workspaceId, userId, pageId) {
      const result = await db.delete(pageFollows).where(fol(workspaceId, userId, pageId));
      return (result.rowCount ?? 0) > 0;
    },
    async touchRecent(workspaceId, userId, pageId, at, keep) {
      await db
        .insert(recents)
        .values({ workspaceId, userId, pageId, visitedAt: at })
        .onConflictDoUpdate({
          target: [recents.workspaceId, recents.userId, recents.pageId],
          set: { visitedAt: at },
        });
      await db.execute(sql`
        DELETE FROM ${recents} WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
          AND page_id IN (
            SELECT page_id FROM ${recents}
            WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
            ORDER BY visited_at DESC OFFSET ${keep}
          )`);
    },
    async recents(workspaceId, userId, limit) {
      return db
        .select({ pageId: recents.pageId, visitedAt: recents.visitedAt })
        .from(recents)
        .where(and(eq(recents.workspaceId, workspaceId), eq(recents.userId, userId)))
        .orderBy(desc(recents.visitedAt))
        .limit(limit);
    },
  };
}

export function publicLinksRepo(db: Executor): PublicLinksRepo {
  const active = (ws: string) =>
    and(eq(publicLinks.workspaceId, ws), isNull(publicLinks.revokedAt));
  return {
    async active(workspaceId, pageId) {
      const [row] = await db
        .select()
        .from(publicLinks)
        .where(and(active(workspaceId), eq(publicLinks.pageId, pageId)));
      return row;
    },
    async activeForPages(workspaceId, pageIds) {
      if (pageIds.length === 0) return [];
      return await db
        .select()
        .from(publicLinks)
        .where(and(active(workspaceId), inArray(publicLinks.pageId, [...pageIds])));
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db.select().from(publicLinks).where(eq(publicLinks.tokenHash, tokenHash));
      return row;
    },
    async insert(link) {
      await db.insert(publicLinks).values(link);
    },
    async update(workspaceId, id, patch) {
      await db
        .update(publicLinks)
        .set(patch)
        .where(and(eq(publicLinks.workspaceId, workspaceId), eq(publicLinks.id, id)));
    },
    async revoke(workspaceId, pageId, at) {
      await db
        .update(publicLinks)
        .set({ revokedAt: at })
        .where(and(active(workspaceId), eq(publicLinks.pageId, pageId)));
    },
  };
}

export function changeLogRepo(db: Executor): ChangeLogRepo {
  const counter = (ws: string) => eq(workspaceCounters.workspaceId, ws);
  return {
    async lockCounter(workspaceId) {
      const result = await db.execute<{ seq: string }>(
        sql`SELECT change_seq AS seq FROM ${workspaceCounters} WHERE workspace_id = ${workspaceId} FOR UPDATE`,
      );
      return Number(result.rows[0]?.seq ?? 0);
    },
    async allocate(workspaceId, count) {
      const [row] = await db
        .update(workspaceCounters)
        .set({ changeSeq: sql`${workspaceCounters.changeSeq} + ${count}` })
        .where(counter(workspaceId))
        .returning({ seq: workspaceCounters.changeSeq });
      if (!row) throw new Error(`no counters for workspace ${workspaceId}`);
      return Number(row.seq);
    },
    async append(rows) {
      if (rows.length === 0) return;
      await db.insert(changeLog).values(rows.map((r) => ({ ...r, data: r.data ?? null })));
    },
    async since(workspaceId, since, limit) {
      const rows = await db
        .select()
        .from(changeLog)
        .where(and(eq(changeLog.workspaceId, workspaceId), gt(changeLog.seq, since)))
        .orderBy(asc(changeLog.seq))
        .limit(limit);
      return rows;
    },
    async currentSeq(workspaceId) {
      const [row] = await db
        .select({ seq: workspaceCounters.changeSeq })
        .from(workspaceCounters)
        .where(counter(workspaceId));
      return Number(row?.seq ?? 0);
    },
    async minSeq(workspaceId) {
      const [row] = await db
        .select({ seq: sql<string | null>`min(${changeLog.seq})` })
        .from(changeLog)
        .where(eq(changeLog.workspaceId, workspaceId));
      return row?.seq == null ? null : Number(row.seq);
    },
    async permEpoch(workspaceId) {
      const [row] = await db
        .select({ epoch: workspaceCounters.permEpoch })
        .from(workspaceCounters)
        .where(counter(workspaceId));
      return Number(row?.epoch ?? 0);
    },
    async purgeBefore(before) {
      const result = await db.delete(changeLog).where(lt(changeLog.createdAt, before));
      await db.delete(appliedMutations).where(lt(appliedMutations.createdAt, before));
      return result.rowCount ?? 0;
    },
  };
}

export function appliedMutationsRepo(db: Executor): AppliedMutationsRepo {
  return {
    async find(workspaceId, id) {
      const [row] = await db
        .select({ result: appliedMutations.result })
        .from(appliedMutations)
        .where(and(eq(appliedMutations.workspaceId, workspaceId), eq(appliedMutations.id, id)));
      return row?.result;
    },
    async insert(workspaceId, id, actorId, result, at) {
      const rows = await db
        .insert(appliedMutations)
        .values({ workspaceId, id, actorId, result, createdAt: at })
        .onConflictDoNothing()
        .returning({ id: appliedMutations.id });
      return rows.length > 0;
    },
  };
}
