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
