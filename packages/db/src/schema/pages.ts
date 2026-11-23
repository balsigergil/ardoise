// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
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
import { users } from './instance.js';
import { permissionLevel, workspaceMembers, workspaces } from './workspaces.js';

const timestamps = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `ltree`: page ids as 32-hex labels (ADR 0002). */
export const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });

/** Fractional keys compare byte-wise, so the column uses the "C" collation. */
export const positionText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

export const pageKind = pgEnum('page_kind', ['page', 'database', 'row']);
export const parentKind = pgEnum('parent_kind', ['teamspace', 'private', 'page', 'database']);
export const pageWidth = pgEnum('page_width', ['normal', 'full']);
export const pageFont = pgEnum('page_font', ['default', 'serif', 'mono']);
export const moveState = pgEnum('move_state', ['moving']);
export const principalKind = pgEnum('principal_kind', [
  'user',
  'teamspace',
  'workspace',
  'integration',
  'public_link',
]);
export const changeOp = pgEnum('change_op', ['upsert', 'delete']);

/** ARCHITECTURE §4.3. */
export const pages = pgTable(
  'pages',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    kind: pageKind('kind').notNull().default('page'),
    parentKind: parentKind('parent_kind').notNull(),
    parentId: uuid('parent_id').notNull(),
    path: ltree('path').notNull(),
    isInline: boolean('is_inline').notNull().default(false),
    moveState: moveState('move_state'),
    position: positionText('position').notNull(),
    title: text('title').notNull().default(''),
    icon: jsonb('icon'),
    cover: jsonb('cover'),
    properties: jsonb('properties'),
    restrictInheritance: boolean('restrict_inheritance').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    isTemplate: boolean('is_template').notNull().default(false),
    width: pageWidth('width').notNull().default('normal'),
    font: pageFont('font').notNull().default('default'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamps('updated_at').notNull().defaultNow(),
    deletedAt: timestamps('deleted_at'),
    deletedRootId: uuid('deleted_root_id'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    index('pages_children_idx').on(t.workspaceId, t.parentId, t.position, t.id),
    // Page ids are globally unique, so the `path` index needs no workspace prefix.
    index('pages_path_gist').using('gist', t.path),
    // Quick find (ADR 0009 §8): accent-insensitive substring (trigram, btree_gin) and
    // prefix (short queries) matches on titles. `ardoise_unaccent` is migration 0004.
    index('pages_title_trgm').using(
      'gin',
      t.workspaceId,
      sql`ardoise_unaccent(${t.title}) gin_trgm_ops`,
    ),
    index('pages_title_prefix_idx').on(
      t.workspaceId,
      sql`lower(ardoise_unaccent(${t.title})) text_pattern_ops`,
    ),
    index('pages_moving_idx')
      .on(t.workspaceId)
      .where(sql`${t.moveState} IS NOT NULL`),
    index('pages_trash_idx')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedRootId} = ${t.id}`),
  ],
);

/** §9 grants. `no_access` is never stored (ADR 0006). */
export const pagePermissions = pgTable(
  'page_permissions',
  {
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),
    principalKind: principalKind('principal_kind').notNull(),
    principalId: uuid('principal_id').notNull(),
    level: permissionLevel('level').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.pageId, t.principalKind, t.principalId] }),
    index('page_permissions_principal_idx').on(t.workspaceId, t.principalKind, t.principalId),
    foreignKey({
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
  ],
);

/** Per-user rows go away with the membership. */
const memberFk = (t: { workspaceId: AnyPgColumn; userId: AnyPgColumn }) =>
  foreignKey({
    columns: [t.workspaceId, t.userId],
    foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
  }).onDelete('cascade');

/** Page-attached rows go away when the page is purged. */
const pageFk = (t: { workspaceId: AnyPgColumn; pageId: AnyPgColumn }) =>
  foreignKey({
    columns: [t.workspaceId, t.pageId],
    foreignColumns: [pages.workspaceId, pages.id],
  }).onDelete('cascade');

export const favorites = pgTable(
  'favorites',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    pageId: uuid('page_id').notNull(),
    position: positionText('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.pageId] }),
    index('favorites_order_idx').on(t.workspaceId, t.userId, t.position, t.pageId),
    memberFk(t),
    pageFk(t),
  ],
);

/** Direct upserts, outside the change log (ADR 0003). */
export const recents = pgTable(
  'recents',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    pageId: uuid('page_id').notNull(),
    visitedAt: timestamps('visited_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.pageId] }),
    index('recents_order_idx').on(t.workspaceId, t.userId, t.visitedAt),
    memberFk(t),
    pageFk(t),
  ],
);

export const pageFollows = pgTable(
  'page_follows',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    pageId: uuid('page_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.pageId] }),
    index('page_follows_page_idx').on(t.workspaceId, t.pageId),
    memberFk(t),
    pageFk(t),
  ],
);

/** ADR 0004 and 0006: hashed for lookup, encrypted to show again. */
export const publicLinks = pgTable(
  'public_links',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: uuid('id').notNull(),
    pageId: uuid('page_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    includeSubpages: boolean('include_subpages').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    revokedAt: timestamps('revoked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    // Anonymous lookup by token cannot know the workspace.
    uniqueIndex('public_links_token_key').on(t.tokenHash),
    uniqueIndex('public_links_active_key')
      .on(t.workspaceId, t.pageId)
      .where(sql`${t.revokedAt} IS NULL`),
    pageFk(t),
  ],
);

/** ARCHITECTURE §4.8. No foreign keys: entries outlive purged entities. */
export const changeLog = pgTable(
  'change_log',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    pageId: uuid('page_id'),
    userId: uuid('user_id'),
    op: changeOp('op').notNull(),
    data: jsonb('data'),
    mutationId: uuid('mutation_id'),
    actorId: uuid('actor_id'),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.seq] }),
    index('change_log_created_idx').on(t.workspaceId, t.createdAt),
  ],
);

/** Idempotency records (ADR 0003 item 1). */
export const appliedMutations = pgTable(
  'applied_mutations',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    actorId: uuid('actor_id').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamps('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    index('applied_mutations_created_idx').on(t.workspaceId, t.createdAt),
  ],
);
