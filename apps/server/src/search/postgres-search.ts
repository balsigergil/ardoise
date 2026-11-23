// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PostgresSearchAdapter` (ARCHITECTURE §11): trigram and prefix matches on titles for
 * quick find; `websearch_to_tsquery` over `page_search.tsv` with the `ardoise`
 * configuration, `ts_rank_cd` and `ts_headline` for full search.
 */
import type { Database } from '@ardoise/db';
import { SNIPPET_END, SNIPPET_START } from '@ardoise/shared';
import { sql, type SQL } from 'drizzle-orm';
import type {
  RankCursor,
  SearchFilters,
  SearchPort,
  TextCandidate,
  TitleCandidate,
} from './search.port.js';

/** Most matches ranked per query: very common terms are ranked within this window. */
export const MAX_RANKED_MATCHES = 5_000;
/** Most title matches ranked by quick find. */
export const MAX_TITLE_MATCHES = 1_000;

/** Escapes LIKE wildcards. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class PostgresSearchAdapter implements SearchPort {
  constructor(private readonly db: Database) {}

  async quickFind(
    workspaceId: string,
    q: string,
    offset: number,
    limit: number,
  ): Promise<TitleCandidate[]> {
    const needle = likeEscape(q.toLowerCase());
    const prefix = sql`lower(ardoise_unaccent(p.title)) LIKE lower(ardoise_unaccent(${needle})) || '%'`;
    // 1. Titles starting with the query: a btree index scan that stops at the cap.
    const starts = await this.titleMatches(workspaceId, q, prefix);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(likeEscape);
    if (starts.length >= offset + limit || (words.length === 1 && q.length < 3)) {
      return starts.slice(offset, offset + limit);
    }
    // 2. Then titles containing every word (trigram), except those already found.
    const contains = sql.join(
      words.map((w) => sql`ardoise_unaccent(p.title) ILIKE '%' || ardoise_unaccent(${w}) || '%'`),
      sql` AND `,
    );
    const others = await this.titleMatches(workspaceId, q, sql`${contains} AND NOT (${prefix})`);
    return [...starts, ...others].slice(offset, offset + limit);
  }

  /** Up to MAX_TITLE_MATCHES live pages matching `match`, best first. */
  private async titleMatches(
    workspaceId: string,
    q: string,
    match: SQL,
  ): Promise<TitleCandidate[]> {
    // Matches are capped before ranking, so very common words cost a bounded amount.
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT m.id FROM (
        SELECT p.id, p.title, p.updated_at
        FROM pages p
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND ${match}
        LIMIT ${MAX_TITLE_MATCHES}
      ) m
      ORDER BY similarity(ardoise_unaccent(m.title), ardoise_unaccent(${q})) DESC, m.updated_at DESC, m.id`);
    return result.rows.map((r) => ({ pageId: r.id }));
  }

  async search(
    workspaceId: string,
    q: string,
    filters: SearchFilters,
    cursor: RankCursor | null,
    limit: number,
  ): Promise<TextCandidate[]> {
    const conditions: SQL[] = [];
    if (filters.createdBy) conditions.push(sql`p.created_by = ${filters.createdBy}`);
    if (filters.editedAfter) conditions.push(sql`p.updated_at >= ${filters.editedAfter}`);
    if (filters.editedBefore) conditions.push(sql`p.updated_at < ${filters.editedBefore}`);
    if (filters.titleOnly) conditions.push(sql`to_tsvector('ardoise', s.title) @@ query.q`);
    if (filters.teamspaceId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM pages t
        WHERE t.workspace_id = p.workspace_id AND t.path = subpath(p.path, 0, 1)
          AND t.parent_kind = 'teamspace' AND t.parent_id = ${filters.teamspaceId})`);
    }
    const extra = conditions.length ? sql`AND ${sql.join(conditions, sql` AND `)}` : sql``;
    const after = cursor
      ? sql`WHERE (ranked.rank, ranked.page_id) < (${cursor.rank}::real, ${cursor.pageId}::uuid)`
      : sql``;
    const options = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxWords=24, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`;
    const result = await this.db.execute<{ page_id: string; rank: number; snippet: string }>(sql`
      WITH query AS (SELECT websearch_to_tsquery('ardoise', ${q}) AS q),
      matches AS (
        SELECT s.page_id, s.tsv
        FROM page_search s
        JOIN pages p ON p.workspace_id = s.workspace_id AND p.id = s.page_id, query
        WHERE s.workspace_id = ${workspaceId}
          AND s.tsv @@ query.q
          AND p.deleted_at IS NULL
          ${extra}
        LIMIT ${MAX_RANKED_MATCHES}
      ),
      ranked AS (
        SELECT m.page_id, ts_rank_cd(m.tsv, query.q)::real AS rank FROM matches m, query
      ),
      page AS (
        SELECT ranked.page_id, ranked.rank FROM ranked ${after}
        ORDER BY ranked.rank DESC, ranked.page_id DESC
        LIMIT ${limit}
      )
      SELECT page.page_id, page.rank,
        ts_headline('ardoise', s.plain_text, query.q, ${options}) AS snippet
      FROM page
      JOIN page_search s ON s.workspace_id = ${workspaceId} AND s.page_id = page.page_id, query
      ORDER BY page.rank DESC, page.page_id DESC`);
    return result.rows.map((r) => ({
      pageId: r.page_id,
      rank: Number(r.rank),
      snippet: r.snippet,
    }));
  }
}
