# 0009 — Document schema, collab protocol, files and search details

- Status: accepted (approved by the maintainer at the start of M3)
- Date: 2026-11-23
- Milestone: M3

## Context
M3 builds the editor, real-time collaboration, files, projection and search.
ARCHITECTURE §4.4, §4.7, §5 and §11 and PLUGINS.md §6 fix the general shape, but leave
points open that become **persisted formats** as soon as the first document is stored:

- "Block-container pattern" is named but not defined: where `blockId`, `ext` and the
  children live, and how text blocks, atoms, lists, tables and columns fit in it.
  PLUGINS §6.2 describes `pluginText` as a textblock that can also hold child blocks,
  which ProseMirror does not allow on a single node.
- The Yjs fragment name, the Hocuspocus document name (it must be unique per instance,
  while `page_documents` is keyed by workspace) and the primary key of `page_documents`.
- Whether page titles live in the Yjs document or stay in `pages.title`.
- Which states are shared (in the document) and which are per user (toggle open/closed).
- How collab authenticates, how revocation and page locks reach open connections.
- The `files` lifecycle (which page governs access, public pages, deletion).
- How search filters by permission without loading unbounded candidate sets.

## Options considered
1. **Wrapper node** (`block { blockId, ext }` with content `blockContent blockChildren?`,
   the type living in the inner node). Uniform "turn into", but every block is two nodes
   deep, the block type is not the node type, and `blockId` moves away from the plugin
   node attributes already documented.
2. **Typed container nodes** (chosen): every block is one node named after its type,
   carrying `blockId`, `ext` and its own attributes, whose content is an optional text
   part (its own textblock child) followed by an optional `children` group. The node type *is* the block type,
   which keeps projection, Markdown, the public API and PLUGINS §6.2 simple.
3. **Flat document** with an `indent` attribute (no real nesting). Simplest schema, but
   moving or deleting a parent does not carry its children, and toggles cannot hide
   them structurally.

## Decision
1. **Document shape** (Yjs `XmlFragment` named `content`, schema in `packages/editor`):
   - `doc` → `block*` (an empty page is an empty fragment; the editor shows a placeholder
     paragraph locally and only writes once the user types).
   - Group `block`: every block node has `blockId` (UUIDv7, unique within its document)
     and `ext` (default `null`, PLUGINS §6.5).
   - Text blocks have content `blockText children?`. `blockText` is a single textblock
     node type (`inline*`) shared by all text blocks, so "turn into" is `setNodeMarkup` and keeps
     text, marks, children and `blockId`:
     `paragraph`, `heading {level 1–3, toggle}`, `bulletedItem`, `numberedItem`,
     `todo {checked}`, `toggle`, `quote`, `callout {icon}`, `pluginText`.
     Every text block also has `color` (a named token such as `red` or `red_background`,
     or `null`).
   - `codeBlock {language, wrap}` has content `codeText children?`, where `codeText` is
     `text*` with no marks.
   - Atom-like blocks have content `children?`: `divider`, `image {fileId, width,
     caption}`, `file {fileId, name, size}`, `equation {latex}`, `pageLink {pageId}`,
     `childPage {pageId}`, `tableOfContents`, `bookmark {url, title, description, siteName}`,
     `pluginBlock`.
   - `children` is `block+`. Tab/Shift+Tab move a block into or out of its previous
     sibling's `children`.
   - `table {headerRow, headerColumn}` → `tableRow+` → `tableCell+`, cells `inline*`
     (simple table). Tables have no `children`.
   - `columns` → `column{2,5}` (attribute `width`, a fraction) → `block+`. Columns have no
     `children`, and a column holds no `columns`.
   - `pluginContainer` has content `block+` (its body) and no separate `children`.
   - Numbered items have no persisted number: consecutive `numberedItem` siblings count
     from 1, computed when rendering.
   - Captions are a plain string attribute (concurrent edits: last writer wins).
   - Inline nodes: `mention {kind user|page|date, id, date}`, `inlineEquation {latex}`,
     `hardBreak`, `pluginInline`.
   - Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link {href}`,
     `textColor {color}`, `backgroundColor {color}`, `pluginMark` (`excludes: ""`).
   - PLUGINS §6.2 is amended: `pluginText` is a text block in the sense above (content
     `blockText children?`), not a ProseMirror textblock itself.
2. **Title** stays in `pages.title`, edited through `page.update` (M2). The Yjs document
   holds the body only. Search and projection read the title from `pages`.
3. **Shared vs per-user state**: the open/closed state of toggles and toggle headings is
   per user and per device (local storage), not in the document. Everything else above
   is shared.
4. **Documents**:
   - `page_documents` primary key `(workspace_id, doc_name)`, `page_id` is the page that
     governs access (the page itself for `page:<id>`, the source page for `synced:<id>`
     and the containing page for `plugin:<blockId>`).
   - The Hocuspocus document name is `<workspaceId>/<doc_name>`, e.g.
     `0190…/page:0190…`. The server parses and validates it and rejects unknown prefixes;
     `plugin:` is reserved and rejected until M9, `synced:` until M6.
   - A document over 10 MB (encoded state) is not stored and the connection gets a
     `document_too_large` close; the limit is an admin setting.
5. **Collab auth**: the WebSocket upgrade at `/collab` carries the session cookie; the
   server checks the `Origin` header against `ARDOISE_PUBLIC_URL` (no CSRF token on a
   WebSocket). `onAuthenticate` requires Can view and sets `connection.readOnly` unless
   the user has Can edit **and** the page is not locked.
6. **Revocation and lock**: mutation handlers that change access (`access` change-log
   entries) or a page lock publish `collab:recheck {workspaceId, pageIds | all}` on
   Valkey. Every collab node re-evaluates its open connections for those pages: it
   closes those that lost view access (`forbidden`, the client drops its local copy) and
   reconnects those whose read-only state changed.
7. **Files**:
   - `files` gets `page_id` NOT NULL (the page that governs access) plus `status
     pending|ready` and `thumbnail_key`. Uploads go to
     `POST /api/workspaces/:id/pages/:pageId/files` (Can edit), streamed to S3 with the
     admin size limit, MIME sniffed from the first bytes.
   - `GET /files/:workspaceId/:id` (Can view on `page_id`; the workspace id keeps the
     lookup on the primary key), or `GET /api/public/:token/files/:id` when the token's
     page covers it,
     streams or redirects (ADR 0004). `?thumb=1` serves the thumbnail when ready.
   - Files are soft-deleted with their page's purge; orphaned files (no longer referenced
     by any document) are kept until the page is purged in v1.
8. **Search**:
   - Quick find: trigram on `pages.title` within the workspace, then batched permission
     checks; it scans at most 500 candidates per call and returns up to 20.
   - Full search: `page_search.tsv` with `websearch_to_tsquery('simple', unaccent(q))`,
     ranked, filtered by the request filters in SQL, then by permission in batches; keyset
     pagination on `(rank, page_id)`, at most 2,000 candidates scanned per page of
     results, with `hasMore` reflecting the scan limit.
   - `page_search` rows are written by the projection job and when the title changes
     (in the same transaction as `page.update`), so titles are searchable at once.
9. **Bookmarks**: previews are fetched by the server
   (`POST /api/workspaces/:id/link-preview`, Can edit somewhere in the workspace) with
   an SSRF guard (http/https only, public addresses only after DNS resolution, 5 s
   timeout, 1 MB cap, no redirects to private addresses). Only title, description and
   site name are kept; remote images are not shown (strict CSP).
10. **Public pages** read their content through `GET /api/public/:token/content` (editor
    JSON decoded on the server, rendered by a read-only editor without a collab
    connection).

## Consequences
- ARCHITECTURE §4.4, §4.7, §5 and §11 and PLUGINS.md §6.2 are updated in this change.
- The document schema becomes a persisted format: any later change to node names or
  content expressions needs a document migration (decode, transform, re-encode).
- Turning a text block into a code block, or the reverse, rebuilds the node (text kept,
  marks dropped) because their text parts differ.
- Toggle state does not follow the user between devices.
- Search permission filtering caps the scan; a user with access to very few pages in a
  huge workspace may see `hasMore` with few results and has to narrow the query.
