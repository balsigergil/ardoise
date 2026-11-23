// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  customType,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './instance.js';
import { pages } from './pages.js';

const timestamps = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
});

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const pageFk = (t: { workspaceId: AnyPgColumn; pageId: AnyPgColumn }) =>
  foreignKey({
    columns: [t.workspaceId, t.pageId],
    foreignColumns: [pages.workspaceId, pages.id],
  }).onDelete('cascade');

/**
 * Yjs documents (ARCHITECTURE §4.4, ADR 0009 §4). `doc_name` is `page:<id>` (later
 * `synced:<id>`, `plugin:<blockId>`); `page_id` is the page that governs access.
 */
export const pageDocuments = pgTable(
  'page_documents',
  {
    workspaceId: uuid('workspace_id').notNull(),
    docName: text('doc_name').notNull(),
    pageId: uuid('page_id').notNull(),
    state: bytea('state').notNull(),
    stateVector: bytea('state_vector').notNull(),
    size: integer('size').notNull(),
    updatedAt: timestamps('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.docName] }),
    index('page_documents_page_idx').on(t.workspaceId, t.pageId),
    pageFk(t),
  ],
);

export const fileStatus = pgEnum('file_status', ['pending', 'ready']);

/**
 * Uploaded files (ARCHITECTURE §4.7). No foreign key to `pages`: purging a page marks
 * its files deleted, and a job removes the S3 objects before the rows.
 */
export const files = pgTable(
  'files',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: uuid('id').notNull(),
    pageId: uuid('page_id').notNull(),
    s3Key: text('s3_key').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    status: fileStatus('status').notNull().default('pending'),
    thumbnailKey: text('thumbnail_key'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps('created_at').notNull().defaultNow(),
    deletedAt: timestamps('deleted_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    index('files_page_idx').on(t.workspaceId, t.pageId),
    index('files_deleted_idx')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

/**
 * Search projection (ARCHITECTURE §4.4): title (weight A) and body text (weight B),
 * `simple` configuration over `unaccent`. `tsv` is computed by the writer because
 * `unaccent` cannot be used in a generated column.
 */
export const pageSearch = pgTable(
  'page_search',
  {
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),
    title: text('title').notNull().default(''),
    plainText: text('plain_text').notNull().default(''),
    tsv: tsvector('tsv').notNull(),
    updatedAt: timestamps('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.pageId] }),
    // btree_gin lets the GIN index start with workspace_id (CLAUDE.md §4).
    index('page_search_tsv_idx').using('gin', t.workspaceId, t.tsv),
    pageFk(t),
  ],
);

export const linkKind = pgEnum('page_link_kind', ['link', 'mention', 'synced_ref']);

/** Links between pages, from the projection; powers backlinks. */
export const pageLinks = pgTable(
  'page_links',
  {
    workspaceId: uuid('workspace_id').notNull(),
    sourcePageId: uuid('source_page_id').notNull(),
    targetPageId: uuid('target_page_id').notNull(),
    kind: linkKind('kind').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.sourcePageId, t.targetPageId, t.kind] }),
    index('page_links_target_idx').on(t.workspaceId, t.targetPageId, t.sourcePageId),
    foreignKey({
      columns: [t.workspaceId, t.sourcePageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
  ],
);

/** User mentions per block, diffed by the projection to notify new mentions (M6). */
export const pageMentionsUsers = pgTable(
  'page_mentions_users',
  {
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** '' when the mention is outside any block. */
    blockId: text('block_id').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.pageId, t.userId, t.blockId] }),
    index('page_mentions_users_user_idx').on(t.workspaceId, t.userId),
    pageFk(t),
  ],
);
