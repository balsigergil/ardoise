# Ardoise — Roadmap

Milestones are sequential. A milestone is done when every box is ticked, its
acceptance criteria pass and its summary is written in `docs/milestones/Mx-plan.md`.
Every milestone follows the Definition of Done in `CLAUDE.md` §6, so **unit tests are
always required**. Integration and e2e tests are listed when a milestone needs them.

---

## M0 — Foundations

- [x] pnpm + Turborepo monorepo with the layout from CLAUDE.md §3, strict TS, ESLint, Prettier
- [x] `apps/server`: NestJS skeleton with `ARDOISE_ROLE` (api/collab/worker/all), config
      validation (zod), pino logging, `/healthz`, `/readyz`
- [x] `packages/db`: Drizzle setup, first migration (extensions `ltree`, `pg_trgm`,
      `unaccent`), migration-on-boot with advisory lock
- [x] `apps/web`: Vite + React + TanStack Router + Tailwind + shadcn/ui, app shell
      (sidebar + main), light/dark/system theme, i18next with `fr`/`en`
- [x] `packages/i18n` with a key-completeness unit test
- [x] `docker/Dockerfile` (single multi-stage image) and `docker-compose.yml` (ardoise,
      postgres, valkey, rustfs) with health checks
- [x] Test infrastructure: Vitest workspace, Testcontainers helpers, Playwright project
- [x] GitHub Actions CI: lint, typecheck, unit, integration, license allowlist check,
      SPDX header check, image build
- [x] `README.md` (quick start), `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`, ADR template

**Acceptance**: `docker compose up` serves the app shell in both languages and both
themes. CI is green. `pnpm dev` works on Windows and Linux.

---

## M1 — Instance, authentication, workspaces

- [x] First-run setup: logged one-time setup URL; env bootstrap alternative
- [x] Email + password auth with argon2id; sessions with CSRF; logout; session list/revoke
- [x] Password reset by email; `mail` module (SMTP via nodemailer, i18n templates)
- [x] Invitations: instance-level (super-admin) and workspace-level (owner/admin) with
      expiry; accept flow creates the account. **No sign-up route.**
- [x] Workspaces: create, rename, icon, switch; members and roles (owner, admin, member, guest)
- [x] Teamspaces: create, visibility (open/closed/private), members, default access level
- [x] Admin panel: users, workspaces, SMTP (with test email), limits, invitation settings
- [x] User settings: profile, language, theme, password

**Tests**: unit (auth rules, invitation lifecycle, role checks). Integration (setup,
login, invite → accept, reset). E2E: *setup → invite → accept → login*.

---

## M2 — Sync engine, page tree, permissions

- [x] `packages/shared`: mutation catalog (zod args) + pure apply functions
- [x] `sync` module: `POST /sync/mutations` (idempotent, per-mutation transaction),
      `change_log` with per-workspace gap-free `seq`, `GET /sync/pull`, `/sync/ws` pokes via Valkey
- [x] `packages/sync` client store: normalized entities, optimistic apply, pending
      queue, rebase, IndexedDB persistence (Dexie), rejection handling
- [x] Pages: create, rename, icon, cover, width, font, lock, duplicate (job for large
      subtrees), move/reorder (fractional index, `ltree` subtree rewrite, cycle prevention)
- [x] Sidebar: Favorites / Teamspaces / Shared / Private, lazy tree, drag & drop, virtualization
- [x] Trash: delete subtree, restore, purge, retention job
- [x] Favorites, recents, follows
- [x] Permissions: grants, restrict inheritance, pure evaluator, Valkey cache with
      `perm_epoch`, share menu showing the source of each access
- [x] Public links (share to web, read-only, `noindex`, revocable)
- [x] Move the M1 workspace-scoped REST writes (`workspace.update`, `teamspace.*`,
      `member.*`) to mutations (ADR 0005)
- [x] `db:seed:large` (1M pages, deep trees) + benchmark of tree loading and mutation throughput

**Tests**: unit (permission evaluator, exhaustive matrix; every apply function;
rebase scenarios; fractional indexing). Integration (mutations + pull + pokes across
2 api nodes; permission filtering of pull; move of large subtree). E2E: *create
nested pages, move them, share with another user who sees them live*.

**Acceptance**: budgets for sidebar load and mutation round-trip met on the large seed.
The seq serialization benchmark is recorded.

---

## M3 — Editor and real-time collaboration

- [ ] `packages/editor`: Tiptap (MIT packages only) schema with block-container nesting
      and `blockId`
- [ ] Blocks: text, H1–H3 (+ toggle headings), bulleted, numbered, to-do, toggle, quote,
      callout, code (highlighting), divider, image, file, simple table, columns, block
      equation, link to page, child page, table of contents, bookmark
- [ ] Inline: marks, colors, links, inline equation, mentions (user, page, date)
- [ ] Slash menu, drag handles, block menu (turn into, color, duplicate, move to, copy
      link, delete), multi-block selection, Markdown shortcuts, paste conversion
- [ ] `collab` role: Hocuspocus with auth hooks, read-only enforcement, persistence to
      `page_documents`, Valkey extension, connection kill on permission revoke
- [ ] Presence: avatars, colored cursors and selections
- [ ] `files` module: streamed uploads to S3 with limits, presigned downloads, thumbnails job
- [ ] `projection` jobs: plain text, links, mentions → `page_search`, `page_links`;
      backlinks panel
- [ ] Search: quick find (titles, trigram) and full search page (FTS, filters, snippets)
- [ ] Page lock enforced in the editor and on the server
- [ ] Extension seams (ADR 0008, PLUGINS.md §11): reserved `pluginBlock` /
      `pluginContainer` / `pluginText` / `pluginInline` nodes and `pluginMark` with
      fallbacks (overlap test with `y-prosemirror`); global `ext` attribute; `plugin:`
      document prefix reserved; block definition and editor behavior registries driving
      the menus and shortcuts; projection extractor registry with fallback

**Tests**: unit (schema rules, node commands, projection extraction, search query
builder). Integration (Hocuspocus auth/read-only/persistence across 2 collab nodes;
uploads). E2E: *two browsers co-edit a page; cursors visible; no lost text*.

---

## M4 — Databases and views

- [ ] Full-page and inline databases; rows as pages; row open modes (side peek, modal, full page)
- [ ] v1 property types (PRODUCT §7.1) with schema editing and type conversion
- [ ] `database_row_values` typed index maintained transactionally
- [ ] View compiler: filters (AND/OR groups, 2 levels), multi-sorts, grouping, relative
      dates, keyset pagination; aggregates and column calculations
- [ ] Layouts: table (resize, freeze, calculations), board (drag between and within
      groups), list, calendar (month and week, drag to reschedule), gallery
- [ ] View management: create, rename, duplicate, reorder, delete; per-view config
- [ ] Row templates (default template)
- [ ] Virtualized rendering everywhere; 100k-row seed + benchmark
- [ ] Extension seams (PLUGINS.md §11): property type registry with value kinds (view
      compiler keyed by value kind); `layout` and property `type` as strings; layout
      registry; fallbacks for unknown types and layouts

**Tests**: unit (view compiler, exhaustive by type and operator, SQL snapshots;
property conversion; calculations). Integration (query correctness on seeded data;
permission "can edit content"). E2E: *create a database, add properties, rows, a board
view and a filter*.

**Acceptance**: database view budget (300 ms p95, 100k rows) met.

---

## M5 — Offline (PWA)

- [ ] `vite-plugin-pwa`: installable app, precached shell, runtime image caching with cap
- [ ] "Available offline" per page and per device; settings list with sizes and removal
- [ ] Cache policy: marked pages + recents + favorites + first N rows per cached database view
- [ ] `y-indexeddb` persistence for cached documents only
- [ ] Offline whitelist enforced in UI and store (PRODUCT §15); disabled actions explained
- [ ] Connectivity state machine, status indicator, pending-changes counter
- [ ] Reconnect: batch replay, rebase, rejection summary dialog; content-rejection flow
      (ARCHITECTURE §8.5)
- [ ] Offline search with MiniSearch over cached pages
- [ ] Full resync when the cursor is older than the change-log horizon
- [ ] Extension seams (PLUGINS.md §11): offline whitelist as a flag on mutation
      definitions; service worker able to cache runtime-listed assets

**Tests**: unit (cache policy selection, whitelist, replay/rejection logic). Integration
(replay of offline batches including revoked access). E2E (Playwright offline
emulation): *go offline, edit a page and a row property, create a page, reconnect,
changes synced*; *access revoked while offline → changes rejected and reported*.

---

## M6 — Comments, notifications, history, synced blocks, templates

- [ ] Comments: page threads, inline (mark anchor in Yjs) and block threads, replies,
      mentions, edit/delete, resolve/reopen
- [ ] Notifications: event types (PRODUCT §11), in-app inbox (live via `/sync/ws`),
      email batching, preferences per type × channel, follow/unfollow
- [ ] Version history: inactivity snapshots to S3, panel, preview, diff by `blockId`,
      undoable restore, retention
- [ ] Synced blocks: create, copy and sync, nested editor, source indicator, unsync,
      access placeholder
- [ ] Templates: mark page as template, template picker, built-in original templates
- [ ] Extension seams (PLUGINS.md §11): notification type registry (`type` as `text`);
      template `source`

**Tests**: unit (anchor resolution, notification routing and preferences, batching,
diff, restore transformation). Integration (notification emails via a fake SMTP server;
snapshot/restore through collab). E2E: *comment with mention → inbox notification*;
*restore a previous version*.

---

## M7 — Public API, MCP server, Markdown export

- [ ] `packages/markdown`: editor JSON ⇄ Markdown with extensions and round-trip tests
- [ ] API tokens (personal and integration), scopes, page access for integrations via share menu
- [ ] `/api/v1`: pages, content (JSON and Markdown), databases (schema, query, rows),
      comments, search, users, files; OpenAPI + docs page; rate limiting
- [ ] MCP server at `/mcp` (Streamable HTTP) with tools listed in PRODUCT §17
- [ ] Export: page or subtree → Markdown ZIP; database → CSV; workspace → Markdown + CSV (job)
- [ ] Extension seams (PLUGINS.md §11): Markdown serializer registry with the lossless
      plugin-node fallback; MCP tool registry; string scopes; plugin nodes in the API block JSON

**Tests**: unit (Markdown round-trips, token scope checks). Integration (every API
endpoint incl. permission denials; MCP tool calls).

---

## M8 — AI and Notion import

- [ ] `AiProvider` adapters: OpenAI, Anthropic, OpenRouter, OpenAI-compatible (Ollama);
      admin configuration; workspace enable/disable and model choice
- [ ] Editor AI commands (PRODUCT §18), streaming via SSE, insert/replace/discard
- [ ] Ask AI about this page; Ask the workspace (FTS retrieval, permission-filtered, citations)
- [ ] Notion "Markdown & CSV" ZIP import: hierarchy, pages, databases with type
      inference and confirmation step, assets, link rewriting, resumable job, report
- [ ] Markdown file/ZIP import
- [ ] Extension seams (PLUGINS.md §11): AI provider, AI command and importer registries

**Tests**: unit (prompt building, retrieval filtering, import parsers on fixture
exports, type inference). Integration (import job end-to-end on a fixture ZIP; AI with
mocked provider). E2E: *import a fixture Notion export and browse it*.

**v1 release**: tag `v1.0.0` after M8, with release notes and upgrade documentation.

---

## M9 — Plugins (after v1)

Design: `docs/PLUGINS.md`, ADR 0008. Starts once the M3–M8 extension seams are in place.

- [ ] `packages/plugin-sdk`: manifest schema, `definePlugin`, server and client types (API `0.x`)
- [ ] `plugins` module: loader from `ARDOISE_PLUGINS_DIR`, engine and license checks,
      statuses, instance and workspace enablement, encrypted settings
- [ ] `plugin_records` + `pluginRecord.set/delete` mutations, `pluginRecord` entity in pull
      and the client store, per-collection governance and offline flag
- [ ] Actions, HTTP routes, jobs and schedules, MCP tools, change consumers (integration
      principal, per-plugin cursor), failure isolation
- [ ] Client loader: import map for shared libraries, lazy contributions, PWA client manifest, CSP origins
- [ ] Plugin subdocuments (`plugin:<blockId>`): authorization by containing page, size
      cap, included in history, export and duplication
- [ ] Outgoing webhooks (Tier 0), signed and permission-filtered
- [ ] Admin and workspace UI: list, capabilities, enable/disable, status, settings, purge
- [ ] First-party example plugins in `plugins/`: diagram block, rating property type,
      change notifier
- [ ] Plugin developer guide

**Tests**: unit (manifest validation, governance and delivery of records, fallbacks,
consumer cursors). Integration (loading, enable/disable, records through mutations and
pull, consumers, webhooks). E2E: *enable the example plugins, use the block and the
property, disable the plugin → placeholders, re-enable → restored*.

**Acceptance**: disabling and re-enabling a plugin loses no data; budgets unchanged
with the example plugins enabled.

---

## After v1 (ordered backlog, to be detailed later)

1. Relations, rollups, formulas (database milestone 2)
2. SSO (OIDC, SAML) and MFA (TOTP, WebAuthn)
3. Web push notifications
4. Offline structural edits (move, reorder, schema and view changes)
5. Timeline and chart views; linked database views
6. Embeds, forms, site publishing (custom domains, SEO via a dedicated renderer)
7. Optional Meilisearch adapter
8. Hosted offering (same codebase, no feature differences)
