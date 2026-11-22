// SPDX-License-Identifier: AGPL-3.0-only
/** Scoped reads of the `pages` module (ARCHITECTURE §7); they carry the seq they were read at. */
import { z } from 'zod';
import type { PageCover, PageDto, PageIcon } from '../pages.js';
import type { AccessSource, GrantPrincipalKind, GrantableLevel } from '../permissions.js';
import type { PermissionLevel, TeamspaceDefaultLevel } from '../roles.js';

export const pageListQuerySchema = z.object({
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type PageListQuery = z.infer<typeof pageListQuerySchema>;

export const trashQuerySchema = pageListQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
});
export type TrashQuery = z.infer<typeof trashQuerySchema>;

export interface PageListDto {
  seq: number;
  items: PageDto[];
  nextCursor: string | null;
}

export interface BreadcrumbItemDto {
  id: string;
  title: string;
  icon: PageIcon;
  /** False for ancestors the user cannot open (shown without a title). */
  accessible: boolean;
}

export interface PageDetailDto {
  seq: number;
  page: PageDto;
  /** Root first, the page excluded. */
  ancestors: BreadcrumbItemDto[];
  section: { kind: 'teamspace' | 'private'; id: string; name: string | null } | null;
  level: PermissionLevel;
  isFavorite: boolean;
  isFollowing: boolean;
}

export interface SharingPrincipalDto {
  kind: GrantPrincipalKind;
  id: string;
  name: string;
  /** Users only. */
  email: string | null;
}

export interface SharingGrantDto {
  principal: SharingPrincipalDto;
  level: GrantableLevel;
  /** Null when granted on this page, else the page it is inherited from. */
  inheritedFrom: { id: string; title: string } | null;
}

export interface SharingDto {
  seq: number;
  pageId: string;
  myLevel: PermissionLevel;
  restrictInheritance: boolean;
  /** Set when inheritance stops at an ancestor that restricts it. */
  restrictedAt: { id: string; title: string } | null;
  grants: SharingGrantDto[];
  /** The base access of the section, when inheritance reaches it. */
  root:
    | { kind: 'teamspace'; id: string; name: string; defaultLevel: TeamspaceDefaultLevel }
    | { kind: 'private'; userId: string; name: string }
    | null;
  /** Why the current user has their level. */
  mySources: AccessSource[];
  /** Full-access users see the URL; others only whether a link exists. */
  publicLink: { enabled: boolean; includeSubpages: boolean; url: string | null };
  /** Workspace owners may recover access to non-private pages (PRODUCT §13). */
  canRecover: boolean;
}

export interface RecentDto {
  page: PageDto;
  visitedAt: string;
}

export interface PublicPageDto {
  page: Pick<PageDto, 'id' | 'title' | 'icon' | 'cover' | 'width' | 'font'> & {
    hasChildren: boolean;
  };
  /** The link page, for subpages. */
  rootId: string;
  includeSubpages: boolean;
  /** From the link page down to the parent, for subpages. */
  ancestors: { id: string; title: string; icon: PageIcon }[];
}

export interface PublicChildDto {
  id: string;
  title: string;
  icon: PageIcon;
  cover: PageCover;
  hasChildren: boolean;
}

export interface PublicChildrenDto {
  items: PublicChildDto[];
  nextCursor: string | null;
}
