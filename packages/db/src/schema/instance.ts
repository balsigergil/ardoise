// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member', 'guest']);
export const themePreference = pgEnum('theme_preference', ['light', 'dark', 'system']);

/** ARCHITECTURE §4.1. Emails are stored trimmed and lowercased (ADR 0005). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    avatarFileId: uuid('avatar_file_id'),
    passwordHash: text('password_hash').notNull(),
    locale: text('locale'),
    theme: themePreference('theme').notNull().default('system'),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    disabledAt: timestamps('disabled_at'),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_super_admin_idx')
      .on(t.id)
      .where(sql`${t.isSuperAdmin}`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    lastSeenAt: timestamps('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamps('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    revokedAt: timestamps('revoked_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    expiresAt: timestamps('expires_at').notNull(),
    usedAt: timestamps('used_at'),
  },
  (t) => [
    uniqueIndex('password_resets_token_hash_key').on(t.tokenHash),
    index('password_resets_user_idx').on(t.userId),
  ],
);

export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamps('updated_at').notNull().defaultNow(),
});
