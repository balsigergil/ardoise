// SPDX-License-Identifier: AGPL-3.0-only
import {
  emptyContentData,
  memoryDocumentsRepo,
  memoryFilesRepo,
  memoryProjectionRepo,
  type MemoryContentData,
} from './memory-content-store.js';
/* eslint-disable @typescript-eslint/require-await -- fakes mirror the async repository interface */
/**
 * In-memory `Store` for unit tests. Same ordering and pagination rules as the Drizzle
 * store; transactions run the callback directly (no rollback).
 */
import { DomainError } from '@ardoise/shared';
import { decodeCursor, toPage } from './cursor.js';
import {
  emptySyncData,
  memoryAppliedMutationsRepo,
  memoryChangeLogRepo,
  memoryGrantsRepo,
  memoryPagesRepo,
  memoryPublicLinksRepo,
  memoryUserPagesRepo,
  type MemorySyncData,
} from './memory-sync-store.js';
import type {
  InvitationRecord,
  MemberRecord,
  PasswordResetRecord,
  SessionRecord,
  Store,
  TeamspaceMemberRecord,
  TeamspaceRecord,
  UserRecord,
  WorkspaceRecord,
} from './store.js';

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const contains = (q: string | undefined, ...values: string[]) =>
  !q || values.some((v) => v.toLowerCase().includes(q.toLowerCase()));

export class MemoryStore implements Store {
  readonly data = {
    users: new Map<string, UserRecord>(),
    sessions: new Map<string, SessionRecord>(),
    resets: new Map<string, PasswordResetRecord>(),
    invitations: new Map<string, InvitationRecord>(),
    settings: new Map<string, unknown>(),
    workspaces: new Map<string, WorkspaceRecord>(),
    members: [] as MemberRecord[],
    teamspaces: [] as TeamspaceRecord[],
    teamspaceMembers: [] as TeamspaceMemberRecord[],
    permEpochs: new Map<string, number>(),
  };
  readonly sync: MemorySyncData = emptySyncData(this.data.permEpochs);
  readonly pages = memoryPagesRepo(this.sync);
  readonly grants = memoryGrantsRepo(this.sync);
  readonly userPages = memoryUserPagesRepo(this.sync);
  readonly publicLinks = memoryPublicLinksRepo(this.sync);
  readonly changeLog = memoryChangeLogRepo(this.sync);
  readonly appliedMutations = memoryAppliedMutationsRepo(this.sync);
  readonly content: MemoryContentData = emptyContentData();
  readonly documents = memoryDocumentsRepo(this.content);
  readonly files = memoryFilesRepo(this.content, this.sync);
  readonly projection = memoryProjectionRepo(this.content);

  readonly users: Store['users'] = {
    findById: async (id) => this.data.users.get(id),
    findByEmail: async (email) => [...this.data.users.values()].find((u) => u.email === email),
    insert: async (user) => {
      if ([...this.data.users.values()].some((u) => u.email === user.email))
        throw new DomainError('email_taken');
      this.data.users.set(user.id, { ...user });
    },
    update: async (id, patch) => {
      const user = this.data.users.get(id);
      if (user) this.data.users.set(id, { ...user, ...patch });
    },
    delete: async (id) => {
      this.data.users.delete(id);
      this.data.members = this.data.members.filter((m) => m.userId !== id);
      this.data.teamspaceMembers = this.data.teamspaceMembers.filter((m) => m.userId !== id);
      for (const [key, s] of this.data.sessions)
        if (s.userId === id) this.data.sessions.delete(key);
    },
    countActiveSuperAdmins: async () =>
      [...this.data.users.values()].filter((u) => u.isSuperAdmin && !u.disabledAt).length,
    anySuperAdmin: async () => [...this.data.users.values()].some((u) => u.isSuperAdmin),
    list: async ({ cursor, limit, q }) => {
      const after = decodeCursor(cursor, 1)?.[0];
      const rows = [...this.data.users.values()]
        .filter((u) => (after === undefined || u.email > after) && contains(q, u.email, u.name))
        .sort((a, b) => byKey(a.email, b.email))
        .slice(0, limit + 1);
      return toPage(rows, limit, (u) => [u.email]);
    },
  };

  readonly sessions: Store['sessions'] = {
    insert: async (session) => void this.data.sessions.set(session.id, { ...session }),
    findByTokenHash: async (hash) =>
      [...this.data.sessions.values()].find((s) => s.tokenHash === hash),
    findById: async (id) => this.data.sessions.get(id),
    touch: async (id, at) => {
      const s = this.data.sessions.get(id);
      if (s) s.lastSeenAt = at;
    },
    revoke: async (ids, at) => {
      const hashes: string[] = [];
      for (const id of ids) {
        const s = this.data.sessions.get(id);
        if (s && !s.revokedAt) {
          s.revokedAt = at;
          hashes.push(s.tokenHash);
        }
      }
      return hashes;
    },
    listLive: async (userId, now, limit) =>
      [...this.data.sessions.values()]
        .filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt > now)
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
        .slice(0, limit),
  };

  readonly passwordResets: Store['passwordResets'] = {
    insert: async (reset) => void this.data.resets.set(reset.id, { ...reset }),
    findByTokenHash: async (hash) =>
      [...this.data.resets.values()].find((r) => r.tokenHash === hash),
    consume: async (id, userId, at) => {
      let found = false;
      for (const r of this.data.resets.values()) {
        if (r.userId === userId && !r.usedAt) {
          r.usedAt = at;
          if (r.id === id) found = true;
        }
      }
      return found;
    },
  };

  readonly invitations: Store['invitations'] = {
    insert: async (inv) => void this.data.invitations.set(inv.id, { ...inv }),
    findByTokenHash: async (hash) =>
      [...this.data.invitations.values()].find((i) => i.tokenHash === hash),
    findById: async (id) => this.data.invitations.get(id),
    markAccepted: async (id, at) => {
      const inv = this.data.invitations.get(id);
      if (!inv || inv.acceptedAt || inv.revokedAt) return false;
      inv.acceptedAt = at;
      return true;
    },
    revoke: async (id, at) => {
      const inv = this.data.invitations.get(id);
      if (inv && !inv.acceptedAt && !inv.revokedAt) inv.revokedAt = at;
    },
    revokePending: async (email, workspaceId, at) => {
      for (const inv of this.data.invitations.values())
        if (
          inv.email === email &&
          inv.workspaceId === workspaceId &&
          !inv.acceptedAt &&
          !inv.revokedAt
        )
          inv.revokedAt = at;
    },
    listPending: async (workspaceId, now, { cursor, limit }) => {
      const after = decodeCursor(cursor, 2);
      const key = (i: InvitationRecord) => `${i.createdAt.toISOString()}|${i.id}`;
      const rows = [...this.data.invitations.values()]
        .filter(
          (i) =>
            i.workspaceId === workspaceId &&
            !i.acceptedAt &&
            !i.revokedAt &&
            i.expiresAt > now &&
            (!after || key(i) < `${after[0]}|${after[1]}`),
        )
        .sort((a, b) => byKey(key(b), key(a)))
        .slice(0, limit + 1);
      return toPage(rows, limit, (i) => [i.createdAt.toISOString(), i.id]);
    },
  };

  readonly settings: Store['settings'] = {
    get: async (key) => this.data.settings.get(key),
    set: async (key, value) => void this.data.settings.set(key, value),
    setIfAbsent: async (key, value) => {
      if (!this.data.settings.has(key)) this.data.settings.set(key, value);
      return this.data.settings.get(key);
    },
    delete: async (key) => void this.data.settings.delete(key),
  };

  readonly workspaces: Store['workspaces'] = {
    create: async (ws, ownerId) => {
      this.data.workspaces.set(ws.id, { ...ws });
      this.data.permEpochs.set(ws.id, 0);
      this.data.members.push({
        workspaceId: ws.id,
        userId: ownerId,
        role: 'owner',
        createdAt: ws.createdAt,
      });
    },
    findById: async (id) => this.data.workspaces.get(id),
    update: async (id, patch) => {
      const ws = this.data.workspaces.get(id);
      if (ws) this.data.workspaces.set(id, { ...ws, ...patch });
    },
    listForUser: async (userId, limit) =>
      this.data.members
        .filter((m) => m.userId === userId)
        .map((m) => ({ ...this.data.workspaces.get(m.workspaceId)!, role: m.role }))
        .sort((a, b) => byKey(a.name, b.name) || byKey(a.id, b.id))
        .slice(0, limit),
    listAll: async ({ cursor, limit, q }) => {
      const after = decodeCursor(cursor, 2);
      const rows = [...this.data.workspaces.values()]
        .filter(
          (w) =>
            contains(q, w.name) &&
            (!after || byKey(w.name, after[0]!) > 0 || (w.name === after[0] && w.id > after[1]!)),
        )
        .sort((a, b) => byKey(a.name, b.name) || byKey(a.id, b.id))
        .slice(0, limit + 1)
        .map((w) => ({
          ...w,
          memberCount: this.data.members.filter((m) => m.workspaceId === w.id).length,
        }));
      return toPage(rows, limit, (w) => [w.name, w.id]);
    },
    membership: async (workspaceId, userId) =>
      this.data.members.find((m) => m.workspaceId === workspaceId && m.userId === userId),
    listMembers: async (workspaceId, { cursor, limit, q }) => {
      const after = decodeCursor(cursor, 1)?.[0];
      const rows = this.data.members
        .filter((m) => m.workspaceId === workspaceId)
        .map((m) => {
          const user = this.data.users.get(m.userId)!;
          return { ...m, email: user.email, name: user.name };
        })
        .filter((m) => (after === undefined || m.email > after) && contains(q, m.email, m.name))
        .sort((a, b) => byKey(a.email, b.email))
        .slice(0, limit + 1);
      return toPage(rows, limit, (m) => [m.email]);
    },
    addMember: async (member) => {
      if (
        !this.data.members.some(
          (m) => m.workspaceId === member.workspaceId && m.userId === member.userId,
        )
      )
        this.data.members.push({ ...member });
    },
    setMemberRole: async (workspaceId, userId, role) => {
      const m = this.data.members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
      if (m) m.role = role;
    },
    removeMember: async (workspaceId, userId) => {
      this.data.members = this.data.members.filter(
        (m) => !(m.workspaceId === workspaceId && m.userId === userId),
      );
      this.data.teamspaceMembers = this.data.teamspaceMembers.filter(
        (m) => !(m.workspaceId === workspaceId && m.userId === userId),
      );
    },
    countOwners: async (workspaceId) =>
      this.data.members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner').length,
    soleOwnerWorkspaces: async (userId) =>
      this.data.members
        .filter((m) => m.userId === userId && m.role === 'owner')
        .filter(
          (m) =>
            !this.data.members.some(
              (o) => o.workspaceId === m.workspaceId && o.role === 'owner' && o.userId !== userId,
            ),
        )
        .map((m) => m.workspaceId),
    bumpPermEpoch: async (workspaceId) => {
      this.data.permEpochs.set(workspaceId, (this.data.permEpochs.get(workspaceId) ?? 0) + 1);
    },
  };

  readonly teamspaces: Store['teamspaces'] = {
    insert: async (ts, ownerId) => {
      this.data.teamspaces.push({ ...ts });
      this.data.teamspaceMembers.push({
        workspaceId: ts.workspaceId,
        teamspaceId: ts.id,
        userId: ownerId,
        role: 'owner',
        createdAt: ts.createdAt,
      });
    },
    findById: async (workspaceId, id) =>
      this.data.teamspaces.find((t) => t.workspaceId === workspaceId && t.id === id),
    update: async (workspaceId, id, patch) => {
      const t = this.data.teamspaces.find((x) => x.workspaceId === workspaceId && x.id === id);
      if (t) Object.assign(t, patch);
    },
    listVisible: async (workspaceId, userId, scope, { cursor, limit }) => {
      const after = decodeCursor(cursor, 2);
      const rows = this.data.teamspaces
        .filter((t) => t.workspaceId === workspaceId)
        .map((t) => {
          const members = this.data.teamspaceMembers.filter(
            (m) => m.workspaceId === workspaceId && m.teamspaceId === t.id,
          );
          return {
            ...t,
            myRole: members.find((m) => m.userId === userId)?.role ?? null,
            memberCount: members.length,
          };
        })
        .filter((t) =>
          scope === 'all'
            ? true
            : scope === 'mine'
              ? t.myRole !== null
              : t.visibility !== 'private' || t.myRole !== null,
        )
        .filter(
          (t) =>
            !after || byKey(t.name, after[0]!) > 0 || (t.name === after[0] && t.id > after[1]!),
        )
        .sort((a, b) => byKey(a.name, b.name) || byKey(a.id, b.id))
        .slice(0, limit + 1);
      return toPage(rows, limit, (t) => [t.name, t.id]);
    },
    membership: async (workspaceId, teamspaceId, userId) =>
      this.data.teamspaceMembers.find(
        (m) =>
          m.workspaceId === workspaceId && m.teamspaceId === teamspaceId && m.userId === userId,
      ),
    listMembers: async (workspaceId, teamspaceId, { cursor, limit }) => {
      const after = decodeCursor(cursor, 1)?.[0];
      const rows = this.data.teamspaceMembers
        .filter((m) => m.workspaceId === workspaceId && m.teamspaceId === teamspaceId)
        .map((m) => {
          const user = this.data.users.get(m.userId)!;
          return { ...m, email: user.email, name: user.name };
        })
        .filter((m) => after === undefined || m.email > after)
        .sort((a, b) => byKey(a.email, b.email))
        .slice(0, limit + 1);
      return toPage(rows, limit, (m) => [m.email]);
    },
    addMember: async (member) => {
      if (
        !(await this.teamspaces.membership(member.workspaceId, member.teamspaceId, member.userId))
      )
        this.data.teamspaceMembers.push({ ...member });
    },
    setMemberRole: async (workspaceId, teamspaceId, userId, role) => {
      const m = await this.teamspaces.membership(workspaceId, teamspaceId, userId);
      if (m) m.role = role;
    },
    removeMember: async (workspaceId, teamspaceId, userId) => {
      this.data.teamspaceMembers = this.data.teamspaceMembers.filter(
        (m) =>
          !(m.workspaceId === workspaceId && m.teamspaceId === teamspaceId && m.userId === userId),
      );
    },
    countOwners: async (workspaceId, teamspaceId) =>
      this.data.teamspaceMembers.filter(
        (m) => m.workspaceId === workspaceId && m.teamspaceId === teamspaceId && m.role === 'owner',
      ).length,
    countMembers: async (workspaceId, teamspaceId) =>
      this.data.teamspaceMembers.filter(
        (m) => m.workspaceId === workspaceId && m.teamspaceId === teamspaceId,
      ).length,
    removeUserEverywhere: async (workspaceId, userId) => {
      this.data.teamspaceMembers = this.data.teamspaceMembers.filter(
        (m) => !(m.workspaceId === workspaceId && m.userId === userId),
      );
    },
    findMany: async (workspaceId, ids) =>
      this.data.teamspaces.filter((t) => t.workspaceId === workspaceId && ids.includes(t.id)),
    rolesForUser: async (workspaceId, userId, limit) =>
      new Map(
        this.data.teamspaceMembers
          .filter((m) => m.workspaceId === workspaceId && m.userId === userId)
          .slice(0, limit)
          .map((m) => [m.teamspaceId, m.role]),
      ),
  };

  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }

  withLock<T>(_name: string, fn: (store: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
