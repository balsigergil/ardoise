// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Public links (PRODUCT §5, ADR 0004): anonymous, read-only access to a page and, when
 * enabled, its subpages. Unknown, revoked and uncovered pages all answer `not_found`.
 */
import {
  DomainError,
  publicLinkCovers,
  type PageListQuery,
  type PublicChildrenDto,
  type PublicPageDto,
} from '@ardoise/shared';
import type { SecretKeyring } from '../common/crypto.js';
import type { PermissionService } from '../permissions/permission.service.js';
import { decodeCursor, encodeCursor } from '../store/cursor.js';
import type { PageRecord, PublicLinkRecord, Store } from '../store/store.js';

export class PublicPageService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
    private readonly keyring: SecretKeyring,
  ) {}

  private async link(token: string): Promise<PublicLinkRecord> {
    if (token.length < 16 || token.length > 128) throw new DomainError('not_found');
    const link = await this.store.publicLinks.findByTokenHash(this.keyring.lookupHash(token));
    if (!link || link.revokedAt) throw new DomainError('not_found');
    return link;
  }

  /** The page if the link covers it (the link page, or a live subpage when included). */
  private async covered(
    link: PublicLinkRecord,
    pageId: string,
  ): Promise<{ page: PageRecord; chain: PageRecord[] }> {
    const page = await this.store.pages.findById(link.workspaceId, pageId);
    if (!page || page.deletedAt) throw new DomainError('not_found');
    const chains = await this.permissions.loadChains(link.workspaceId, [page]);
    const loaded = chains.get(page.id)!;
    if (
      !publicLinkCovers(
        { pageId: link.pageId, includeSubpages: link.includeSubpages },
        loaded.chain,
      )
    )
      throw new DomainError('not_found');
    return { page, chain: loaded.pages };
  }

  /** For files and content served to a public link: its workspace and a coverage check. */
  async access(token: string): Promise<{
    workspaceId: string;
    covers: (workspaceId: string, pageId: string) => Promise<boolean>;
  }> {
    const link = await this.link(token);
    return {
      workspaceId: link.workspaceId,
      covers: async (workspaceId, pageId) => {
        if (workspaceId !== link.workspaceId) return false;
        return this.covered(link, pageId).then(
          () => true,
          () => false,
        );
      },
    };
  }

  async page(token: string, pageId?: string): Promise<PublicPageDto> {
    const link = await this.link(token);
    const { page, chain } = await this.covered(link, pageId ?? link.pageId);
    const ancestors: PublicPageDto['ancestors'] = [];
    // chain is nearest first: walk up to the link page.
    for (const p of chain.slice(1)) {
      ancestors.unshift({ id: p.id, title: p.title, icon: p.icon });
      if (p.id === link.pageId) break;
    }
    const hasChildren =
      link.includeSubpages &&
      (await this.store.pages.withChildren(link.workspaceId, [page.id])).has(page.id);
    return {
      page: {
        id: page.id,
        title: page.title,
        icon: page.icon,
        cover: page.cover,
        width: page.width,
        font: page.font,
        hasChildren,
      },
      rootId: link.pageId,
      includeSubpages: link.includeSubpages,
      ancestors: page.id === link.pageId ? [] : ancestors,
    };
  }

  async children(token: string, pageId: string, query: PageListQuery): Promise<PublicChildrenDto> {
    const link = await this.link(token);
    if (!link.includeSubpages) return { items: [], nextCursor: null };
    const { page } = await this.covered(link, pageId);
    const after = decodeCursor(query.cursor, 2);
    const rows = await this.store.pages.children(
      link.workspaceId,
      page.id,
      after ? { position: after[0]!, id: after[1]! } : null,
      query.limit,
    );
    const batch = rows.slice(0, query.limit);
    const last = batch.at(-1);
    return {
      // Restricted subpages are not covered by a link set above them.
      items: batch
        .filter((c) => !c.restrictInheritance)
        .map((c) => ({
          id: c.id,
          title: c.title,
          icon: c.icon,
          cover: c.cover,
          hasChildren: c.hasChildren,
        })),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.position, last.id]) : null,
    };
  }
}
