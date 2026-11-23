// SPDX-License-Identifier: AGPL-3.0-only
import { files, pageDocuments, pageLinks, pageMentionsUsers } from '@ardoise/db';
import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { DocumentsRepo, FilesRepo, LinkKind, ProjectionRepo } from './content-store.js';
import type { Executor } from './drizzle-sync-store.js';

export function documentsRepo(db: Executor): DocumentsRepo {
  return {
    async find(workspaceId, docName) {
      const [row] = await db
        .select()
        .from(pageDocuments)
        .where(and(eq(pageDocuments.workspaceId, workspaceId), eq(pageDocuments.docName, docName)));
      return row;
    },
    async upsert(record) {
      await db
        .insert(pageDocuments)
        .values(record)
        .onConflictDoUpdate({
          target: [pageDocuments.workspaceId, pageDocuments.docName],
          set: {
            state: record.state,
            stateVector: record.stateVector,
            size: record.size,
            updatedAt: record.updatedAt,
          },
        });
    },
  };
}

export function filesRepo(db: Executor): FilesRepo {
  return {
    async insert(file) {
      await db.insert(files).values(file);
    },
    async findById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(files)
        .where(and(eq(files.workspaceId, workspaceId), eq(files.id, id)));
      return row;
    },
    async update(workspaceId, id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db
        .update(files)
        .set(patch)
        .where(and(eq(files.workspaceId, workspaceId), eq(files.id, id)));
    },
    async markDeletedUnder(workspaceId, path, at) {
      const result = await db.execute(sql`
        UPDATE files SET deleted_at = ${at}
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
          AND page_id IN (
            SELECT id FROM pages WHERE workspace_id = ${workspaceId} AND path <@ ${path}::ltree
          )`);
      return result.rowCount ?? 0;
    },
    async listDeleted(before, limit) {
      const rows = await db
        .select()
        .from(files)
        .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, before)))
        .orderBy(asc(files.deletedAt))
        .limit(limit);
      return rows;
    },
    async deleteRows(workspaceId, ids) {
      if (ids.length === 0) return;
      await db
        .delete(files)
        .where(and(eq(files.workspaceId, workspaceId), inArray(files.id, [...ids])));
    },
  };
}

/**
 * `setweight(title, A) || setweight(body, B)` with the `ardoise` configuration
 * (`simple` + `unaccent`, migration 0004).
 */
const tsv = (title: unknown, body: unknown) => sql`
  setweight(to_tsvector('ardoise', ${title}), 'A') ||
  setweight(to_tsvector('ardoise', ${body}), 'B')`;

export function projectionRepo(db: Executor): ProjectionRepo {
  return {
    async upsertContent(workspaceId, pageId, title, plainText) {
      await db.execute(sql`
        INSERT INTO page_search (workspace_id, page_id, title, plain_text, tsv, updated_at)
        VALUES (${workspaceId}, ${pageId}, ${title}, ${plainText}, ${tsv(title, plainText)}, now())
        ON CONFLICT (workspace_id, page_id) DO UPDATE SET
          plain_text = EXCLUDED.plain_text,
          tsv = ${tsv(sql`page_search.title`, sql`EXCLUDED.plain_text`)},
          updated_at = now()`);
    },
    async setTitle(workspaceId, pageId, title) {
      await db.execute(sql`
        INSERT INTO page_search (workspace_id, page_id, title, plain_text, tsv, updated_at)
        VALUES (${workspaceId}, ${pageId}, ${title}, '', ${tsv(title, '')}, now())
        ON CONFLICT (workspace_id, page_id) DO UPDATE SET
          title = EXCLUDED.title,
          tsv = ${tsv(sql`EXCLUDED.title`, sql`page_search.plain_text`)},
          updated_at = now()`);
    },
    async replaceLinks(workspaceId, pageId, links) {
      await db
        .delete(pageLinks)
        .where(and(eq(pageLinks.workspaceId, workspaceId), eq(pageLinks.sourcePageId, pageId)));
      if (links.length === 0) return;
      await db
        .insert(pageLinks)
        .values(
          links.map((l) => ({
            workspaceId,
            sourcePageId: pageId,
            targetPageId: l.pageId,
            kind: l.kind,
          })),
        )
        .onConflictDoNothing();
    },
    async replaceUserMentions(workspaceId, pageId, mentions) {
      const where = and(
        eq(pageMentionsUsers.workspaceId, workspaceId),
        eq(pageMentionsUsers.pageId, pageId),
      );
      const before = await db
        .select({ userId: pageMentionsUsers.userId, blockId: pageMentionsUsers.blockId })
        .from(pageMentionsUsers)
        .where(where);
      const known = new Set(before.map((m) => `${m.userId}:${m.blockId}`));
      await db.delete(pageMentionsUsers).where(where);
      const rows = mentions.map((m) => ({
        workspaceId,
        pageId,
        userId: m.userId,
        blockId: m.blockId ?? '',
      }));
      if (rows.length) await db.insert(pageMentionsUsers).values(rows).onConflictDoNothing();
      return mentions.filter((m) => !known.has(`${m.userId}:${m.blockId ?? ''}`));
    },
    async backlinks(workspaceId, targetPageId, after, limit) {
      const rows = await db
        .select({
          sourcePageId: pageLinks.sourcePageId,
          kinds: sql<LinkKind[]>`array_agg(${pageLinks.kind}::text ORDER BY ${pageLinks.kind})`,
        })
        .from(pageLinks)
        .where(
          and(
            eq(pageLinks.workspaceId, workspaceId),
            eq(pageLinks.targetPageId, targetPageId),
            after ? gt(pageLinks.sourcePageId, after) : undefined,
          ),
        )
        .groupBy(pageLinks.sourcePageId)
        .orderBy(asc(pageLinks.sourcePageId))
        .limit(limit + 1);
      return rows;
    },
  };
}
