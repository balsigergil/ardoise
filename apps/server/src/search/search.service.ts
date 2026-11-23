// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `search` module (PRODUCT §14, ADR 0009 §8): quick find and full search over the
 * `SearchPort`, filtered by permission in batches with bounded scans.
 */
import {
  atLeast,
  DomainError,
  idsFromPath,
  type QuickFindDto,
  type QuickFindItemDto,
  type SearchQuery,
  type SearchResultsDto,
  type Subject,
} from '@ardoise/shared';
import type { PermissionService } from '../permissions/permission.service.js';
import type { PageRecord } from '../store/sync-store.js';
import type { Store, UserRecord } from '../store/store.js';
import type { RankCursor, SearchPort } from './search.port.js';

/** Quick find scans at most this many title matches per call. */
export const QUICK_FIND_SCAN = 500;
/** Full search scans at most this many ranked matches per page of results. */
export const SEARCH_SCAN = 2_000;
const BATCH = 100;

export function encodeCursor(cursor: RankCursor): string {
  return Buffer.from(JSON.stringify([cursor.rank, cursor.pageId])).toString('base64url');
}

export function decodeCursor(raw: string | undefined): RankCursor | null {
  if (!raw) return null;
  try {
    const [rank, pageId] = JSON.parse(Buffer.from(raw, 'base64url').toString()) as [
      unknown,
      unknown,
    ];
    if (typeof rank !== 'number' || typeof pageId !== 'string' || !/^[0-9a-f-]{36}$/.test(pageId)) {
      throw new Error('bad cursor');
    }
    return { rank, pageId };
  } catch {
    throw new DomainError('validation_failed');
  }
}

export class SearchService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly port: SearchPort,
  ) {}

  private async subject(actor: UserRecord, workspaceId: string): Promise<Subject> {
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');
    return this.permissions.subject(workspaceId, actor.id, member.role);
  }

  /** Pages among `ids` the subject can view, keyed by id. */
  private async viewable(
    workspaceId: string,
    subject: Subject,
    ids: string[],
  ): Promise<Map<string, PageRecord>> {
    const pages = (await this.store.pages.findMany(workspaceId, ids)).filter((p) => !p.deletedAt);
    const levels = await this.permissions.levels(workspaceId, subject, pages);
    return new Map(
      pages
        .filter((p) => atLeast(levels.get(p.id) ?? 'no_access', 'can_view'))
        .map((p) => [p.id, p]),
    );
  }

  /** Result items with the titles of the ancestors the subject can see. */
  private async items(
    workspaceId: string,
    subject: Subject,
    pages: PageRecord[],
  ): Promise<QuickFindItemDto[]> {
    const ancestorIds = [...new Set(pages.flatMap((p) => idsFromPath(p.path).slice(0, -1)))];
    const ancestors = ancestorIds.length
      ? await this.viewable(workspaceId, subject, ancestorIds)
      : new Map();
    return pages.map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      path: idsFromPath(p.path)
        .slice(0, -1)
        .flatMap((id) => {
          const a = ancestors.get(id) as PageRecord | undefined;
          return a ? [a.title] : [];
        }),
    }));
  }

  async quickFind(
    actor: UserRecord,
    workspaceId: string,
    q: string,
    limit: number,
  ): Promise<QuickFindDto> {
    const subject = await this.subject(actor, workspaceId);
    const query = q.trim();
    if (!query) return { items: [] };
    const found: PageRecord[] = [];
    for (let offset = 0; offset < QUICK_FIND_SCAN && found.length < limit; offset += BATCH) {
      const batch = await this.port.quickFind(workspaceId, query, offset, BATCH);
      const visible = await this.viewable(
        workspaceId,
        subject,
        batch.map((c) => c.pageId),
      );
      for (const c of batch) {
        const page = visible.get(c.pageId);
        if (page && found.length < limit) found.push(page);
      }
      if (batch.length < BATCH) break;
    }
    return { items: await this.items(workspaceId, subject, found) };
  }

  async search(
    actor: UserRecord,
    workspaceId: string,
    query: SearchQuery,
  ): Promise<SearchResultsDto> {
    const subject = await this.subject(actor, workspaceId);
    const filters = {
      ...(query.teamspaceId && { teamspaceId: query.teamspaceId }),
      ...(query.createdBy && { createdBy: query.createdBy }),
      ...(query.editedAfter && { editedAfter: new Date(query.editedAfter) }),
      ...(query.editedBefore && { editedBefore: new Date(query.editedBefore) }),
      ...(query.titleOnly && { titleOnly: true }),
    };
    let cursor = decodeCursor(query.cursor);
    const found: { page: PageRecord; snippet: string }[] = [];
    let scanned = 0;
    let exhausted = false;
    while (found.length < query.limit && scanned < SEARCH_SCAN) {
      const batch = await this.port.search(workspaceId, query.q, filters, cursor, BATCH);
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      const visible = await this.viewable(
        workspaceId,
        subject,
        batch.map((c) => c.pageId),
      );
      for (const c of batch) {
        scanned++;
        cursor = { rank: c.rank, pageId: c.pageId };
        const page = visible.get(c.pageId);
        if (page) found.push({ page, snippet: c.snippet });
        if (found.length === query.limit) break;
      }
      if (batch.length < BATCH && found.length < query.limit) {
        exhausted = true;
        break;
      }
    }
    const items = await this.items(
      workspaceId,
      subject,
      found.map((f) => f.page),
    );
    return {
      items: items.map((item, i) => ({
        ...item,
        snippet: found[i]!.snippet,
        updatedAt: found[i]!.page.updatedAt.toISOString(),
        createdBy: found[i]!.page.createdBy,
      })),
      nextCursor: !exhausted && cursor ? encodeCursor(cursor) : null,
    };
  }
}
