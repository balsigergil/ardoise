// SPDX-License-Identifier: AGPL-3.0-only
/** In-memory search adapter over `MemoryStore` (unit tests). */
import { SNIPPET_END, SNIPPET_START } from '@ardoise/shared';
import type { MemoryStore } from '../store/memory-store.js';
import type {
  RankCursor,
  SearchFilters,
  SearchPort,
  TextCandidate,
  TitleCandidate,
} from './search.port.js';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export class MemorySearchAdapter implements SearchPort {
  constructor(private readonly store: MemoryStore) {}

  private pages(workspaceId: string) {
    return [...this.store.sync.pages.values()].filter(
      (p) => p.workspaceId === workspaceId && !p.deletedAt,
    );
  }

  quickFind(
    workspaceId: string,
    q: string,
    offset: number,
    limit: number,
  ): Promise<TitleCandidate[]> {
    const needle = norm(q);
    const hits = this.pages(workspaceId)
      .filter((p) =>
        q.length < 3 ? norm(p.title).startsWith(needle) : norm(p.title).includes(needle),
      )
      .sort(
        (a, b) =>
          Number(norm(b.title).startsWith(needle)) - Number(norm(a.title).startsWith(needle)) ||
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          (a.id < b.id ? -1 : 1),
      );
    return Promise.resolve(hits.slice(offset, offset + limit).map((p) => ({ pageId: p.id })));
  }

  search(
    workspaceId: string,
    q: string,
    filters: SearchFilters,
    cursor: RankCursor | null,
    limit: number,
  ): Promise<TextCandidate[]> {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const rows = this.pages(workspaceId).flatMap((page) => {
      const row = this.store.content.search.get(`${workspaceId}/${page.id}`);
      if (!row) return [];
      if (filters.createdBy && page.createdBy !== filters.createdBy) return [];
      if (filters.editedAfter && page.updatedAt < filters.editedAfter) return [];
      if (filters.editedBefore && page.updatedAt >= filters.editedBefore) return [];
      if (filters.teamspaceId) {
        const top = [...this.store.sync.pages.values()].find(
          (p) => p.workspaceId === workspaceId && p.path === page.path.split('.')[0],
        );
        if (top?.parentKind !== 'teamspace' || top.parentId !== filters.teamspaceId) return [];
      }
      const title = norm(row.title);
      const body = norm(row.plainText);
      const haystack = filters.titleOnly ? title : `${title} ${body}`;
      if (!words.every((w) => haystack.includes(w))) return [];
      const rank = words.reduce((n, w) => n + (title.includes(w) ? 1 : 0.1), 0);
      const hit = words.find((w) => body.includes(w));
      const at = hit ? body.indexOf(hit) : -1;
      const snippet =
        at < 0
          ? row.plainText.slice(0, 80)
          : `${row.plainText.slice(Math.max(0, at - 20), at)}${SNIPPET_START}${row.plainText.slice(at, at + hit!.length)}${SNIPPET_END}${row.plainText.slice(at + hit!.length, at + hit!.length + 40)}`;
      return [{ pageId: page.id, rank, snippet }];
    });
    rows.sort((a, b) => b.rank - a.rank || (a.pageId < b.pageId ? 1 : -1));
    const after = cursor
      ? rows.filter(
          (r) => r.rank < cursor.rank || (r.rank === cursor.rank && r.pageId < cursor.pageId),
        )
      : rows;
    return Promise.resolve(after.slice(0, limit));
  }
}
