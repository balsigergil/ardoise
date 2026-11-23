// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `projection` module (ARCHITECTURE §11): stored Yjs documents → `page_search`,
 * `page_links` and `page_mentions_users`, plus the backlinks read.
 */
import { projectState } from '@ardoise/editor';
import { atLeast, DomainError, type BacklinksDto, type BacklinksQuery } from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import type { JobPayloads, JobQueue } from '../jobs/jobs.js';
import type { PermissionService } from '../permissions/permission.service.js';
import { PROJECTION_DELAY_MS } from '../collab/collab-persistence.js';
import type { Store, UserRecord } from '../store/store.js';

export class ProjectionService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly jobs: JobQueue,
    private readonly logger: Pick<Logger, 'log' | 'warn'>,
  ) {}

  /** The `projection.document` job. */
  async projectDocument(payload: JobPayloads['projection.document']): Promise<void> {
    const { workspaceId, pageId, docName } = payload;
    const row = await this.store.documents.find(workspaceId, docName);
    if (!row) return;
    const page = await this.store.pages.findById(workspaceId, pageId);
    if (!page) return;
    const projection = projectState(row.state);
    // Synced blocks (M6) and plugin subdocuments (M9) project into their source page.
    if (docName === `page:${pageId}`) {
      const fresh = await this.store.transaction(async (store) => {
        await store.projection.upsertContent(workspaceId, pageId, page.title, projection.plainText);
        await store.projection.replaceLinks(
          workspaceId,
          pageId,
          projection.links.filter((l) => l.pageId !== pageId),
        );
        return store.projection.replaceUserMentions(workspaceId, pageId, projection.userMentions);
      });
      // Mention notifications arrive with M6; new mentions are known here.
      if (fresh.length)
        this.logger.log({ workspaceId, pageId, count: fresh.length }, 'new mentions');
    }
    // Stored again while this ran (and missed by the deduplication): project once more.
    const after = await this.store.documents.find(workspaceId, docName);
    if (after && after.updatedAt.getTime() > row.updatedAt.getTime()) {
      await this.jobs.enqueue('projection.document', payload, {
        debounce: { id: `projection:${workspaceId}:${docName}`, delayMs: PROJECTION_DELAY_MS },
      });
    }
  }

  /** Pages linking to or mentioning `pageId` that the actor can view (paginated). */
  async backlinks(
    actor: UserRecord,
    workspaceId: string,
    pageId: string,
    query: BacklinksQuery,
  ): Promise<BacklinksDto> {
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');
    const subject = await this.permissions.subject(workspaceId, actor.id, member.role);
    const target = await this.store.pages.findById(workspaceId, pageId);
    if (!target) throw new DomainError('not_found');
    await this.permissions.require(workspaceId, subject, target, 'can_view');

    const rows = await this.store.projection.backlinks(
      workspaceId,
      pageId,
      query.cursor ?? null,
      query.limit,
    );
    const hasMore = rows.length > query.limit;
    const window = rows.slice(0, query.limit);
    const pages = (
      await this.store.pages.findMany(
        workspaceId,
        window.map((r) => r.sourcePageId),
      )
    ).filter((p) => !p.deletedAt);
    const levels = await this.permissions.levels(workspaceId, subject, pages);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const items = window.flatMap((row) => {
      const page = byId.get(row.sourcePageId);
      if (!page || !atLeast(levels.get(page.id) ?? 'no_access', 'can_view')) return [];
      return [
        {
          page: { id: page.id, title: page.title, icon: page.icon },
          kinds: row.kinds,
        },
      ];
    });
    return { items, nextCursor: hasMore ? (window.at(-1)?.sourcePageId ?? null) : null };
  }
}
