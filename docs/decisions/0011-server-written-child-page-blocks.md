# 0011 — Server-written child page blocks

- Status: accepted
- Date: 2026-11-25
- Milestone: M3 (follow-up)

## Context
Until now only browsers wrote page content (ARCHITECTURE §5): the editor's `/page`
command created the page with `page.create` and inserted a `childPage` block at the
cursor. Pages created from the sidebar, moved into a page or restored under one had no
block, so the page view listed "Pages inside" below the content. That list has been
removed: a page shows only its content, and its subpages must show as child page blocks.

The block must appear whatever the client (sidebar, move dialog, drag and drop, offline
replay, and later the public API, MCP and import), so the server has to write it.
Writing `page_documents` directly would be overwritten by a collab node holding the
document in memory.

## Options considered
1. Client side: the sidebar opens the parent's document over the collab socket, adds
   the block and closes it. No server change, but nothing happens offline or for
   non-browser clients, and every client must reimplement it.
2. Server side, inline in the mutation: the api role has no Hocuspocus, and a mutation
   would wait on document I/O inside its transaction.
3. Server side, in a job, through a Hocuspocus direct connection (chosen).

## Decision
- `page.create` gains `appendBlock` (default `true`). The editor passes `false` because
  it inserts the block at the cursor itself.
- `page.create` (under a page, with `appendBlock`), `page.move` (when the parent
  changes), `page.restore` (back under a page) and `page.duplicate` (under a page)
  enqueue `page.childBlock { pageId, from?, to?, afterPageId? }` after commit.
- The worker processes it with `ChildBlockService`. It reads the page's *current* parent:
  it removes the blocks in `from` only if the page is no longer there, and adds a block
  in `to` only if the page is still there and neither page is in the trash. Jobs that
  run late or out of order therefore converge. Adding is idempotent (no block if one
  exists at any depth). A duplicate's block goes right after its source's block, and
  other blocks go at the end of the content.
- The edit goes through `Hocuspocus.openDirectConnection`. With `role=all` it is the
  instance serving editors, so open editors see the block at once. With `role=worker`,
  the worker builds a headless `CollabServer` (never attached to a socket) with the
  Valkey extension, so the update reaches the collab nodes holding the document. It is
  stored by the usual `onStoreDocument` hook (size limit and projection included).
- Trashing a page keeps its block (it renders as deleted, and a restore brings it back).
  Reorders among siblings do not touch content. Moving a `childPage` block with the
  block menu's "Move to" still moves only the block (unchanged).

## Consequences
- The server now writes page content, but only through Hocuspocus and only for child
  page blocks. Public API, MCP and import writes (M7, M8) can reuse `ContentEditor`.
- A worker-only process opens a Valkey connection for the collab extension.
- With separate worker and collab nodes, the worker may load a document state up to the
  store debounce (≤ 10 s) older than the live one before Valkey syncs them. Adding is a
  CRDT insert and merges fine. A removal can miss a block inserted in that window: that
  block then renders as "moved", as before.
- `appendBlock` defaults to `true`: mutations queued offline by older clients for the
  editor's `/page` could produce a second block (one-time, negligible).
