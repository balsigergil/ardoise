// SPDX-License-Identifier: AGPL-3.0-only
import type { DocumentsRepo, FilesRepo, ProjectionRepo } from './content-store.js';
/**
 * Repository interfaces (CLAUDE.md §4: persistence behind repositories). Services
 * depend on these; `drizzle-store.ts` implements them and `memory-store.ts` backs
 * unit tests.
 */
import type {
  Page,
  TeamspaceDefaultLevel,
  TeamspaceRole,
  TeamspaceVisibility,
  WorkspaceRole,
} from '@ardoise/shared';
import type {
  AppliedMutationsRepo,
  ChangeLogRepo,
  GrantsRepo,
  PagesRepo,
  PublicLinksRepo,
  UserPagesRepo,
} from './sync-store.js';

export type * from './sync-store.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  locale: 'en' | 'fr' | null;
  theme: 'light' | 'dark' | 'system';
  isSuperAdmin: boolean;
  disabledAt: Date | null;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  revokedAt: Date | null;
}

export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface InvitationRecord {
  id: string;
  email: string;
  tokenHash: string;
  inviterId: string | null;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  icon: string | null;
  createdAt: Date;
}

export interface MemberRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export interface TeamspaceRecord {
  workspaceId: string;
  id: string;
  name: string;
  icon: string | null;
  description: string;
  visibility: TeamspaceVisibility;
  defaultLevel: TeamspaceDefaultLevel;
  createdAt: Date;
}

export interface TeamspaceMemberRecord {
  workspaceId: string;
  teamspaceId: string;
  userId: string;
  role: TeamspaceRole;
  createdAt: Date;
}

export interface ListOptions {
  cursor?: string | undefined;
  limit: number;
  q?: string | undefined;
}

export interface UsersRepo {
  findById(id: string): Promise<UserRecord | undefined>;
  findByEmail(email: string): Promise<UserRecord | undefined>;
  /** Fails with `email_taken` when the email exists. */
  insert(user: UserRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): Promise<void>;
  delete(id: string): Promise<void>;
  /** Active (not disabled) super-admins. */
  countActiveSuperAdmins(): Promise<number>;
  anySuperAdmin(): Promise<boolean>;
  /** Ordered by email; the cursor is the last email. */
  list(options: ListOptions): Promise<Page<UserRecord>>;
}

export interface SessionsRepo {
  insert(session: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  findById(id: string): Promise<SessionRecord | undefined>;
  touch(id: string, at: Date): Promise<void>;
  /** Revokes and returns the token hashes, for cache eviction. */
  revoke(ids: string[], at: Date): Promise<string[]>;
  /** Sessions not revoked and not past their absolute expiry, most recent first. */
  listLive(userId: string, now: Date, limit: number): Promise<SessionRecord[]>;
}

export interface PasswordResetsRepo {
  insert(reset: PasswordResetRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  /** Marks every unused reset of the user as used. Returns true if `id` was unused. */
  consume(id: string, userId: string, at: Date): Promise<boolean>;
}

export interface InvitationsRepo {
  insert(invitation: InvitationRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined>;
  findById(id: string): Promise<InvitationRecord | undefined>;
  /** Conditional update: true only if the invitation was still unaccepted and unrevoked. */
  markAccepted(id: string, at: Date): Promise<boolean>;
  revoke(id: string, at: Date): Promise<void>;
  /** Revokes pending invitations for the same email and scope (re-invite replaces). */
  revokePending(email: string, workspaceId: string | null, at: Date): Promise<void>;
  /** Pending (not accepted, not revoked, not expired) invitations, newest first. */
  listPending(
    workspaceId: string | null,
    now: Date,
    options: ListOptions,
  ): Promise<Page<InvitationRecord>>;
}

export interface SettingsRepo {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** Inserts only when absent; returns the stored value either way. */
  setIfAbsent(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface WorkspaceSummary extends WorkspaceRecord {
  memberCount: number;
}

export interface MemberWithUser extends MemberRecord {
  email: string;
  name: string;
}

export interface WorkspacesRepo {
  /** Creates the workspace, its counters row and the owner membership. */
  create(workspace: WorkspaceRecord, ownerId: string): Promise<void>;
  findById(id: string): Promise<WorkspaceRecord | undefined>;
  update(id: string, patch: Partial<Pick<WorkspaceRecord, 'name' | 'icon'>>): Promise<void>;
  /** A user's workspaces, ordered by name (bounded by `limit`). */
  listForUser(
    userId: string,
    limit: number,
  ): Promise<(WorkspaceRecord & { role: WorkspaceRole })[]>;
  listAll(options: ListOptions): Promise<Page<WorkspaceSummary>>;
  membership(workspaceId: string, userId: string): Promise<MemberRecord | undefined>;
  listMembers(workspaceId: string, options: ListOptions): Promise<Page<MemberWithUser>>;
  addMember(member: MemberRecord): Promise<void>;
  setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
  countOwners(workspaceId: string): Promise<number>;
  /** Workspaces where the user is the only owner. */
  soleOwnerWorkspaces(userId: string): Promise<string[]>;
  /** Any grant, membership or role change invalidates cached permissions (ARCHITECTURE §9). */
  bumpPermEpoch(workspaceId: string): Promise<void>;
}

export type TeamspaceScope = 'visible' | 'all' | 'mine';

export interface TeamspaceWithStats extends TeamspaceRecord {
  myRole: TeamspaceRole | null;
  memberCount: number;
}

export interface TeamspaceMemberWithUser extends TeamspaceMemberRecord {
  email: string;
  name: string;
}

export interface TeamspacesRepo {
  insert(teamspace: TeamspaceRecord, ownerId: string): Promise<void>;
  findById(workspaceId: string, id: string): Promise<TeamspaceRecord | undefined>;
  update(
    workspaceId: string,
    id: string,
    patch: Partial<
      Pick<TeamspaceRecord, 'name' | 'icon' | 'description' | 'visibility' | 'defaultLevel'>
    >,
  ): Promise<void>;
  /**
   * Teamspaces ordered by name then id. `visible`: non-private ones plus the user's;
   * `all`: every teamspace (workspace owners/admins); `mine`: the user's only.
   */
  listVisible(
    workspaceId: string,
    userId: string,
    scope: TeamspaceScope,
    options: ListOptions,
  ): Promise<Page<TeamspaceWithStats>>;
  membership(
    workspaceId: string,
    teamspaceId: string,
    userId: string,
  ): Promise<TeamspaceMemberRecord | undefined>;
  listMembers(
    workspaceId: string,
    teamspaceId: string,
    options: ListOptions,
  ): Promise<Page<TeamspaceMemberWithUser>>;
  addMember(member: TeamspaceMemberRecord): Promise<void>;
  setMemberRole(
    workspaceId: string,
    teamspaceId: string,
    userId: string,
    role: TeamspaceRole,
  ): Promise<void>;
  removeMember(workspaceId: string, teamspaceId: string, userId: string): Promise<void>;
  countOwners(workspaceId: string, teamspaceId: string): Promise<number>;
  countMembers(workspaceId: string, teamspaceId: string): Promise<number>;
  /** Removes the user from every teamspace of the workspace. */
  removeUserEverywhere(workspaceId: string, userId: string): Promise<void>;
  findMany(workspaceId: string, ids: readonly string[]): Promise<TeamspaceRecord[]>;
  /** The user's teamspace roles in the workspace (bounded by `limit`). */
  rolesForUser(
    workspaceId: string,
    userId: string,
    limit: number,
  ): Promise<Map<string, TeamspaceRole>>;
}

export interface Store {
  users: UsersRepo;
  sessions: SessionsRepo;
  passwordResets: PasswordResetsRepo;
  invitations: InvitationsRepo;
  settings: SettingsRepo;
  workspaces: WorkspacesRepo;
  teamspaces: TeamspacesRepo;
  pages: PagesRepo;
  grants: GrantsRepo;
  userPages: UserPagesRepo;
  publicLinks: PublicLinksRepo;
  changeLog: ChangeLogRepo;
  appliedMutations: AppliedMutationsRepo;
  documents: DocumentsRepo;
  files: FilesRepo;
  projection: ProjectionRepo;
  /** Runs `fn` in one database transaction. */
  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T>;
  /** Serializes `fn` across processes with a transaction-scoped advisory lock. */
  withLock<T>(name: string, fn: (store: Store) => Promise<T>): Promise<T>;
}
