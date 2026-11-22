// SPDX-License-Identifier: AGPL-3.0-only
/** Repository interfaces for pages, permissions and the change log (M2). */
import type {
  GrantableLevel,
  GrantRecord,
  PageCover,
  PageFont,
  PageIcon,
  PageKind,
  PageWidth,
  ParentKind,
  PrincipalKind,
} from '@ardoise/shared';

export interface PageRecord {
  workspaceId: string;
  id: string;
  kind: PageKind;
  parentKind: ParentKind;
  parentId: string;
  /** ltree of ancestor ids, root first, the page included (server-only). */
  path: string;
  isInline: boolean;
  moveState: 'moving' | null;
  position: string;
  title: string;
  icon: PageIcon;
  cover: PageCover;
  restrictInheritance: boolean;
  isLocked: boolean;
  isTemplate: boolean;
  width: PageWidth;
  font: PageFont;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedRootId: string | null;
}

export type PagePatch = Partial<
  Omit<PageRecord, 'workspaceId' | 'id' | 'kind' | 'createdBy' | 'createdAt'>
>;

export interface PageWithChildren extends PageRecord {
  hasChildren: boolean;
}

export interface SiblingCursor {
  position: string;
  id: string;
}

export interface SubtreeCursor {
  depth: number;
  id: string;
}

export interface PagesRepo {
  findById(workspaceId: string, id: string): Promise<PageRecord | undefined>;
  findMany(workspaceId: string, ids: readonly string[]): Promise<PageRecord[]>;
  insert(page: PageRecord): Promise<void>;
  insertMany(pages: readonly PageRecord[]): Promise<void>;
  update(workspaceId: string, id: string, patch: PagePatch): Promise<void>;
  /** Live, non-inline children ordered by (position, id), `limit` + 1 rows at most. */
  children(
    workspaceId: string,
    parentId: string,
    after: SiblingCursor | null,
    limit: number,
  ): Promise<PageWithChildren[]>;
  /** Ids among `ids` that have at least one live child. */
  withChildren(workspaceId: string, ids: readonly string[]): Promise<Set<string>>;
  /** Up to `cap` + 1: enough to compare with a threshold without counting everything. */
  subtreeSize(workspaceId: string, path: string, cap: number): Promise<number>;
  /**
   * Rewrites `path` for the subtree under `oldPath` to start with `newPath`. With a
   * `limit`, rewrites at most that many descendants, the root excluded (chunked job).
   */
  rewritePaths(
    workspaceId: string,
    oldPath: string,
    newPath: string,
    options?: { limit: number; excludeId: string },
  ): Promise<number>;
  /** Marks the live pages of the subtree as deleted under `rootId`. */
  trashSubtree(workspaceId: string, path: string, rootId: string, at: Date): Promise<number>;
  /** Clears the deletion of the pages deleted under `rootId`. */
  restoreSubtree(workspaceId: string, path: string, rootId: string): Promise<number>;
  purgeSubtree(workspaceId: string, path: string): Promise<number>;
  /** Pages of a subtree in (depth, id) order, the root first; `limit` rows. */
  subtreeBatch(
    workspaceId: string,
    path: string,
    after: SubtreeCursor | null,
    limit: number,
  ): Promise<(PageRecord & { depth: number })[]>;
  /** Trash roots, most recently deleted first; `limit` + 1 rows. */
  trashRoots(
    workspaceId: string,
    after: { deletedAt: Date; id: string } | null,
    limit: number,
    q?: string,
  ): Promise<PageRecord[]>;
  /** Pages flagged `moving` (large moves and duplicates in progress); few at a time. */
  movingRoots(workspaceId: string): Promise<PageRecord[]>;
  /** Trash roots deleted before `before`, across workspaces (retention job). */
  expiredTrashRoots(before: Date, limit: number): Promise<PageRecord[]>;
}

export interface GrantRow extends GrantRecord {
  level: GrantableLevel;
  createdBy: string | null;
  createdAt: Date;
}

export interface PrincipalRef {
  kind: PrincipalKind;
  id: string;
}

export interface GrantsRepo {
  forPages(workspaceId: string, pageIds: readonly string[]): Promise<GrantRow[]>;
  upsert(workspaceId: string, grant: GrantRow): Promise<void>;
  insertMany(workspaceId: string, grants: readonly GrantRow[]): Promise<void>;
  delete(workspaceId: string, pageId: string, principal: PrincipalRef): Promise<boolean>;
  /** Live pages granted to any of `principals`, ordered by page id; `limit` + 1 rows. */
  pagesFor(
    workspaceId: string,
    principals: readonly PrincipalRef[],
    afterPageId: string | null,
    limit: number,
  ): Promise<PageRecord[]>;
}

export interface FavoriteRecord {
  pageId: string;
  position: string;
}

export interface UserPagesRepo {
  favorites(workspaceId: string, userId: string, limit: number): Promise<FavoriteRecord[]>;
  favorite(
    workspaceId: string,
    userId: string,
    pageId: string,
  ): Promise<FavoriteRecord | undefined>;
  setFavorite(workspaceId: string, userId: string, favorite: FavoriteRecord): Promise<void>;
  removeFavorite(workspaceId: string, userId: string, pageId: string): Promise<boolean>;
  isFollowing(workspaceId: string, userId: string, pageId: string): Promise<boolean>;
  follow(workspaceId: string, userId: string, pageId: string): Promise<void>;
  unfollow(workspaceId: string, userId: string, pageId: string): Promise<boolean>;
  /** Upserts the visit and keeps the `keep` most recent. */
  touchRecent(
    workspaceId: string,
    userId: string,
    pageId: string,
    at: Date,
    keep: number,
  ): Promise<void>;
  recents(
    workspaceId: string,
    userId: string,
    limit: number,
  ): Promise<{ pageId: string; visitedAt: Date }[]>;
}

export interface PublicLinkRecord {
  workspaceId: string;
  id: string;
  pageId: string;
  tokenHash: string;
  tokenEncrypted: string;
  includeSubpages: boolean;
  createdBy: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface PublicLinksRepo {
  active(workspaceId: string, pageId: string): Promise<PublicLinkRecord | undefined>;
  activeForPages(workspaceId: string, pageIds: readonly string[]): Promise<PublicLinkRecord[]>;
  findByTokenHash(tokenHash: string): Promise<PublicLinkRecord | undefined>;
  insert(link: PublicLinkRecord): Promise<void>;
  update(workspaceId: string, id: string, patch: { includeSubpages: boolean }): Promise<void>;
  revoke(workspaceId: string, pageId: string, at: Date): Promise<void>;
}

export interface ChangeLogRow {
  workspaceId: string;
  seq: number;
  entityType: string;
  entityId: string;
  pageId: string | null;
  userId: string | null;
  op: 'upsert' | 'delete';
  data: unknown;
  mutationId: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface ChangeLogRepo {
  /** Locks the workspace counter row until the transaction ends; returns the current seq. */
  lockCounter(workspaceId: string): Promise<number>;
  /** Reserves `count` seqs; returns the last one. */
  allocate(workspaceId: string, count: number): Promise<number>;
  append(rows: readonly ChangeLogRow[]): Promise<void>;
  /** Entries with seq > `since`, ascending, at most `limit`. */
  since(workspaceId: string, since: number, limit: number): Promise<ChangeLogRow[]>;
  currentSeq(workspaceId: string): Promise<number>;
  /** Lowest retained seq, or null when the log is empty. */
  minSeq(workspaceId: string): Promise<number | null>;
  permEpoch(workspaceId: string): Promise<number>;
  /** Deletes entries and idempotency records older than `before` (horizon job). */
  purgeBefore(before: Date): Promise<number>;
}

export interface AppliedMutationsRepo {
  find(workspaceId: string, id: string): Promise<unknown>;
  /** False when the id was already recorded (concurrent duplicate). */
  insert(
    workspaceId: string,
    id: string,
    actorId: string,
    result: unknown,
    at: Date,
  ): Promise<boolean>;
}
