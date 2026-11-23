# M3 — Editor and real-time collaboration: plan

Goal (ROADMAP M3): the block editor with every v1 block except databases and synced
blocks, real-time co-editing with presence, the `collab` role, files, projection with
backlinks, search, page lock enforcement, and the plugin extension seams (ADR 0008).

Decisions to approve at the start of M3: **ADR 0009** (document schema, document names,
collab auth and revocation, files, search, bookmarks, public page content).

## Tasks

| # | Task | Tests |
|---|---|---|
| T1 | Docs: this plan, ADR 0009, ARCHITECTURE §4.4/§4.7/§5/§11, PLUGINS §6.2 | — |
| T2 | `packages/editor` schema: block nodes (ADR 0009 §1), reserved plugin nodes and `pluginMark`, global `ext`, `blockId` uniqueness plugin, headless `getSchema` usable on the server; overlap test of `pluginMark` through `y-prosemirror` (PLUGINS §6.4) | unit |
| T3 | `packages/editor` registries: block definitions (extension, slash item, block-menu actions, turn-into targets), editor behaviors (keymaps, input rules, paste rules), projection extractors with generic fallback; node commands (indent/outdent, split/join, turn into, duplicate with new ids, move up/down) | unit |
| T4 | `packages/editor` projection: Yjs state → editor JSON → plain text, outline, links, page mentions, user mentions (with `blockId`), using the extractor registry | unit |
| T5 | `packages/markdown`: Markdown → editor JSON for paste (remark + GFM); plain text and HTML paste go through the schema's parse rules | unit |
| T6 | `packages/db`: `page_documents`, `files`, `page_search`, `page_links`, `page_mentions_users`; migration `0003` | integration |
| T7 | Server `collab` module: Hocuspocus at `/collab` (in-process for `all`, own listener for `collab`), document-name parsing, `onAuthenticate` (cookie + Origin), read-only for view-only and locked pages, persistence with size cap, Valkey extension, `collab:recheck` handling (close on revoke, reconnect on lock/level change), projection job enqueue | unit + integration (2 collab nodes) |
| T8 | Server `projection` module: debounced BullMQ job per document, updates `page_search`, `page_links`, `page_mentions_users`; title write-through on `page.update`; backlinks read `GET …/pages/:id/backlinks` (permission-filtered, paginated) | unit + integration |
| T9 | Server `files` module: streamed multipart upload to S3 (busboy + lib-storage), size limit and MIME sniffing, `GET /files/:id` (stream with ranges or presigned redirect), thumbnails job (sharp), public-link access | unit + integration |
| T10 | Server `search` module: `SearchPort` + `PostgresSearchAdapter` (quick find by trigram, FTS with filters, `ts_headline` snippets, keyset pagination, batched permission filter); link-preview endpoint with SSRF guard; public page content endpoint; page duplicate copies content with fresh block ids | unit + integration |
| T11 | Web editor: Tiptap with Collaboration + caret, `HocuspocusProviderWebsocket` shared socket, node views for every block, numbered-list counting, toggles, code highlighting (lowlight), KaTeX, images/files upload, table, columns, table of contents, bookmark, child page / link to page, placeholders for plugin nodes | unit |
| T12 | Web editing UI: slash menu (fuzzy, keyboard), drag handles with drop (including beside a block to create columns), block menu (turn into, color, duplicate, move to, copy link, delete), multi-block selection, bubble menu for marks/colors/links/inline equation, `@` mentions (user, page, date), paste conversion | unit |
| T13 | Web collaboration UI: presence avatars, colored cursors and selections, read-only and locked states, revoked-access handling (drop the local copy), backlinks panel, scroll to `#block-<id>` | unit |
| T14 | Web search: quick find dialog (Ctrl/Cmd+K) and full search page with filters and snippets | unit |
| T15 | E2E *two browsers co-edit a page; cursors visible; no lost text*; plus lock and search journeys | e2e |
| T16 | Docs, ROADMAP boxes, summary (state of the plugin seams, PLUGINS §14) | — |

## Choices made (spec ambiguities, simplest option)

- **Schema format**: see ADR 0009 §1. Block ids are generated on the client (UUIDv7) and
  repaired by an `appendTransaction` when a paste or split duplicates one.
- **Undo** uses the `y-prosemirror` undo manager (per user, own changes only).
- **Child pages**: creating a page from the slash menu creates it with `page.create` and
  inserts a `childPage` block. Pages created from the sidebar get no block; the page view
  lists the subpages that no `childPage` block references, below the editor. Deleting a
  `childPage` block from the block menu also trashes the page; removing it by editing
  text does not (the page then shows in that list). A `childPage` whose page moved
  elsewhere or is trashed renders as a muted "moved" / "deleted" link.
- **Move to** (block menu) moves a block to another page by inserting it at the end of the
  target document (opened through a short-lived provider) and then removing it here.
- **Columns** are created from the slash menu (2–5) or by dropping a block on the left or
  right edge of another block. A column left with no block is removed, and `columns`
  with one column left is unwrapped.
- **Colors** are named tokens (`gray`, `brown`, `orange`, `yellow`, `green`, `blue`,
  `purple`, `pink`, `red`, each also as `_background`), mapped to our own Tailwind
  palette in light and dark.
- **Mentions**: user mentions list workspace members; page mentions use quick find; date
  mentions store an ISO date and render it relative or absolute (reminders are later).
- **Code highlighting**: `lowlight` with a fixed set of common languages, loaded lazily.
- **Equations**: KaTeX, rendered client-side; invalid LaTeX shows the source in red.
- **Bookmarks**: title, description and site name only (ADR 0009 §9).
- **Editor behaviors**: core keymaps, input rules and paste handling are registered as
  behaviors in the registry; the editor component only assembles the registry.
- **Large documents**: the editor stays a single ProseMirror view; node views of heavy
  blocks (code, equation, image) render lazily when they enter the viewport.
- **Public pages**: rendered from `GET /api/public/:token/content` with a read-only
  editor; files embedded in the page are served to the public token.
- **Projection debounce**: 5 s per document after a store; a title change updates
  `page_search` synchronously.
- **New dependencies** (licenses to check): `@tiptap/*` MIT packages, `yjs`,
  `y-prosemirror`, `@hocuspocus/server`, `@hocuspocus/provider`,
  `@hocuspocus/extension-redis` (MIT), `lowlight` + `highlight.js` (MIT/BSD-3), `katex`
  (MIT; its fonts are OFL-1.1, listed in the third-party notices), `busboy` (MIT),
  `@aws-sdk/lib-storage` and `@aws-sdk/s3-request-presigner` (Apache-2.0), `sharp`
  (Apache-2.0, libvips LGPL-3.0), `file-type` (MIT), `unified`/`remark-*` (MIT).

## Progress

- T1 done: ADR 0009 accepted; ARCHITECTURE §4.4/§4.7/§5/§11 and PLUGINS §6.2 updated.
- T2 done: schema in `packages/editor/src/schema` (headless, used by the server too),
  `UniqueBlockIds`, Yjs helpers (`docFromJSON`, `stateToJSON`). Overlapping `pluginMark`
  instances survive `y-prosemirror` (no fallback needed, ADR 0008 updated). Plugin
  attributes use `data-plugin-*` HTML names because `data-type` is the node tag.
- T3 done: `EditorRegistry` (blocks with slash items, turn-into targets and block actions;
  inline slash items; behaviors) and `createCoreRegistry`; the editor extension list is
  `registry.extensions()`. Block commands (indent/outdent, split, join backward/forward,
  delete with container repair, duplicate with fresh ids, move, turn into, color, drag and
  drop with columns), keymaps, Markdown shortcuts and paste conversion as behaviors.
  Choices: Shift+Tab makes the following siblings children of the outdented block (the
  visual order is kept); Enter on a block with children inserts the new block as its first
  child; a duplicated child page becomes a link to the same page; `>` makes a quote.

- T4 done: projection over editor JSON with an extractor registry (`ProjectionRegistry`)
  and the generic fallback (`text` attribute, then content); plain text capped at 200k
  characters; in-app hrefs (`/w/<ws>/p/<id>`) count as links.
- T5 done: `markdownToDoc` (remark + GFM + math); GitHub alerts become callouts, remote
  images become links (strict CSP), raw HTML stays text.
- T6 done: migration `0003` (`page_documents`, `files`, `page_search`, `page_links`,
  `page_mentions_users`), with `btree_gin` so the search GIN index starts with
  `workspace_id`. `files` has no foreign key to `pages`: a purge marks the files deleted
  and a daily job removes the objects. New admin limit `maxDocumentSizeMb` (10).
- T7 done (integration test written, run pending Docker): `CollabAccess`,
  `CollabPersistence` and `CollabServer` (Hocuspocus 4 on our own `ws` upgrade handler,
  Redis extension over Valkey). `collab:recheck` is published after access changes (whole
  workspace) and lock changes (that page); kicks re-check the user. Awareness `user` is
  rewritten with the session identity. Documents over the limit are not stored and
  connected clients get a `document_too_large` stateless message. Projection jobs use
  BullMQ deduplication (5 s delay, one follow-up when stored while running).

- License exception (ADR 0010): `@sesamecare-oss/redlock` 1.4.0 says `UNLICENSED` in
  `package.json` but ships the MIT license; the exception is pinned to that version.
- T8 done: `ProjectionService` (job + backlinks), title write-through in `page.create`
  and `page.update`. Self-links are dropped; mention notifications wait for M6.
- T9 done (integration pending Docker): `FileService` over an `ObjectStorage` port
  (S3 with `lib-storage`, memory fake). Downloads are `GET /files/:workspaceId/:id`
  (the workspace id keeps the lookup on the primary key) and
  `GET /api/public/:token/files/:id`. The MIME type comes from the first bytes for
  images and PDF (the only inline types); anything else downloads as an attachment
  under `Content-Security-Policy: sandbox`. Uploads are refused on locked or trashed
  pages. Thumbnails: sharp, 800 px WebP. Deleted files are purged after one day.

- T10 done (integration pending Docker): `SearchPort` with `PostgresSearchAdapter` and an
  in-memory fake. Migration `0004` adds the `ardoise` text search configuration (`simple`
  + `unaccent`, so snippets also highlight accented words), an immutable
  `ardoise_unaccent` and accent-insensitive title indexes (trigram from 3 characters,
  prefix below). Full search ranks at most the first 5,000 matches of a query (bounded
  cost for very common terms). Link previews go through an SSRF guard (`net.BlockList`
  checked on every DNS lookup, 3 redirects, 5 s, 1 MB). Public pages read
  `GET /api/public/:token/content`. Duplicating a page copies its content and its
  subpages' content (Yjs tree edited in place, so unknown nodes survive), with fresh
  block ids and child page blocks pointing to the copies.

## Risks and open questions

- **Schema is a persisted format** (ADR 0009): changing it later needs a document
  migration. It is reviewed before T2 starts.
- **Overlapping `pluginMark`** may not survive `y-prosemirror` (PLUGINS §6.4). If the test
  fails, the fallback `pluginMark1`…`pluginMark4` is applied and recorded in ADR 0008.
- **Search at 1M pages** with permission filtering after retrieval: benchmarked on the
  large seed; the scan caps keep it bounded.
- **Hocuspocus 4 and ioredis 6** compatibility for the Redis extension: checked in T7.
- **sharp** ships native binaries; the Docker image must include them for linux-x64 and
  linux-arm64.
- **Columns by drag and drop** is the most involved interaction; if it slips, slash-menu
  columns ship first and drag-to-create is recorded as a limitation.

## Summary (2026-11-23)

**Status: done, pending review.** All M3 boxes are ticked in `docs/ROADMAP.md`.

### What was built
- **Editor package** (`packages/editor`): the ADR 0009 schema (typed block containers,
  reserved plugin types, `ext`), `UniqueBlockIds`, Yjs helpers, block and table commands,
  `EditorRegistry` + `createCoreRegistry` (blocks, slash items, turn-into targets, block
  actions, behaviors), keymaps, Markdown shortcuts, paste conversion, projection with
  `ProjectionRegistry`, view helpers (list numbers, outline).
- **Markdown** (`packages/markdown`): Markdown → editor JSON (GFM, math, alerts).
- **Data model** (migrations `0003`, `0004`): `page_documents`, `files`, `page_search`,
  `page_links`, `page_mentions_users`; `btree_gin`; the `ardoise` text search
  configuration and `ardoise_unaccent`; accent-insensitive title indexes.
- **Server**:
  - `collab`: Hocuspocus 4 at `/collab` on our `ws` upgrade handler (in-process for
    `all`, own listener for `collab`), cookie + Origin auth, per-document authorization
    and read-only, persistence with the size cap, Valkey fan-out, `collab:recheck` after
    access and lock changes, awareness identity from the session.
  - `projection`: job per stored document (search text, links, user mentions), title
    write-through, backlinks read.
  - `files`: streamed uploads with limits and byte sniffing, ranged or presigned
    downloads, public-link files, thumbnails (sharp), purge job.
  - `search`: quick find (prefix first, then every word) and full-text search with
    filters and snippets, permission-filtered with bounded scans; link previews behind an
    SSRF guard; public page content; content copy on duplicate.
- **Web**: the page editor (Tiptap + Collaboration + carets) with node views for every
  block, decorations for text blocks, slash menu, `@` mentions, drag handles with
  columns, block menu, formatting and table toolbars, presence avatars, status banners
  (offline, read-only, locked, revoked, too large), backlinks, scroll to `#block-<id>`,
  quick find (recent pages, titles, content) and the search page, read-only content on
  public pages. The editor stack is a lazy chunk.

### Tests
- 681 unit tests: 114 shared, 122 editor, 8 markdown, 251 server, 85 web, 22 sync, 5 db,
  26 i18n, 48 scripts. They include the Yjs/server-decoder/clipboard round trip of every
  node type, overlapping plugin marks under a concurrent edit, block commands on nested
  and column structures, cross-block selections staying valid, an in-memory Hocuspocus
  server with real providers (sync, read-only, refusals, revocation, presence), files,
  projection, search, SSRF guard and the editor UI in jsdom.
- 48 integration tests (Testcontainers): collaboration across two collab nodes through
  Valkey (relay, persistence, reload, read-only, revocation on another node, `plugin:`
  refused, upgrade without session refused), uploads to RustFS (ranges, thumbnail, size
  limit), projection into search and backlinks, public content and files, link preview of
  an internal address refused.
- 18 e2e tests (Playwright), including *two browsers co-edit a page; cursors visible; no
  lost text* (concurrent typing in the same paragraph keeps every character, content
  survives a reload), Markdown shortcuts and the slash menu, lock and unlock seen live by
  a collaborator, quick find and full-text search. Run twice in a row: 18/18 both times.

### Acceptance verification
- `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `check:licenses`
  (810 packages), `check:spdx` (397 files) and `docker build` pass; sharp loads in the
  image.
- **Benchmarks** on a fresh large seed (1,111,040 pages with generated body text,
  22,220 grants; 247 s), production build, role=all, same dev host as M2:

| Operation | p50 | p95 | Budget (p95) |
|---|---|---|---|
| Sidebar level load, cold permission cache | 7.9 ms | 9.5 ms | 100 ms |
| Page metadata | 7.1 ms | 8.1 ms | 300 ms |
| Mutation round-trip | 12.0 ms | 13.8 ms | 150 ms |
| Quick find (title) | 11.0 ms | 18.2 ms | 150 ms |
| Full-text search, rare term | 166.7 ms | 175.6 ms | 500 ms |
| Full-text search, common term | 157.0 ms | 164.9 ms | 500 ms |

  The first quick-find run missed its budget (p95 1.7 s: ranking ~1M matching synthetic
  titles); prefix-first matching with capped candidates fixed it.

### Deviations and decisions
- **ADRs**: ADR 0009 (approved at the start); ADR 0010 (license exception for
  `@sesamecare-oss/redlock` 1.4.0: MIT license file, `UNLICENSED` metadata; the
  maintainer chose to keep AGPL-3.0-only).
- **Plugin seams**: all in place (PLUGINS.md §11 "State after M3"); overlapping
  `pluginMark` needs no fallback (ADR 0008).
- File downloads are `/files/:workspaceId/:id` (lookup on the primary key) instead of
  `/files/:id`; the session guard now covers `/files`.
- Projection jobs debounce by 5 s time windows with a job id per window (BullMQ
  deduplication did not release its key, and custom ids cannot contain `:`).
- The lock hint of the page view shows to people who can unlock (Full access); others
  see the editor's "This page is locked" banner.
- PRODUCT now states the child page block rules, per-device toggle state, columns
  creation, mention dates, bookmark previews without remote images, and quick find /
  search limits.

### Known limitations
- **Not verified on Windows**, **CI not run on GitHub**; benchmarks from a fast dev host.
- Full search ranks among the first 5,000 matches; quick find among 1,000 per pass. A
  user who can see few pages of a huge workspace may get few results (`hasMore` hints).
- Snippets of title-only matches show the start of the body.
- Moving blocks to another page copies them through the target's Yjs document from the
  browser; it needs edit access there and an online connection.
- Unsaved edits of a document over the size cap stay in memory only (the editor warns).
- Duplicating a page copies the last stored state (edits from the last ~10 s may be
  missed).
- Undo of a "move to" or of a child page creation does not restore the other page.
- Mention notifications arrive in M6 (new mentions are already computed).
- The e2e teardown prints a `57P01` error from the Postgres pool when the container
  stops; it predates M3 and does not affect results.
