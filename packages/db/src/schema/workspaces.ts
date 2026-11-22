// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users, workspaceRole } from './instance.js';

const timestamps = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const teamspaceVisibility = pgEnum('teamspace_visibility', ['open', 'closed', 'private']);
export const teamspaceRole = pgEnum('teamspace_role', ['owner', 'member']);
export const permissionLevel = pgEnum('permission_level', [
  'full_access',
  'can_edit',
  'can_edit_content',
  'can_comment',
  'can_view',
  'no_access',
]);

/** ARCHITECTURE §4.2. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamps('created_at').notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    // The one cross-workspace index: a user's workspaces (ADR 0005).
    index('workspace_members_user_idx').on(t.userId, t.workspaceId),
    index('workspace_members_role_idx').on(t.workspaceId, t.role),
  ],
);

export const workspaceCounters = pgTable('workspace_counters', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  changeSeq: bigint('change_seq', { mode: 'bigint' }).notNull().default(sql`0`),
  permEpoch: bigint('perm_epoch', { mode: 'bigint' }).notNull().default(sql`0`),
  uniqueIdCounters: jsonb('unique_id_counters').notNull().default({}),
});

export const teamspaces = pgTable(
  'teamspaces',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    description: text('description').notNull().default(''),
    visibility: teamspaceVisibility('visibility').notNull().default('open'),
    defaultLevel: permissionLevel('default_level').notNull().default('can_edit'),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] })],
);

export const teamspaceMembers = pgTable(
  'teamspace_members',
  {
    workspaceId: uuid('workspace_id').notNull(),
    teamspaceId: uuid('teamspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: teamspaceRole('role').notNull(),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.teamspaceId, t.userId] }),
    index('teamspace_members_user_idx').on(t.workspaceId, t.userId),
    foreignKey({
      columns: [t.workspaceId, t.teamspaceId],
      foreignColumns: [teamspaces.workspaceId, teamspaces.id],
    }).onDelete('cascade'),
    // Leaving the workspace removes teamspace memberships too.
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    inviterId: uuid('inviter_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** null for instance invitations. */
    role: workspaceRole('role'),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    expiresAt: timestamps('expires_at').notNull(),
    acceptedAt: timestamps('accepted_at'),
    revokedAt: timestamps('revoked_at'),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_workspace_idx').on(t.workspaceId, t.createdAt),
    index('invitations_email_idx').on(t.email),
  ],
);
