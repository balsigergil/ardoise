// SPDX-License-Identifier: AGPL-3.0-only
/** Synced entities and the sync protocol (ARCHITECTURE §6–7, ADR 0006). */
import { z } from 'zod';
import type { PageDto } from './pages.js';
import type { GrantPrincipalKind, GrantableLevel } from './permissions.js';
import type {
  TeamspaceDefaultLevel,
  TeamspaceRole,
  TeamspaceVisibility,
  WorkspaceRole,
} from './roles.js';

export interface FavoriteDto {
  pageId: string;
  position: string;
}

export interface FollowDto {
  pageId: string;
}

export interface GrantDto {
  pageId: string;
  principalKind: GrantPrincipalKind;
  principalId: string;
  level: GrantableLevel;
}

/** Present while a page has an active public link; the token is never logged. */
export interface PublicLinkStateDto {
  pageId: string;
  includeSubpages: boolean;
}

export interface WorkspaceEntityDto {
  id: string;
  name: string;
  icon: string | null;
}

export interface MemberEntityDto {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
}

export interface TeamspaceEntityDto {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  visibility: TeamspaceVisibility;
  defaultLevel: TeamspaceDefaultLevel;
}

export interface TeamspaceMemberEntityDto {
  teamspaceId: string;
  userId: string;
  role: TeamspaceRole;
}

/**
 * Access changed for a scope (ADR 0003 item 6): clients refetch (gained access) or
 * evict (lost access) what they cached under it.
 */
export interface AccessEntityDto {
  scope: 'page' | 'teamspace' | 'workspace';
  id: string;
  /** Users whose access changed, when known (memberships). */
  userIds: string[] | null;
}

export interface EntityMap {
  page: PageDto;
  favorite: FavoriteDto;
  follow: FollowDto;
  grant: GrantDto;
  publicLink: PublicLinkStateDto;
  workspace: WorkspaceEntityDto;
  member: MemberEntityDto;
  teamspace: TeamspaceEntityDto;
  teamspaceMember: TeamspaceMemberEntityDto;
  access: AccessEntityDto;
}

export type EntityType = keyof EntityMap;

export const entityTypes = [
  'page',
  'favorite',
  'follow',
  'grant',
  'publicLink',
  'workspace',
  'member',
  'teamspace',
  'teamspaceMember',
  'access',
] as const satisfies readonly EntityType[];

/** Entity ids for composite keys. */
export const entityIds = {
  grant: (g: Pick<GrantDto, 'pageId' | 'principalKind' | 'principalId'>) =>
    `${g.pageId}:${g.principalKind}:${g.principalId}`,
  teamspaceMember: (m: Pick<TeamspaceMemberEntityDto, 'teamspaceId' | 'userId'>) =>
    `${m.teamspaceId}:${m.userId}`,
};

export type Change = {
  [T in EntityType]:
    | { type: T; id: string; op: 'upsert'; data: EntityMap[T] }
    | { type: T; id: string; op: 'delete' };
}[EntityType];

/** A pulled change-log entry. */
export type ChangeEntry = Change & { seq: number };

export interface PullResponse {
  entries: ChangeEntry[];
  /** The seq to pass as `since` next time. */
  cursor: number;
  hasMore: boolean;
}

export const MAX_PULL_LIMIT = 1000;
export const MAX_PUSH_BATCH = 100;

export const pullQuerySchema = z.object({
  workspace: z.uuid(),
  since: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_LIMIT).default(500),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

export interface MutationResult {
  id: string;
  status: 'applied' | 'rejected';
  code?: string;
  /** The last seq of the entries it produced, if any. */
  seq?: number;
}

export interface PushResponse {
  results: MutationResult[];
}

/** Server → client messages on `/sync/ws`. */
export type SyncServerMessage = { type: 'poke'; workspaceId: string; seq: number };

/** Response wrapper for scoped reads: the seq they were read at (§7). */
export interface ScopedRead<T> {
  seq: number;
  data: T;
}
