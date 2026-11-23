# Ardoise — Plugins (design)

- Status: **accepted** (ADR 0008). Nothing here is implemented yet. Q1–Q3 (§13) remain
  open until M9.
- Precedence: this document details ARCHITECTURE §15. If they disagree, ARCHITECTURE wins
  (CLAUDE.md order: CLAUDE.md > ARCHITECTURE > PRODUCT > ROADMAP).
- Timing: the plugin runtime ships in **M9, after v1**. The **extension seams** it relies
  on are built during M3–M8 (§11), so M9 adds a public facade instead of reworking
  the editor, databases or sync.

## 1. Goals and non-goals

**Goals**: operators and the community can extend Ardoise without forking it:
- new editor blocks and inline elements, slash-menu entries and block actions;
- new database property types and view layouts;
- AI providers and AI commands, importers and exporters;
- server automations that react to changes, scheduled jobs, HTTP routes and MCP tools;
- outgoing webhooks for external systems.

**Non-goals for the first version**:
- a marketplace, or installing plugins from the UI by downloading code;
- running untrusted code in-process (that is Tier 2, §2);
- changing the permission evaluator, authentication, sessions, the sync protocol, the
  change-log delivery rules or the CSP;
- plugin-owned SQL tables or migrations (plugins store data in `plugin_records`, §5);
- plugin-defined ProseMirror node or mark types, or changes to the schema of core blocks
  (plugins use the reserved nodes, the reserved mark and the `ext` attribute, §6);
- schema-level content constraints for plugin nodes (plugins normalize, §6.7).

**Principles**:
1. **No open core.** The plugin system is not an edition mechanism. Every feature listed
   in PRODUCT or ROADMAP is core and is never moved into a plugin to gate it. The
   project ships no proprietary plugins and no license-key checks (CLAUDE.md §1.2).
2. **Built-ins dogfood the registries.** Core blocks, property types, layouts, AI
   providers and importers register themselves through the same internal registries
   that the plugin SDK exposes. The SDK is a thin, versioned facade over them, so the
   extension points are exercised by real code from M3 onwards.
3. **Persisted formats never depend on installed plugins.** Disabling or removing a
   plugin never deletes or corrupts data: Yjs documents, page properties and plugin
   records stay intact and render as placeholders until the plugin comes back.
4. **Same security model.** Every read and write made by a plugin goes through
   `PermissionService`. A plugin never receives the Drizzle handle, the Valkey client or
   raw S3 credentials.
5. **Same performance budgets.** Plugin client code loads lazily. Plugins never run
   inside the mutation transaction (§8.3), so they cannot slow down the per-workspace
   seq serialization or the 150 ms mutation round-trip.

## 2. Tiers

| Tier | What | Installed by | Runs | When |
|---|---|---|---|---|
| 0. Integrations | Public REST API, MCP, outgoing webhooks | workspace admin (token, share menu) | out of process | API and MCP in M7, webhooks in M9 |
| 1. Installed plugins | package with a manifest and server and/or client entries | super-admin (folder in the image or a mounted volume) | in-process, **trusted** | M9 |
| 2. Sandboxed plugins | client in an iframe with a message-based SDK, server in an isolate | workspace admin | sandboxed | later, own ADR |

Tier 1 code is as trusted as Ardoise itself: the capability API (§8) gives least privilege
**by convention and for correctness**, not as a security boundary. The admin docs must say
so plainly: install only plugins you would trust with the database.

## 3. Plugin package

```
my-plugin/
  ardoise-plugin.json   manifest
  server.js             optional ESM entry, default export: definePlugin({...})
  client/               optional, built ESM (entry + chunks, hashed file names)
  locales/fr.json       required if the plugin has any user-facing string
  locales/en.json
  LICENSE
```

**Manifest** (zod schema in `@ardoise/plugin-sdk`):
- `id`: `^[a-z][a-z0-9-]{1,40}(\.[a-z][a-z0-9-]{1,40})+$` (for example `org.example.diagrams`).
  It namespaces everything: node types, property types, records, jobs, routes, i18n keys.
- `version` (semver), `engine` (semver range of the plugin API, for example `^1.0.0`).
- `license` (SPDX expression, checked against the ADR 0001 allowlist, §9).
- `name` and `description` as i18n keys.
- `contributes`: **static** declarations the host can read without running plugin code
  (blocks with slash-menu entries, property types, layouts, record collections,
  notification types, settings schema, MCP tools). This lets the slash menu or the
  property picker list plugin items before the client bundle is loaded.
- `capabilities` requested (for example `records`, `content.read`, `content.write`,
  `changes.subscribe`, `http.routes`, `outbound:<host>`), shown to the admin on enable.

**Loading**:
- At boot, every role scans `ARDOISE_PLUGINS_DIR` (default `/opt/ardoise/plugins`). The
  image ships the first-party plugins; operators add theirs through a mounted volume.
- A plugin whose manifest is invalid, whose `engine` does not match, whose license is
  not allowed or whose activation throws is **not loaded**. Boot continues and the admin
  panel shows the reason.
- Super-admins enable plugins for the instance. Workspace owners and admins then enable
  them per workspace. A disabled plugin has no effect and receives nothing.
- The plugin API follows semver independently of the app version. Breaking changes
  happen only in a major version, with a deprecation period of at least one minor version.

## 4. Extension points

| Extension point | Side | Seam built in | Core uses it for |
|---|---|---|---|
| Blocks (`pluginBlock`, `pluginContainer`, `pluginText`) | client + server | M3 | — (reserved nodes, §6) |
| Inline atoms (`pluginInline`) | client + server | M3 | — |
| Inline formatting (`pluginMark`) | client + server | M3 | — |
| Data attached to core blocks (`ext` attribute) | client + server | M3 | — |
| Plugin subdocuments (`plugin:<blockId>` Yjs documents) | client + collab | M3 (name reserved), M9 | — |
| Editor behaviors (ProseMirror plugins: decorations, keymaps, input rules, paste handlers) | client | M3 | core shortcuts, Markdown input rules, paste conversion |
| Block definitions registry (slash item, block menu actions, node view) | client | M3 | every core block |
| Projection extractors (text, links, mentions of a node) | server | M3 | every core block |
| Property types | client + server | M4 | every core property type |
| View layouts | client | M4 | table, board, list, calendar, gallery |
| Notification types | server + client | M6 | every core event |
| Templates (bundled template pages) | server | M6 | built-in templates |
| Markdown serializers per node type | server | M7 | every core block |
| HTTP routes (`/api/plugins/<id>/…`, `/api/v1/plugins/<id>/…`) | server | M7 | — |
| MCP tools (`<id>.<tool>`) | server | M7 | core MCP tools |
| AI providers, AI commands | server + client | M8 | OpenAI, Anthropic, OpenRouter, OpenAI-compatible |
| Importers, exporters | server | M8 | Notion ZIP, Markdown, CSV |
| Record collections (plugin data, §5) | client + server | M9 | — |
| Actions (online RPC) | server | M9 | — |
| Change consumers (automations) | worker | M9 | — |
| Jobs (queued and scheduled) | worker | M9 | — |
| Settings pages (instance, workspace) | client | M9 | — |

**Not extensible**: permission evaluation, authentication and sessions, the mutation
catalog (§5.2), the sync protocol and change-log delivery rules, the CSP and security
headers, the Yjs persistence path.

## 5. Data

### 5.1 Tables (M9)
- `plugins` (instance level): id, version, enabled, status, error, settings jsonb (secret
  fields encrypted with `ARDOISE_SECRET_KEY`), installed_at, updated_at.
- `workspace_plugins` (workspace_id, plugin_id, enabled, settings jsonb, enabled_by,
  enabled_at), PK `(workspace_id, plugin_id)`.
- `plugin_records` (workspace_id, id, plugin_id, collection, page_id nullable, user_id
  nullable, key text nullable, data jsonb, created_by, created_at, updated_by,
  updated_at, deleted_at):
  - PK `(workspace_id, id)`, indexes `(workspace_id, plugin_id, collection, key)` and
    `(workspace_id, page_id)`;
  - `data` is capped (default 64 KB); bigger payloads go to `files`;
  - lists are always paginated by `(key, id)`, never unbounded (CLAUDE.md §1.3).

### 5.2 Governance and sync
Each collection declares how its records are governed. This maps one to one onto the
change-log columns that M2 already has (ARCHITECTURE §4.8, ADR 0006 item 5):

| Governance | Read | Write | Change log |
|---|---|---|---|
| `page` | can view `page_id` | level declared by the collection (default Can edit) | `page_id` set |
| `user` | `user_id` only | `user_id` only | `user_id` set |
| `workspace` | every member (guests excluded unless declared) | admins, or a declared role | neither set |

- Records sync like other structured data: one new entity type `pluginRecord` in the
  change log, the pull and the client store.
- Writes use **two generic core mutations**, `pluginRecord.set` (whole-record upsert,
  last-writer-wins per record) and `pluginRecord.delete`. The collection provides a zod
  schema for `data`, validated on the client and on the server. Plugins that need finer
  conflict granularity split their data into several records.
- **Plugins never add mutation names.** This keeps the M2 catalog, its typed handlers
  and its pure apply functions closed and fully tested. A collection may declare
  `offline: true` to join the offline whitelist (PRODUCT §15).
- Writes that need server logic go through an **action** (§8.2), which writes records
  through the same pipeline, so they still reach the change log.

### 5.3 Other storage
- **Block data** lives in the Yjs node attributes (§6.2), or in the `ext` attribute for
  data attached to a core block (§6.5). State that several people edit at once goes to a
  plugin subdocument (§6.6). Data that is not part of the content (for example per-user
  state) goes to records keyed by `blockId`.
- **Property values** of plugin property types live in `pages.properties`, like core
  types, and are indexed in `database_row_values` through their value kind (§11, M4).
- **Files** go through the `files` module API, with the same limits and permissions.

### 5.4 Disable and uninstall
- Disabling keeps everything. Records are no longer delivered and actions return
  `plugin_disabled`. Blocks, properties and layouts fall back to placeholders (§6.3).
- Removing a plugin package behaves like disabling.
- **Purging** a plugin's data is an explicit super-admin or workspace-admin action that
  runs as a job and is logged.

## 6. Editor: reserved nodes

### 6.1 Why the schema must not depend on plugins
A ProseMirror schema is fixed when the editor is created, and every collaborator on a
document must use the same schema. `y-prosemirror` cannot represent nodes the schema
does not know: their content would be dropped or the sync would fail. The server also
decodes every document (projection, Markdown export, history diff, AI retrieval). If
plugins added their own node types, the documents of an instance would depend on which
plugins are installed, and disabling a plugin would destroy content.

### 6.2 Reserved nodes and mark
The core schema reserves these generic types in M3. No plugin is needed to render, store
or decode them:

| Type | Kind | Content | Attributes |
|---|---|---|---|
| `pluginBlock` | block node | none (atom) | `blockId`, `plugin`, `type`, `version` (int), `data` (JSON object, ≤ 16 KB), `text` (string, fallback) |
| `pluginContainer` | block node | `block+` | same as `pluginBlock` |
| `pluginText` | block node (textblock) | `inline*` | same as `pluginBlock` |
| `pluginInline` | inline node | none (atom) | `plugin`, `type`, `version`, `data`, `text` |
| `pluginMark` | mark | — | `plugin`, `type`, `version`, `data` (≤ 4 KB) |

- `pluginContainer` lets a plugin host rich content (paragraphs, lists, other blocks), for
  example a custom card or a tabbed section. It follows the block-container nesting pattern.
- `pluginText` is a text block whose text is edited natively: it is merged by the CRDT,
  shows collaborators' cursors and carries marks and inline comments. Examples: a
  dialogue line, a styled title or a statement line. It can hold child blocks through the
  block-container pattern, like any block.
- `pluginInline` is for inline elements that are not text: a badge, a status chip, an
  inline formula or a custom mention.
- `pluginMark` is for inline formatting: semantic highlights, spoilers, annotations,
  footnote references or links to external entities. It is declared with `excludes: ""`,
  so several plugin marks with different attributes can cover the same text. It is
  `inclusive: false` by default, and the plugin chooses whether typing at its edge extends it.
- `text` is a short fallback the plugin keeps up to date, used by search, Markdown export
  and placeholders when the plugin is missing. For `pluginText`, the node's own text is
  the fallback.
- `version` and an optional `migrate(data, fromVersion)` in the plugin let it evolve its
  `data` format lazily, when a block is rendered or edited.
- Core blocks remain native ProseMirror nodes. These types are only for plugins.
- **Concurrency**: each attribute is a single Yjs value, so concurrent edits of `data`
  follow last-writer-wins on the whole object. `data` suits configuration and small state
  that one person changes at a time. State that several people edit at once goes to a
  subdocument (§6.6).

### 6.3 Fallbacks
- Missing or disabled plugin: the node and its attributes stay untouched in Yjs, so
  re-enabling restores everything.
  - `pluginBlock` and `pluginInline` show a read-only placeholder with the plugin id and `text`.
  - `pluginContainer` shows a neutral frame; its children keep rendering and stay editable.
  - `pluginText` renders as a plain paragraph that stays editable, with a discreet plugin
    indicator.
  - `pluginMark` renders its text without formatting. The mark stays in the document.
  - `ext` data (§6.5) is ignored, but kept.
- Projection: use the plugin extractor if loaded on the server, otherwise `text`, plus the
  text of the node's content and children. Mark data is not indexed without an extractor.
- Markdown export: the plugin serializer if any, otherwise a lossless HTML comment
  `<!-- ardoise:plugin {"plugin":…,"type":…,"version":…,"data":…} -->` followed by `text`
  (for `pluginText`, by its text). Marks without a serializer export as plain text, and
  the loss is listed in the export report.

### 6.4 Overlapping plugin marks
`y-prosemirror` stores marks as Yjs formatting attributes keyed by mark name, so
overlapping marks of the same type need care. M3 must check, with a unit test, that two
`pluginMark` instances with different attributes on overlapping text survive a Yjs round
trip and a concurrent edit. If they do not, the fallback is to reserve a small fixed set
of distinct mark names (`pluginMark1` … `pluginMark4`), allocated per plugin at enable
time. The result is recorded in the M3 summary and in ADR 0008.

### 6.5 Data on core blocks: the `ext` attribute
Every core block node, and `pluginBlock`, `pluginContainer` and `pluginText`, carries a
global attribute `ext` (default `null`), declared once through a Tiptap global attribute:
- its shape is `{ [pluginId]: JSON object }`, capped at 4 KB per plugin and 16 KB in total;
- a plugin reads and writes only its own key, through the SDK;
- it follows the block through copy and paste, duplication, history, templates and
  synced blocks, because it is part of the content;
- examples: a priority on a to-do, a review status on a paragraph, a source reference on
  a quote;
- concurrency is last-writer-wins on the whole `ext` value, like `data` (§6.2). The SDK
  writes it with a read-modify-write in a single ProseMirror transaction, so two plugins
  writing different keys at the same time can still conflict. This is documented as a
  known limit, and frequently edited state belongs in records or a subdocument.

Core node views ignore `ext`. A plugin shows it through an editor behavior
(decorations, §4) or a block-menu action.

### 6.6 Plugin subdocuments
For state that several people edit at the same time (a whiteboard, a diagram, a small
spreadsheet), a plugin block can own a **separate Yjs document**:
- name `plugin:<blockId>`, stored in `page_documents` like `page:<id>` and
  `synced:<id>` (ARCHITECTURE §4.4). The `plugin:` prefix is reserved from M3;
- access follows the page that contains the block, checked in Hocuspocus
  `onAuthenticate` (the block's page is recorded with the document);
- the plugin chooses the Yjs structure (`Y.Map`, `Y.Array`, `Y.Text`…) and gets
  fine-grained merging;
- size is capped (default 5 MB per subdocument) and the cap is enforced in `onStoreDocument`;
- in M9, version history snapshots and restores include a page's subdocuments, export
  uses the plugin serializer or a JSON dump, and duplicating a block copies its subdocument;
- if the plugin is missing, the subdocument is kept as is and the block shows its placeholder.

### 6.7 Structure and normalization
The schema cannot constrain what a `pluginContainer` holds (for example, "only tab
containers"). A plugin that needs a structure normalizes it in an
`appendTransaction` and validates it when it renders. That only runs where the plugin is
loaded, so the plugin must accept any content it finds and repair it without data loss.
This limit is documented in the developer guide.

## 7. Client runtime (M9)

- Client bundles are ESM files served at `/plugins/<id>/<version>/…` with immutable,
  hashed names, and loaded with dynamic `import()` the first time a contribution is
  needed. The static manifest (§3) drives menus before the code is loaded.
- Shared libraries (React, ReactDOM, Tiptap core, Yjs, i18next and the SDK) are provided by
  the host through an **import map**, so plugins never bundle a second React or a
  second Yjs. Plugins build with these marked as external. The SDK exposes the shadcn/ui
  components the app uses, so plugin UI looks native.
- i18n: plugin strings live under the `plugin.<id>` namespace, in both `fr` and `en`
  (completeness test extended to plugins).
- PWA: the service worker fetches the list of enabled plugins' client assets from
  `/api/plugins/client-manifest` and caches them, so plugins keep working offline.
- CSP: same origin only. A Tier 1 plugin that needs an outside origin (for example an
  embed) declares it in `capabilities` and the super-admin approves it. The host
  then adds it to `connect-src` or `frame-src`.

## 8. Server runtime (M9)

### 8.1 Context
`activate(ctx)` runs at boot in every role. The plugin only uses what `ctx` offers:
- `ctx.registries`: blocks, extractors, serializers, property types, notification
  types, templates, AI providers and commands, importers, MCP tools;
- `ctx.records`, `ctx.pages` (reads), `ctx.content` (read and write Yjs documents through a
  Hocuspocus direct connection, the same helper the M7 API uses), `ctx.files`;
- `ctx.jobs` (names prefixed `plugin:<id>:`), `ctx.schedule` (cron-like, worker role);
- `ctx.http` (routes mounted under `/api/plugins/<id>/`, CSRF and session checks
  applied by the host), `ctx.settings`, `ctx.i18n`, `ctx.logger`, `ctx.clock`.

### 8.2 Who the plugin acts as
- In an HTTP route or action, the plugin acts **as the calling user**, with that user's
  permissions.
- In consumers and jobs, it acts as a per-workspace **integration principal**
  (`principal_kind = integration`, which already exists), so it sees only the pages that
  are shared with it in the share menu, like an integration token (M7).

### 8.3 Reacting to changes
- **Change consumers** read the change log with a per-(plugin, workspace) cursor, in the
  worker role, at least once, filtered by the plugin principal's access with the same
  delivery rules as the pull. The pull service is reused as is.
- **No synchronous hooks** in the mutation transaction: no veto, no rewrite. That keeps
  seq serialization short (ARCHITECTURE §4.8) and the mutation budget intact. Plugins
  that need validation do it in their collection schema or their action.
- Outgoing **webhooks** (Tier 0) are a core consumer that posts signed, filtered change
  notifications to a URL configured with an integration.

### 8.4 Failure isolation
- Every call into plugin code is wrapped with a timeout and error capture. Errors are
  logged with the plugin id and never surface stack traces to clients.
- A plugin that keeps failing is marked `failing` and its consumers are paused.
- A failing activation disables the plugin, but boot continues.

## 9. Licensing and clean-room

- A Tier 1 plugin runs in the same process and links against Ardoise, so it forms a
  combined work: its `license` must be in the ADR 0001 allowlist, and the loader refuses
  the others (open question Q2). Operators who modify and serve Ardoise with plugins
  must offer their source to network users, as AGPL §13 requires.
- Tier 0 clients (API, MCP, webhooks) are separate programs and can use any license.
- The SDK is `AGPL-3.0-only`, like the rest of the repository (open question Q2).
- First-party plugins live in `plugins/` in the monorepo, carry SPDX headers and pass
  the license check.
- Clean-room: plugin API names and concepts are Ardoise's own. There is no compatibility
  layer with Notion's API, block format or integration model.

## 10. Impact on M2 (done)

**Nothing needs to be redone.**
- `change_log.entity_type` is `text`, so `pluginRecord` needs no migration of existing data.
- The delivery rules already handle page-governed (`page_id`) and user-private
  (`user_id`) entries, which is all plugin governance needs (§5.2).
- `principal_kind = integration` already exists for plugin principals (§8.2).
- The mutation catalog stays closed: M9 adds two core mutations (`pluginRecord.set`,
  `pluginRecord.delete`), the `pluginRecord` entity type and its delivery rule, using the
  same mechanism as any other catalog addition.
- Jobs stay a typed closed map for the core. M9 adds one generic `plugin.job` entry that
  dispatches to the plugin by name.
- `page_documents.doc_name` is already free-form (`page:<id>`, `synced:<id>`), so plugin
  subdocuments (`plugin:<blockId>`, §6.6) need no schema change either.

## 11. Seams to build in M3–M8

These rules apply from M3 onwards (ARCHITECTURE §15). Each one is small, and most of them
are good structure even without plugins. ROADMAP lists them as tasks.

**Cross-cutting**
- Anything a plugin may extend is identified by a **string** (zod schema built from a
  registry, `text` column). `pgEnum` is kept for closed core concepts (roles, levels,
  page kinds).
- Lists of features (slash items, property types, layouts, AI commands…) are read from
  a registry, never hard-coded in a component or a `switch`.
- Server domain code never assumes that every node type, property type or layout is a
  core one: unknown values take the documented fallback.

**M3 — Editor**
- Reserve `pluginBlock`, `pluginContainer`, `pluginText`, `pluginInline` and `pluginMark`
  in the schema, with their fallbacks (§6.2, §6.3), and the global `ext` attribute on
  every block node (§6.5). Unit tests, with no plugin loaded: a document holding all of
  them round-trips through Yjs and the server decoder with attributes intact; `ext`
  survives copy and paste and duplication.
- Check overlapping `pluginMark` instances with `y-prosemirror`, and apply the
  fallback if needed (§6.4).
- Reserve the `plugin:` document-name prefix: Hocuspocus rejects it until M9.
- Core editor behaviors (shortcuts, Markdown input rules, paste conversion) are
  registered as editor behaviors, not wired directly into the editor component.
- A **block definition registry**: each core block declares its Tiptap extension, slash
  item (i18n key, icon, keywords), block-menu actions and "turn into" support. The slash
  menu and block menu read the registry.
- The editor extension list is assembled from the registry, not hard-coded in the editor
  component.
- **Projection extractors** keyed by node type, with the generic fallback for unknown nodes.

**M4 — Databases**
- A **property type registry**: `type`, config schema, value schema, **value kind**
  (`text | number | date | bool | user | none`), indexing into `database_row_values`,
  conversions, and the client cell renderer and editor.
- The view compiler, operators and column calculations depend on the **value kind**,
  never on the property type. That way, a plugin type (or the later relation, rollup and
  formula types) gets filters, sorts and calculations for free.
- `database_views.layout` and the property `type` are strings validated by the registry.
  Plugin values are namespaced `<pluginId>/<name>`.
- Fallbacks: unknown property types show their raw value read-only, and unknown layouts
  render as a table.
- A **layout registry** on the client. Layouts read data only through
  `POST /databases/:pageId/query`.

**M5 — Offline**
- The offline whitelist is a flag on each mutation definition (plus, in M9, per record
  collection), not a hard-coded list in the store.
- The service worker can cache extra assets listed at runtime (prepares §7).

**M6 — Comments, notifications, history, templates**
- Notification types are a registry (payload schema, i18n keys, default preferences).
  `notifications.type` and `notification_preferences.type` are `text`.
- Templates have a `source` (`builtin | workspace`, later `plugin`).

**M7 — API, MCP, Markdown**
- Markdown serializers and parsers are a registry keyed by node type, with the lossless
  comment fallback for plugin nodes (§6.3).
- MCP tools are a registry. Token scopes are strings.
- The public API documents the reserved plugin types and the `ext` attribute in its block JSON.

**M8 — AI and import**
- `AiProvider` adapters and AI commands (prompt id, i18n label, input, output mode) are
  registries.
- Importers are a registry (`accepts(file)`, job). The Notion and Markdown importers are
  the first two entries.

## 12. M9 outline

See ROADMAP M9. Summary:
1. `packages/plugin-sdk`: manifest schema, types, `definePlugin`, client helpers.
2. Server `plugins` module: loader, statuses, instance and workspace enablement, settings.
3. `plugin_records` and the two mutations; `pluginRecord` in pull and the client store.
4. Actions, routes, jobs, schedules, change consumers, MCP tools.
5. Client loader with an import map, lazy contributions, the PWA client manifest.
6. Webhooks (Tier 0).
7. Admin and workspace UI: list, capabilities, enable, status, settings, purge.
8. Subdocuments: Hocuspocus authorization by containing page, size cap, inclusion in
   history, export and duplication.
9. Three first-party example plugins that cover the main points: a collaborative
   diagram block (block, subdocument, Markdown, projection), a rating property type
   (property type, number value kind, `ext` attribute on to-dos) and a change notifier
   (consumer, settings, outbound capability).
10. Plugin developer guide in `docs/`, including which storage to use for which state.

## 13. Questions for the maintainer

Q4 is decided. Q1–Q3 stay open and must be settled before M9 starts. Until then, the
proposed answers are the working assumption.

- **Q1 — Trust model**: trusted in-process Tier 1 first, sandboxing later (proposed), or
  sandboxing from the start (much more work, limits what plugins can do)?
- **Q2 — License policy**: should the loader refuse non-allowlisted plugin licenses
  (proposed) or only warn? Should the SDK stay `AGPL-3.0-only` (proposed) or use a
  more permissive license?
- **Q3 — Timing**: plugins as M9 right after v1 (proposed), or after the relations and
  formulas milestone?
- **Q4 — Reserved editor types: decided (2026-11-23)**. The five reserved types, the
  `ext` attribute and the `plugin:` subdocument prefix are part of the M3 schema (§6).
  This fixes a persisted format, so changing it later needs a document migration.

## 14. Risks

- **API surface frozen too early**: the SDK is versioned separately, and M9 starts at
  `0.x` until the three example plugins and one outside plugin have used it.
- **Performance regressions from plugins**: lazy loading, timeouts, no hooks in
  transactions, and plugin-aware benchmarks in M9.
- **Shared library versions** (React, Tiptap, Yjs): the import map pins the host's
  versions, and `engine` ranges document what a plugin was built against.
- **Seams that drift during M3–M8**: each milestone summary reports the state of its seams.
- **Coarse concurrency on `data` and `ext`**: the SDK documents which storage to use for
  which kind of state (§5.3), and the example plugins use subdocuments where several
  people edit together.
- **Subdocuments spread a page over several Yjs documents**: history, export,
  duplication and deletion must handle them together (§6.6). M9 covers this with
  integration tests.
