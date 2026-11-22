# Ardoise — Architecture

This is the technical reference. Any change to a decision written here requires an ADR
in `docs/decisions/`.

## 1. Principles

1. **Simple to self-host**: one application image plus Postgres, Valkey and an S3 store.
2. **Horizontally scalable**: every application process is stateless or coordinates
   through Valkey. Scale by running more containers.
3. **Two data planes**:
   - *page content* is a CRDT document (Yjs), synchronized by Hocuspocus;
   - *structured data* (tree, properties, schemas, views, comments, favorites…) is
     relational, changed only through **mutations**, and propagated to clients
     through a **change log**.
4. **Server is authoritative** for structured data and permissions. The client is an
   optimistic, partial cache.
5. **Workspace is the unit of distribution**: every workspace-scoped row carries
   `workspace_id`, so the database can later be partitioned or sharded (e.g. Citus)
   by workspace without a schema rewrite.
6. **Never unbounded**: lazy trees, paginated queries, virtualized lists.

## 2. Deployment topology

```
                    ┌──────────────────────────────────────────┐
 Browser (SPA/PWA)  │  ardoise image (one image, several roles)│
 ───────────────────►  role=api     REST, sync, MCP, static SPA │
   HTTPS + WSS      │  role=collab  Hocuspocus (Yjs over WS)   │
                    │  role=worker  BullMQ jobs                │
                    │  role=all     the three in one process   │
                    └───────┬──────────────┬────────────┬──────┘
                            │              │            │
                       PostgreSQL       Valkey     S3 (RustFS)
```

- **Single Docker image** with `ARDOISE_ROLE=all|api|collab|worker` (default `all`).
  Small instances run one container with `all`. Larger instances run N `api`, M `collab` and K `worker` containers.
- `docker/docker-compose.yml` ships: `ardoise` (role=all), `postgres`, `valkey`,
  `rustfs`, with volumes and health checks. A reverse proxy is the operator's
  choice; we document Caddy/Traefik examples.
- The `api` role serves the built SPA as static files, so there is a single public origin.
  Routes: `/` (SPA), `/api/*`, `/sync/*`, `/files/*`, `/collab` (WS), `/mcp`.
  With `role=all`, Hocuspocus is attached in-process at `/collab`. With split roles, the
  reverse proxy routes `/collab` to collab nodes; `api` never proxies WebSockets (ADR 0004).
- **Configuration** through environment variables: `ARDOISE_PUBLIC_URL`,
  `ARDOISE_SECRET_KEY`, `DATABASE_URL`, `VALKEY_URL`, `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, optional
  `S3_PUBLIC_URL` (browser-reachable S3 endpoint for presigned redirects), optional
  `SMTP_*` (overridable in admin), `ARDOISE_ADMIN_EMAIL/PASSWORD` (optional bootstrap).
- **Health**: `/healthz` (liveness), `/readyz` (DB, Valkey and S3 reachable). Logs are
  structured JSON via pino.
- **Migrations**: run automatically at startup by the first process that takes an
  advisory lock. They can also be run explicitly with `ardoise migrate`.

## 3. Backend modules (NestJS)

| Module | Responsibility |
|---|---|
| `auth` | password auth, sessions, CSRF, password reset, invitations acceptance, API tokens |
| `admin` | first-run setup, instance settings, users, limits, SMTP, AI providers |
| `workspaces` | workspaces, members, roles, teamspaces |
| `pages` | page tree, metadata, trash, favorites, recents, lock, public links |
| `permissions` | grants, inheritance, effective-permission evaluation and cache |
| `sync` | mutation endpoint, change log, pull endpoint, WS pokes |
| `collab` | Hocuspocus server: auth hooks, persistence, Valkey extension |
| `databases` | schemas, rows, views, query compiler, typed value index |
| `files` | uploads (streamed to S3), signed downloads, image thumbnails |
| `projection` | Yjs doc → text, links, mentions, outline (async jobs) |
| `search` | FTS queries behind a `SearchPort` interface |
| `comments` | threads, comments, anchors |
| `notifications` | events, inbox, preferences, email batching |
| `history` | snapshots, preview, diff, restore |
| `templates` | page/row templates, built-in set |
| `import-export` | Notion ZIP import, Markdown import, Markdown/CSV export (jobs) |
| `ai` | provider abstraction, prompts, streaming, retrieval |
| `api-public` | `/api/v1` controllers, OpenAPI, rate limiting |
| `mcp` | MCP server (official TypeScript SDK) over the same services |
| `mail` | SMTP transport (nodemailer), i18n email templates |

Rules:
- Domain logic lives in framework-free services and is unit tested.
- Persistence sits behind repositories (Drizzle).
- Controllers, WS gateways, MCP tools and jobs are thin adapters over the same services.

## 4. Data model (PostgreSQL)

Conventions:
- IDs are UUIDv7.
- Timestamps are `timestamptz`.
- Workspace-scoped tables use composite primary keys `(workspace_id, id)` and
  every index starts with `workspace_id`.
- Soft deletion uses `deleted_at` where the trash applies.
- Extensions: `ltree`, `pg_trgm`, `unaccent`.

### 4.1 Instance level
- `users` (id, email unique, name, avatar_file_id, password_hash, locale, theme,
  is_super_admin, disabled_at, created_at)
- `sessions` (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent,
  ip, revoked_at), with hot session lookup cached in Valkey (ADR 0005)
- `password_resets` (id, user_id, token_hash, created_at, expires_at, used_at)
- `invitations` (id, email, token_hash, inviter_id, workspace_id nullable, role nullable
  for instance invitations, created_at, expires_at, accepted_at, revoked_at)
- `instance_settings` (key, value jsonb), with secrets stored encrypted; the first-run
  setup token is stored there encrypted until setup completes (ADR 0005)
- Emails are stored trimmed and lowercased.
- `api_tokens` (id, user_id, workspace_id nullable, kind personal|integration, name,
  token_hash, scopes, last_used_at, revoked_at)
- `ai_providers` (id, kind openai|anthropic|openrouter|openai_compatible, base_url,
  api_key_encrypted, models jsonb, enabled)

### 4.2 Workspace level
- `workspaces` (id, name, icon, settings jsonb, created_at)
- `workspace_members` (workspace_id, user_id, role owner|admin|member|guest, created_at),
  plus an index on `(user_id, workspace_id)` to list a user's workspaces: the one index
  that does not start with `workspace_id` (ADR 0005)
- `teamspaces` (workspace_id, id, name, icon, description, visibility
  open|closed|private, default_level, created_at)
- `teamspace_members` (workspace_id, teamspace_id, user_id, role owner|member, created_at)
- `workspace_counters` (workspace_id, change_seq bigint, perm_epoch bigint,
  unique_id counters jsonb)

### 4.3 Pages and tree
- `pages`:
  - workspace_id, id, kind `page|database|row`;
  - parent_kind `teamspace|private|page|database`, parent_id. Top-level pages hang off a
    teamspace or a user's private section (`parent_id` = the user id); there are no
    workspace-root pages (ADR 0006);
  - `path ltree`: materialized ancestry of page ids, for subtree queries and
    permission resolution. Labels are ids as 32 hex characters, without hyphens
    (ADR 0002). `path` is server-only: clients derive ancestry from `parent_id`;
  - `is_inline` (databases embedded as a block, hidden from the sidebar; ADR 0003);
  - `move_state` nullable (`moving` while a large subtree move job runs; ADR 0003);
  - position (fractional index; siblings sort by `(position, id)` so concurrent inserts
    at the same spot stay deterministic), title, icon jsonb, cover jsonb, properties jsonb
    (rows only);
  - restrict_inheritance bool, is_locked, is_template;
  - width, font;
  - created_by, created_at, updated_by, updated_at;
  - deleted_at, deleted_root_id (the page the user actually deleted).
  - Indexes:
    - `(workspace_id, parent_id, position)` for lazy tree loading and database rows
      in manual order;
    - GiST on `path`;
    - `pg_trgm` on title.
- Moving a page rewrites `path` for its subtree. This is a single SQL `UPDATE ...
  WHERE path <@ old_path` in the mutation transaction. Subtrees above a threshold are
  rewritten in chunks by a job, outside the counter lock, and the page is shown as
  "moving" (`move_state`) until it completes. Only the moved root gets a change-log entry.
- Child pages: the tree is authoritative for their existence; a child-page block in the
  content is a view of it. Deleting the block trashes the page (ADR 0003).
- `page_permissions` (workspace_id, page_id, principal_kind, principal_id, level,
  created_by, created_at), see §9.
- `favorites` (workspace_id, user_id, page_id, position)
- `recents` (workspace_id, user_id, page_id, visited_at), capped at 50 per user. Written
  by direct upsert, outside the change log and the workspace sequence (ADR 0003).
- `page_follows` (workspace_id, user_id, page_id)
- `public_links` (workspace_id, id, page_id, token_hash, token_encrypted,
  include_subpages, created_by, created_at, revoked_at), at most one non-revoked link per
  page (ADR 0006). `token_hash` is an HMAC for lookup; `token_encrypted` lets the share
  menu show the link again (ADR 0004).

### 4.4 Content (Yjs)
- `page_documents` (workspace_id, page_id, doc_name, state bytea, state_vector bytea,
  updated_at, size).
  - `doc_name` is `page:<id>` or `synced:<id>`.
  - It holds the full encoded Yjs state, written by Hocuspocus `onStoreDocument`
    (debounced 2 s, max 10 s).
- `synced_blocks` (workspace_id, id, source_page_id, created_by). A synced block is
  its own Yjs document (`synced:<id>`).
- Projection tables, maintained asynchronously from documents:
  - `page_search` (workspace_id, page_id, tsv tsvector, plain_text, updated_at),
    with title weighted A and content B, `simple` config + `unaccent`;
  - `page_links` (workspace_id, source_page_id, target_page_id, kind
    link|mention|synced_ref), which powers backlinks;
  - `page_mentions_users` (workspace_id, page_id, user_id, block_id), used to diff
    new mentions and notify.

### 4.5 Databases
- `databases` (workspace_id, page_id, schema jsonb). `schema` holds property
  definitions `{id, name, type, config, position}`. Property ids are stable UUIDs.
- `database_views` (workspace_id, id, database_page_id, name, layout
  table|board|list|calendar|gallery, config jsonb, position). `config` holds filters,
  sorts, group_by, visible/ordered properties, sizes and open-mode.
- Rows are `pages` with `kind=row` and `parent_id=<database page>`. Their canonical
  values live in `pages.properties` (jsonb keyed by property id).
- **Typed value index** `database_row_values` (workspace_id, database_page_id,
  property_id, row_id, v_text, v_number, v_date, v_date_end, v_bool, v_user_id).
  - It is maintained in the same transaction as every row write.
  - Multi-valued properties (multi-select, person, files) store one row per value.
  - Indexes `(workspace_id, database_page_id, property_id, v_*)` per value column.
  - This is what makes filter and sort fast on 100k+ rows without per-property
    dynamic indexes.
- Computed properties (created/edited time/by, unique ID) come from page columns and
  counters, not stored twice.

### 4.6 Collaboration features
- `comment_threads` (workspace_id, id, page_id, anchor_kind page|inline|block,
  block_id nullable, resolved_at, resolved_by). Inline anchors use a Tiptap mark
  carrying `threadId` inside the Yjs document, so the anchor follows edits.
- `comments` (workspace_id, id, thread_id, author_id, body jsonb (editor JSON),
  created_at, edited_at, deleted_at)
- `notifications` (workspace_id, id, user_id, type, payload jsonb, read_at,
  archived_at, created_at)
- `notification_preferences` (user_id, type, channel inapp|email, enabled)
- `page_versions` (workspace_id, id, page_id, s3_key, created_at, author_ids,
  reason auto|pre_restore|manual, size). The snapshot is a Yjs state blob in S3.

### 4.7 Files
- `files` (workspace_id, id, page_id nullable, s3_key, name, mime, size,
  uploaded_by, created_at, deleted_at).
  - S3 keys are prefixed `ws/<workspace_id>/files/<file_id>`.
  - Uploads stream through the API (multipart to S3) to enforce the size limit and
    MIME checks.
  - Downloads go through `GET /files/:id`, which checks permission and streams the
    object from S3 (range requests supported). If `S3_PUBLIC_URL` is set, it redirects
    to a short-lived presigned URL instead (ADR 0004).
  - Images get thumbnails generated by a worker job.

### 4.8 Change log
- `change_log` (workspace_id, seq bigint, entity_type, entity_id, page_id nullable,
  user_id nullable, op upsert|delete, data jsonb, mutation_id, actor_id, created_at).
  - Primary key `(workspace_id, seq)`.
  - `page_id` is the page that governs access to the entity, used to filter what a
    client may receive.
  - `user_id`, when set, restricts delivery to that user (user-private entities such
    as favorites).
  - `entity_type=access` entries signal grant/revoke/membership changes to the affected
    principals, so clients refetch or evict that scope (ADR 0003).
- `applied_mutations` (workspace_id, id, actor_id, result jsonb, created_at), PK
  `(workspace_id, id)`: idempotency record for every processed mutation, applied or
  rejected, purged with the change-log horizon.
  - `data` holds the **post-change state of the entity** (small entities) so clients
    simply upsert.
- `seq` is allocated by `UPDATE workspace_counters SET change_seq = change_seq + 1
  ... RETURNING` inside the mutation transaction, as its last step, so the serialized
  section is short. Structural page mutations (create, move, trash, restore, purge,
  duplicate) lock the counter row first, so tree invariants are checked on a stable tree
  (ADR 0006).
  - This guarantees gap-free, commit-ordered sequences per workspace, at the cost of
    serializing structured writes within one workspace.
  - That is acceptable because content edits go through Yjs. Benchmark it in M2 and
    record the result.
- Retention: entries older than a horizon (default 30 days) are purged. A client whose
  cursor is older than the horizon performs a **full resync** of its cached scope.

## 5. Real-time content (Yjs + Hocuspocus)

- One Yjs document per page (`page:<id>`) and per synced block (`synced:<id>`).
- The client uses `HocuspocusProviderWebsocket` (one multiplexed socket) and one
  provider per open document.
- **Auth**: `onAuthenticate` validates the session cookie or token and checks at least
  view permission (and edit permission for write access). Read-only connections are
  enforced server-side (`connection.readOnly`).
- **Persistence**: `onLoadDocument` reads `page_documents`. `onStoreDocument` writes it
  and enqueues a `projection` job (debounced).
- **Multi-node**: `@hocuspocus/extension-redis` pointed at Valkey, so any collab node can serve any document.
- **Permission changes**: when access to a page is revoked, the server closes the
  affected connections (pub/sub event). On reconnect, auth fails and the client drops
  its local copy of that document (see §8.5).
- **Awareness** carries user id, name, color and cursor for presence.
- **Editor schema** (in `packages/editor`):
  - Tiptap/ProseMirror nodes for every v1 block.
  - Nesting uses a block-container pattern: each top-level block node can hold a
    `children` content group, so indentation works for any block.
  - Every block node has a stable `blockId` attribute (for links to blocks,
    comments, synced blocks and the API).
  - Synced block references are an atom node `syncedBlock {syncedId}`. Its node view
    mounts a nested editor bound to `synced:<id>`.
  - Inline and full-page databases are atom nodes `database {pageId}` that render the
    database UI.

## 6. Structured data: mutations

All structured writes are **named mutations** defined once in `packages/shared`:

```ts
type Mutation<N extends MutationName = MutationName> = {
  id: string;          // UUIDv7 generated by the client; idempotency key
  workspaceId: string;
  name: N;             // e.g. 'page.create'
  args: MutationArgs[N]; // validated by the zod schema for N
  clientTime: string;
};
```

- **Endpoint**: `POST /sync/mutations` takes an ordered batch and returns
  `[{ id, status: 'applied' | 'rejected', code?, seq? }]`.
- Each mutation runs in its own transaction:
  1. validate args;
  2. check effective permission;
  3. check invariants (for example, no cycle on move, page not locked);
  4. apply;
  5. update the typed value index;
  6. append change-log entries;
  7. record `mutation_id` for idempotency (a duplicate returns the original result).
- **Initial catalog**:
  - pages: `page.create`, `page.update` (title, icon, cover, width, font, lock),
    `page.move`, `page.trash`, `page.restore`, `page.purge`, `page.duplicate`
    (runs as a job when large);
  - favorites and recents: `favorite.add/remove/move`, `recent.touch`;
  - databases: `database.updateSchema`, `row.setProperty`, `row.move`,
    `view.create/update/delete/move`;
  - follows: `follow.add/remove` (user-private entries);
  - permissions: `permission.grant/revoke/setRestrict`, `permission.recover` (explicit,
    logged owner recovery), `publicLink.set` (ADR 0006);
  - comments: `comment.create/update/delete`, `thread.resolve/reopen`;
  - templates and teamspaces: `template.setFlag`, `teamspace.*`, `member.*`.
- **Offline whitelist** (§8): `page.create`, `page.update` (title and icon only),
  `row.setProperty`, `recent.touch`. Everything else is rejected client-side while offline.
  The client pushes pending mutations before connecting a Hocuspocus provider for a page
  created offline.
- `recent.touch` is a direct upsert: it gets no `seq` and no change-log entry (ADR 0003).
- **Conflict rule**: property-level last-writer-wins in server arrival order (client
  clocks are never trusted).
  `row.setProperty` targets one property, so concurrent edits to different properties
  of a row never conflict.

## 7. Structured data: change log, pull and pokes

- **Pull**: `GET /sync/pull?workspace=…&since=<seq>&limit=…` returns
  `{ entries, cursor, hasMore }` (at most 1000 entries): change-log entries after `since`
  that the user is allowed to see, and the new cursor, which also advances past filtered
  entries. A `since` older than the retained log fails with `resync_required`.
  - Delivery rules (ADR 0006): `user_id` entries go to that user only; page-governed
    entries to users who can view the page (page `delete` entries are not filtered);
    `workspace` and `member` entries to every member; `teamspace` entries to members who
    can see the teamspace; `access` entries (ids only) to every member.
  - Permission filtering is batched by `page_id` using the effective-permission cache (§9).
  - The client keeps entries only for entities in its cached scope (plus tree children
    of loaded nodes).
- **Pokes**: after commit, the server publishes `{workspaceId, seq}` on Valkey. Every
  `api` node forwards it to the clients subscribed to that workspace over `GET /sync/ws`
  (WebSocket). Clients then pull. Pokes are coalesced per client (at most 1 per 100 ms).
- **Scoped reads** (not via the log): the tree (`GET /pages/:id/children`, paginated),
  page metadata, database view queries (§10), search, comments of a page and history.
  These responses carry the `seq` at which they were read, so the client can reconcile
  with the log: it keeps a per-entity seq and ignores data older than what it holds.
- `/sync/ws` authenticates the upgrade with the session cookie and an `Origin` check,
  and only sends pokes. Sockets close when the session ends or the membership goes.

## 8. Client architecture (SPA / PWA)

### 8.1 Layers
```
React UI (shadcn) ── hooks ──► Client store (packages/sync)
                                 ├─ in-memory normalized entities
                                 ├─ pending mutation queue
                                 ├─ IndexedDB persistence (Dexie)
                                 └─ transport: /sync/mutations, /sync/pull, /sync/ws
Editor (packages/editor) ── Yjs docs ── HocuspocusProvider + y-indexeddb
```

### 8.2 Optimistic updates and rebase
- A user action creates a mutation. The client applies it locally through the
  **same pure apply function** used on the server (shared in `packages/shared`),
  queues it, and sends batches.
- On pull, the client applies server entries to the *confirmed* state, then re-applies
  pending mutations on top (rebase).
- Rejected mutations are removed and the UI is recomputed. The user sees a toast for
  rejections, and a summary dialog after an offline session.

### 8.3 Cache policy
- The store persists to IndexedDB only the **cached scope**: pages marked available
  offline on this device, recents (last 50), favorites, their metadata and ancestors,
  and the first N rows of each cached database's default view.
- Everything else is fetched on demand and kept in memory with LRU eviction.
- Yjs documents of cached pages persist through `y-indexeddb`. Others stay in memory only.

### 8.4 PWA
- `vite-plugin-pwa` precaches the app shell. Runtime caching covers thumbnails and
  images of cached pages, with a size cap.
- Connectivity state machine: online, offline, reconnecting and syncing. In offline
  mode the UI disables non-whitelisted actions with an explanation.
- **Offline search**: a MiniSearch index over cached pages, rebuilt incrementally.

### 8.5 Offline rejection
- **Structured mutations** rejected at sync are discarded (§8.2).
- **Content edits**: if Hocuspocus refuses the document on reconnect because write
  access was lost, the client:
  1. clears that document's IndexedDB store and its in-memory doc;
  2. reloads with read-only access if view access remains;
  3. lists the page in the rejection summary.

### 8.6 Routing and data loading
- TanStack Router, code-split per route (editor, database views, admin, settings).
- Long lists and trees use TanStack Virtual.

## 9. Permissions

- **Grants**: `page_permissions` (workspace_id, page_id, principal_kind
  user|teamspace|workspace|integration|public_link, principal_id, level). The roots
  define base access (ADR 0006): teamspace members get the teamspace `default_level`
  and teamspace owners Full access; the private section gives Full access to its owner
  only. Workspace owners and admins get no implicit page access. `no_access` is not a
  grantable level.
- **Effective permission** for (user, page): walk ancestors from `pages.path`, nearest
  first.
  1. Union the grants matching the user (directly or through teamspace or workspace
     membership).
  2. Stop at the first page with `restrict_inheritance=true`, after including its grants.
  3. Apply the root rules, only if no restricted page was hit.
  4. Take the maximum level.
  5. Owners have a recovery path (PRODUCT §13): an explicit, logged "Recover access"
     action that creates a grant, never implicit access (ADR 0003).
  6. Guests get only explicit grants.
- It is implemented as a **pure function** over (ancestor chain, grants, memberships),
  exhaustively unit tested. The repository loads the chain in one query via `path`.
- **Cache** in Valkey keyed `perm:<ws>:<epoch>:<user>:<page>`. Any grant change, move,
  membership or role change bumps `workspace_counters.perm_epoch`, which invalidates
  the whole workspace in O(1).
- Every read path (REST, pull, collab, search, AI retrieval, API, MCP, public links)
  goes through `PermissionService`. Search and list queries filter in SQL through a
  pre-computed set of accessible root/restricted pages, then confirm per result.

## 10. Database queries

- `POST /databases/:pageId/query` takes a view id or ad-hoc config, a cursor and a limit
  (default 50, max 200).
- A **view compiler** (pure, unit tested) turns filters, sorts and grouping into SQL
  over `database_row_values` joined to `pages`:
  - AND/OR groups;
  - type-aware operators;
  - relative dates evaluated in the user's timezone;
  - stable keyset pagination (sort keys + row id).
- Group counts and column calculations are separate aggregate queries over the same
  filter. Results are cached briefly in Valkey and invalidated by change-log seq.
- Board and calendar request rows per group or date window.
- **Benchmark target** (seeded 100k-row database): first page of a filtered and sorted
  view p95 < 300 ms on reference hardware (4 vCPU, 8 GB, SSD).

## 11. Other subsystems

- **Projection jobs** (BullMQ, debounced per document):
  1. decode the Yjs state to editor JSON;
  2. extract plain text, links, mentions and synced references;
  3. update `page_search`, `page_links` and `page_mentions_users`;
  4. emit mention notifications for new mentions.
- **Search**: `SearchPort` with the `PostgresSearchAdapter`. It uses `websearch_to_tsquery` on
  `simple` + `unaccent`, `ts_headline` snippets and trigram for title prefix/fuzzy.
  The port leaves room for Meilisearch **[later]**.
- **History**: a job takes a snapshot after 10 min of inactivity by storing
  `Y.encodeStateAsUpdate` in S3.
  - Preview decodes it in a throwaway doc.
  - Diff compares block trees by `blockId`.
  - Restore computes the transformation from the current state to the snapshot
    content and applies it as a normal Yjs update, so it propagates to connected
    clients and stays undoable.
- **Notifications**:
  - domain events go to `notifications` rows and an in-app push over `/sync/ws`;
  - an email job batches per user (5 min window) and respects preferences.
- **Trash purge** and **change-log purge**: daily jobs.
- **Markdown** (`packages/markdown`): editor JSON ⇄ mdast (remark, GFM).
  - Extensions: callouts as `> [!NOTE]`-style blocks, toggles as `<details>`, math as
    `$`/`$$`, columns as HTML comments markers, mentions as links.
  - Round-trip tests (Markdown → JSON → Markdown) are mandatory.
- **Notion import** (job):
  1. unzip into a temp dir;
  2. parse the folder/file hierarchy;
  3. map files to pages using the ids embedded in the exported file names;
  4. convert Markdown to blocks;
  5. turn CSVs into databases (infer property types, with user confirmation
     step);
  6. upload assets to S3;
  7. rewrite internal links;
  8. produce a report.
  It must be idempotent per import id and resumable after a crash.
- **AI**:
  - an `AiProvider` interface (`chat(stream)`) with adapters for OpenAI, Anthropic,
    OpenRouter and OpenAI-compatible endpoints (Ollama);
  - prompts are versioned in code;
  - "Ask the workspace" retrieves the top-k accessible pages via FTS, chunks them and
    answers with citations;
  - streaming goes to the client via SSE;
  - provider keys are encrypted (AES-256-GCM with `ARDOISE_SECRET_KEY`).
- **Public API**:
  - controllers in `api-public` reuse domain services;
  - OpenAPI is generated from zod schemas and served at `/api/v1/openapi.json`, with a
    docs page;
  - rate limiting is a Valkey token bucket per token.
- **MCP**: the official `@modelcontextprotocol/sdk` with Streamable HTTP at `/mcp`, auth by
  bearer token. Each tool calls the same services as the REST API.

## 12. Performance budgets

| Operation | Budget (p95, reference hardware, warm) |
|---|---|
| Sidebar level load (≤ 100 children) | 100 ms |
| Open a page (metadata + doc sync start) | 300 ms |
| Mutation round-trip (single) | 150 ms |
| Database view first page (100k rows, filter + sort) | 300 ms |
| Quick find (title) | 150 ms |
| Full-text search (1M pages workspace) | 500 ms |

- `packages/db` provides `db:seed:large`: 1M pages, deep trees, a 100k-row database
  and many grants.
- Benchmarks live in `apps/server/bench` and run on demand. Report results in the
  milestone summary.

## 13. Security checklist

- Hash passwords with argon2id.
- Rate-limit login, password reset, setup and invitation acceptance (Valkey counters).
- One-time tokens (setup, invitation, reset) travel in the URL fragment, so they never
  reach server or proxy logs.
- Sessions use httpOnly, Secure, SameSite=Lax cookies with a CSRF token on
  state-changing requests.
- Set a strict CSP and security headers, and sanitize pasted HTML and imported
  content.
- Use signed, expiring URLs for files and check permissions before issuing them.
- Hash tokens (API tokens, invitations, public links) at rest.
- Encrypt secrets at rest.
- Write audit-friendly structured logs, without content or secrets in them.

## 14. Testing strategy

- **Unit (priority)**: everything pure.
  - permissions evaluator;
  - mutation validators and apply functions;
  - client rebase;
  - view compiler (SQL snapshot tests plus behavior tests on fixtures);
  - Markdown round-trips;
  - projection;
  - Notion import parsers;
  - fractional indexing helpers;
  - i18n key completeness test (fr and en have identical key sets).
- **Integration**: Testcontainers (Postgres, Valkey, RustFS) with the NestJS app booted
  in-process.
  - auth and invitations;
  - mutations and pull;
  - Hocuspocus auth and persistence;
  - database queries on seeded data;
  - files;
  - API and MCP endpoints.
- **E2E (Playwright)**, critical journeys only (see ROADMAP), including two browser
  contexts for collaboration and context offline emulation for the PWA.
- **CI** (GitHub Actions):
  - lint, typecheck, unit and license check on every push;
  - integration on PRs;
  - e2e and Docker image build on `main`.
