// SPDX-License-Identifier: AGPL-3.0-only
import {
  instanceSettings,
  invitations,
  passwordResets,
  sessions,
  teamspaceMembers,
  teamspaces,
  users,
  workspaceCounters,
  workspaceMembers,
  workspaces,
  type Database,
} from '@ardoise/db';
import { DomainError, type TeamspaceDefaultLevel } from '@ardoise/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { decodeCursor, likeContains, toPage } from './cursor.js';
import type {
  InvitationRecord,
  InvitationsRepo,
  PasswordResetsRepo,
  SessionsRepo,
  SettingsRepo,
  Store,
  TeamspacesRepo,
  UserRecord,
  UsersRepo,
  WorkspacesRepo,
} from './store.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: string }).code === '23505' &&
    (cause as { constraint?: string }).constraint === constraint
  );
}

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  passwordHash: users.passwordHash,
  locale: users.locale,
  theme: users.theme,
  isSuperAdmin: users.isSuperAdmin,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
};

const toUser = (
  row: typeof users.$inferSelect | Omit<typeof users.$inferSelect, 'avatarFileId'>,
): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.passwordHash,
  locale: row.locale === 'en' || row.locale === 'fr' ? row.locale : null,
  theme: row.theme,
  isSuperAdmin: row.isSuperAdmin,
  disabledAt: row.disabledAt,
  createdAt: row.createdAt,
});

function usersRepo(db: Executor): UsersRepo {
  return {
    async findById(id) {
      const [row] = await db.select(userColumns).from(users).where(eq(users.id, id));
      return row && toUser(row);
    },
    async findByEmail(email) {
      const [row] = await db.select(userColumns).from(users).where(eq(users.email, email));
      return row && toUser(row);
    },
    async insert(user) {
      try {
        await db.insert(users).values(user);
      } catch (error) {
        if (isUniqueViolation(error, 'users_email_key')) throw new DomainError('email_taken');
        throw error;
      }
    },
    async update(id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(users).set(patch).where(eq(users.id, id));
    },
    async delete(id) {
      await db.delete(users).where(eq(users.id, id));
    },
    async countActiveSuperAdmins() {
      const [row] = await db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.isSuperAdmin, true), isNull(users.disabledAt)));
      return row?.n ?? 0;
    },
    async anySuperAdmin() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isSuperAdmin, true))
        .limit(1);
      return rows.length > 0;
    },
    async list({ cursor, limit, q }) {
      const after = decodeCursor(cursor, 1);
      const filters: (SQL | undefined)[] = [
        after ? gt(users.email, after[0]!) : undefined,
        q ? or(ilike(users.email, likeContains(q)), ilike(users.name, likeContains(q))) : undefined,
      ];
      const rows = await db
        .select(userColumns)
        .from(users)
        .where(and(...filters))
        .orderBy(asc(users.email))
        .limit(limit + 1);
      return toPage(rows.map(toUser), limit, (u) => [u.email]);
    },
  };
}

function sessionsRepo(db: Executor): SessionsRepo {
  return {
    async insert(session) {
      await db.insert(sessions).values(session);
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
      return row;
    },
    async findById(id) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      return row;
    },
    async touch(id, at) {
      await db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id));
    },
    async revoke(ids, at) {
      if (ids.length === 0) return [];
      const rows = await db
        .update(sessions)
        .set({ revokedAt: at })
        .where(and(inArray(sessions.id, ids), isNull(sessions.revokedAt)))
        .returning({ tokenHash: sessions.tokenHash });
      return rows.map((r) => r.tokenHash);
    },
    async listLive(userId, now, limit) {
      return db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
        )
        .orderBy(desc(sessions.lastSeenAt))
        .limit(limit);
    },
  };
}

function passwordResetsRepo(db: Executor): PasswordResetsRepo {
  return {
    async insert(reset) {
      await db.insert(passwordResets).values(reset);
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash));
      return row;
    },
    async consume(id, userId, at) {
      const rows = await db
        .update(passwordResets)
        .set({ usedAt: at })
        .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)))
        .returning({ id: passwordResets.id });
      return rows.some((r) => r.id === id);
    },
  };
}

function invitationsRepo(db: Executor): InvitationsRepo {
  const scope = (workspaceId: string | null) =>
    workspaceId === null
      ? isNull(invitations.workspaceId)
      : eq(invitations.workspaceId, workspaceId);
  return {
    async insert(invitation) {
      await db.insert(invitations).values(invitation);
    },
    async findByTokenHash(tokenHash) {
      const [row] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
      return row;
    },
    async findById(id) {
      const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
      return row;
    },
    async markAccepted(id, at) {
      const rows = await db
        .update(invitations)
        .set({ acceptedAt: at })
        .where(
          and(
            eq(invitations.id, id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning({ id: invitations.id });
      return rows.length === 1;
    },
    async revoke(id, at) {
      await db
        .update(invitations)
        .set({ revokedAt: at })
        .where(
          and(
            eq(invitations.id, id),
            isNull(invitations.revokedAt),
            isNull(invitations.acceptedAt),
          ),
        );
    },
    async revokePending(email, workspaceId, at) {
      await db
        .update(invitations)
        .set({ revokedAt: at })
        .where(
          and(
            eq(invitations.email, email),
            scope(workspaceId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );
    },
    async listPending(workspaceId, now, { cursor, limit }) {
      const after = decodeCursor(cursor, 2);
      const rows: InvitationRecord[] = await db
        .select()
        .from(invitations)
        .where(
          and(
            scope(workspaceId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, now),
            after
              ? sql`(${invitations.createdAt}, ${invitations.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(invitations.createdAt), desc(invitations.id))
        .limit(limit + 1);
      return toPage(rows, limit, (i) => [i.createdAt.toISOString(), i.id]);
    },
  };
}

function settingsRepo(db: Executor): SettingsRepo {
  return {
    async get(key) {
      const [row] = await db
        .select({ value: instanceSettings.value })
        .from(instanceSettings)
        .where(eq(instanceSettings.key, key));
      return row?.value;
    },
    async set(key, value) {
      await db
        .insert(instanceSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: instanceSettings.key,
          set: { value, updatedAt: new Date() },
        });
    },
    async setIfAbsent(key, value) {
      await db.insert(instanceSettings).values({ key, value }).onConflictDoNothing();
      const [row] = await db
        .select({ value: instanceSettings.value })
        .from(instanceSettings)
        .where(eq(instanceSettings.key, key));
      return row?.value;
    },
    async delete(key) {
      await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
    },
  };
}

const memberCount = sql<number>`(SELECT count(*)::int FROM ${workspaceMembers} WHERE ${workspaceMembers.workspaceId} = ${workspaces.id})`;

function workspacesRepo(db: Executor): WorkspacesRepo {
  return {
    async create(workspace, ownerId) {
      await db.insert(workspaces).values(workspace);
      await db.insert(workspaceCounters).values({ workspaceId: workspace.id });
      await db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: ownerId,
        role: 'owner',
        createdAt: workspace.createdAt,
      });
    },
    async findById(id) {
      const [row] = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          icon: workspaces.icon,
          createdAt: workspaces.createdAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, id));
      return row;
    },
    async update(id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(workspaces).set(patch).where(eq(workspaces.id, id));
    },
    async listForUser(userId, limit) {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          icon: workspaces.icon,
          createdAt: workspaces.createdAt,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, userId))
        .orderBy(asc(workspaces.name), asc(workspaces.id))
        .limit(limit);
    },
    async listAll({ cursor, limit, q }) {
      const after = decodeCursor(cursor, 2);
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          icon: workspaces.icon,
          createdAt: workspaces.createdAt,
          memberCount,
        })
        .from(workspaces)
        .where(
          and(
            after
              ? sql`(${workspaces.name}, ${workspaces.id}) > (${after[0]}, ${after[1]}::uuid)`
              : undefined,
            q ? ilike(workspaces.name, likeContains(q)) : undefined,
          ),
        )
        .orderBy(asc(workspaces.name), asc(workspaces.id))
        .limit(limit + 1);
      return toPage(rows, limit, (w) => [w.name, w.id]);
    },
    async membership(workspaceId, userId) {
      const [row] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
      return row;
    },
    async listMembers(workspaceId, { cursor, limit, q }) {
      const after = decodeCursor(cursor, 1);
      const rows = await db
        .select({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
          email: users.email,
          name: users.name,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            after ? gt(users.email, after[0]!) : undefined,
            q
              ? or(ilike(users.email, likeContains(q)), ilike(users.name, likeContains(q)))
              : undefined,
          ),
        )
        .orderBy(asc(users.email))
        .limit(limit + 1);
      return toPage(rows, limit, (m) => [m.email]);
    },
    async addMember(member) {
      await db.insert(workspaceMembers).values(member).onConflictDoNothing();
    },
    async setMemberRole(workspaceId, userId, role) {
      await db
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
    },
    async removeMember(workspaceId, userId) {
      await db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
    },
    async countOwners(workspaceId) {
      const [row] = await db
        .select({ n: count() })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')),
        );
      return row?.n ?? 0;
    },
    async soleOwnerWorkspaces(userId) {
      const result = await db.execute<{ workspace_id: string }>(sql`
        SELECT m.workspace_id FROM ${workspaceMembers} m
        WHERE m.user_id = ${userId} AND m.role = 'owner'
          AND NOT EXISTS (
            SELECT 1 FROM ${workspaceMembers} o
            WHERE o.workspace_id = m.workspace_id AND o.role = 'owner' AND o.user_id <> m.user_id
          )`);
      return result.rows.map((r) => r.workspace_id);
    },
    async bumpPermEpoch(workspaceId) {
      await db
        .update(workspaceCounters)
        .set({ permEpoch: sql`${workspaceCounters.permEpoch} + 1` })
        .where(eq(workspaceCounters.workspaceId, workspaceId));
    },
  };
}

function teamspacesRepo(db: Executor): TeamspacesRepo {
  const tsKey = (workspaceId: string, id: string) =>
    and(eq(teamspaces.workspaceId, workspaceId), eq(teamspaces.id, id));
  const tmKey = (workspaceId: string, teamspaceId: string) =>
    and(
      eq(teamspaceMembers.workspaceId, workspaceId),
      eq(teamspaceMembers.teamspaceId, teamspaceId),
    );
  return {
    async insert(teamspace, ownerId) {
      await db.insert(teamspaces).values(teamspace);
      await db.insert(teamspaceMembers).values({
        workspaceId: teamspace.workspaceId,
        teamspaceId: teamspace.id,
        userId: ownerId,
        role: 'owner',
        createdAt: teamspace.createdAt,
      });
    },
    async findById(workspaceId, id) {
      const [row] = await db.select().from(teamspaces).where(tsKey(workspaceId, id));
      return row && { ...row, defaultLevel: row.defaultLevel as TeamspaceDefaultLevel };
    },
    async update(workspaceId, id, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(teamspaces).set(patch).where(tsKey(workspaceId, id));
    },
    async listVisible(workspaceId, userId, includeAll, { cursor, limit }) {
      const after = decodeCursor(cursor, 2);
      const myRole = sql<'owner' | 'member' | null>`(
        SELECT ${teamspaceMembers.role} FROM ${teamspaceMembers}
        WHERE ${teamspaceMembers.workspaceId} = ${teamspaces.workspaceId}
          AND ${teamspaceMembers.teamspaceId} = ${teamspaces.id}
          AND ${teamspaceMembers.userId} = ${userId})`;
      const members = sql<number>`(
        SELECT count(*)::int FROM ${teamspaceMembers}
        WHERE ${teamspaceMembers.workspaceId} = ${teamspaces.workspaceId}
          AND ${teamspaceMembers.teamspaceId} = ${teamspaces.id})`;
      const rows = await db
        .select({
          workspaceId: teamspaces.workspaceId,
          id: teamspaces.id,
          name: teamspaces.name,
          icon: teamspaces.icon,
          description: teamspaces.description,
          visibility: teamspaces.visibility,
          defaultLevel: teamspaces.defaultLevel,
          createdAt: teamspaces.createdAt,
          myRole,
          memberCount: members,
        })
        .from(teamspaces)
        .where(
          and(
            eq(teamspaces.workspaceId, workspaceId),
            includeAll
              ? undefined
              : sql`(${teamspaces.visibility} <> 'private' OR ${myRole} IS NOT NULL)`,
            after
              ? sql`(${teamspaces.name}, ${teamspaces.id}) > (${after[0]}, ${after[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(teamspaces.name), asc(teamspaces.id))
        .limit(limit + 1);
      return toPage(
        rows.map((r) => ({ ...r, defaultLevel: r.defaultLevel as TeamspaceDefaultLevel })),
        limit,
        (t) => [t.name, t.id],
      );
    },
    async membership(workspaceId, teamspaceId, userId) {
      const [row] = await db
        .select()
        .from(teamspaceMembers)
        .where(and(tmKey(workspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)));
      return row;
    },
    async listMembers(workspaceId, teamspaceId, { cursor, limit }) {
      const after = decodeCursor(cursor, 1);
      const rows = await db
        .select({
          workspaceId: teamspaceMembers.workspaceId,
          teamspaceId: teamspaceMembers.teamspaceId,
          userId: teamspaceMembers.userId,
          role: teamspaceMembers.role,
          createdAt: teamspaceMembers.createdAt,
          email: users.email,
          name: users.name,
        })
        .from(teamspaceMembers)
        .innerJoin(users, eq(users.id, teamspaceMembers.userId))
        .where(and(tmKey(workspaceId, teamspaceId), after ? gt(users.email, after[0]!) : undefined))
        .orderBy(asc(users.email))
        .limit(limit + 1);
      return toPage(rows, limit, (m) => [m.email]);
    },
    async addMember(member) {
      await db.insert(teamspaceMembers).values(member).onConflictDoNothing();
    },
    async setMemberRole(workspaceId, teamspaceId, userId, role) {
      await db
        .update(teamspaceMembers)
        .set({ role })
        .where(and(tmKey(workspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)));
    },
    async removeMember(workspaceId, teamspaceId, userId) {
      await db
        .delete(teamspaceMembers)
        .where(and(tmKey(workspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)));
    },
    async countOwners(workspaceId, teamspaceId) {
      const [row] = await db
        .select({ n: count() })
        .from(teamspaceMembers)
        .where(and(tmKey(workspaceId, teamspaceId), eq(teamspaceMembers.role, 'owner')));
      return row?.n ?? 0;
    },
    async countMembers(workspaceId, teamspaceId) {
      const [row] = await db
        .select({ n: count() })
        .from(teamspaceMembers)
        .where(tmKey(workspaceId, teamspaceId));
      return row?.n ?? 0;
    },
    async removeUserEverywhere(workspaceId, userId) {
      await db
        .delete(teamspaceMembers)
        .where(
          and(eq(teamspaceMembers.workspaceId, workspaceId), eq(teamspaceMembers.userId, userId)),
        );
    },
  };
}

export class DrizzleStore implements Store {
  readonly users: UsersRepo;
  readonly sessions: SessionsRepo;
  readonly passwordResets: PasswordResetsRepo;
  readonly invitations: InvitationsRepo;
  readonly settings: SettingsRepo;
  readonly workspaces: WorkspacesRepo;
  readonly teamspaces: TeamspacesRepo;

  constructor(private readonly db: Executor) {
    this.users = usersRepo(db);
    this.sessions = sessionsRepo(db);
    this.passwordResets = passwordResetsRepo(db);
    this.invitations = invitationsRepo(db);
    this.settings = settingsRepo(db);
    this.workspaces = workspacesRepo(db);
    this.teamspaces = teamspacesRepo(db);
  }

  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new DrizzleStore(tx)));
  }

  withLock<T>(name: string, fn: (store: Store) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ardoise:${name}`}))`);
      return fn(new DrizzleStore(tx));
    });
  }
}
