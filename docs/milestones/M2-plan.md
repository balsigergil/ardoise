# M2 — Sync engine, page tree, permissions: plan

Goal (ROADMAP M2): the mutation pipeline, the change log with pull and pokes, the client
store, the page tree with its sidebar, trash, favorites, recents and follows,
permissions with sharing and public links, the M1 workspace writes moved to mutations,
and the large-workspace seed with benchmarks.

Decisions approved at the start of M2: ADR 0006. Decided during M2: ADR 0007 (nesting capped at 40 levels). It covers:
- page roots (teamspace or private, plus a default teamspace per workspace);
- teamspace base access for members only;
- the strict-maximum permission rule;
- the `public_links` key;
- pull delivery rules;
- counter lock placement;
- the pull format and seq reconciliation;
- `/sync/ws` authentication;
- catalog additions.

## Tasks

| # | Task | Tests |
|---|---|---|
| T1 | Docs: this plan, ADR 0006, ARCHITECTURE §4.3/§6/§7/§9, PRODUCT §4/§5/§13 | — |
| T2 | `packages/shared`: fractional keys, page model and DTOs, permission evaluator, mutation catalog (zod args) with pure apply functions, sync protocol schemas | unit |
| T3 | `packages/db`: pages, page_permissions, favorites, recents, page_follows, public_links, change_log, applied_mutations; migration | integration |
| T4 | Server plumbing: BullMQ queues (api enqueues, worker processes), repositories for the new tables (Drizzle + memory) | unit |
| T5 | `permissions` module: evaluator over the ancestor chain loaded via `path`, Valkey cache keyed by `perm_epoch`, batched checks for lists and pull | unit + integration |
| T6 | `sync` module: `POST /sync/mutations` (idempotent, one transaction each, seq at the end), handlers for pages, favorites, follows, permissions, public links, and the M1 workspace/teamspace/member writes (REST write routes removed) | unit + integration |
| T7 | `sync` module: `GET /sync/pull` with delivery rules, pokes through Valkey to `/sync/ws` (coalesced per client) | unit + integration |
| T8 | `pages` module: scoped reads (children, teamspace roots, private, shared, page with breadcrumb, sharing, trash, favorites, recents), public link reads; jobs for large subtree moves, duplicate, trash retention, change-log purge | unit + integration |
| T9 | `packages/sync`: normalized store, optimistic apply, pending queue, rebase, per-entity seq, rejection events, Dexie persistence, HTTP/WS transport | unit |
| T10 | Web: sync provider; sidebar (Favorites, Teamspaces, Shared, Private) with a lazy, virtualized tree and drag and drop; page view with options; trash; settings writes through mutations | unit |
| T11 | Web: share dialog (who has access and why, restrict, recover), public link page (`noindex`) | unit |
| T12 | `db:seed`, `db:seed:large` (1M pages, deep trees, many grants), `apps/server/bench` (sidebar load, mutation round-trip, seq serialization) | — |
| T13 | Integration across 2 api nodes; E2E *create nested pages, move them, share with another user who sees them live* | integration + e2e |
| T14 | Docs, ROADMAP boxes, summary | — |

## Choices made (spec ambiguities, simplest option)

- **Positions**: the client computes fractional keys with `fractional-indexing` (CC0)
  and sends them in the mutation args. Siblings sort by `(position, id)`, so two clients
  inserting at the same spot stay deterministic. The server only validates the key.
- **Apply functions**: each mutation has a zod schema and a pure `apply(reader, args,
  actor)` in `packages/shared`.
  - `apply` returns the post-change entities, or a rejection code.
  - The client runs it optimistically, and the server runs it to validate and compute
    rows.
  - Subtree effects (path rewrite, trash, purge, duplicate) are SQL on the server. The
    client derives them from `parent_id`.
- **Lock**: a locked page rejects metadata edits (except unlocking), new children,
  moves into, out of or of the page, and trashing. Toggling the lock needs Full access.
- **Required levels**:
  - Can view: read;
  - Can edit: create children, rename and change options, move (Can edit on the page
    and on the new parent), trash, restore;
  - Full access: lock, sharing, public link, purge.
  - Creating a top-level page needs teamspace membership (or the private section).
    Guests cannot create top-level pages.
- **Trash**: trashing sets `deleted_at`/`deleted_root_id` on the whole subtree in one
  statement. Restore moves the root back (to the section root when the parent is gone or
  trashed). Purge deletes the subtree (grants, favorites and follows cascade). A daily
  job purges roots older than the retention setting.
- **Large subtrees** (more than 2,000 pages):
  - Moves set `move_state=moving` and a job rewrites `path` in chunks. The root's path
    is rewritten last, and permission evaluation uses the root's old path until then
    (ADR 0003).
  - Duplicates insert the root immediately, and a job copies the descendants.
  - Smaller subtrees are handled inside the mutation.
- **Duplicate** copies titles, options, grants and the restrict flag, not favorites or
  follows. Content duplication arrives with Yjs documents in M3.
- **Change log**: only the changed root of a subtree operation is logged (moves, trash,
  restore, duplicate); clients derive descendants. `access` entries are appended for
  grants, revokes, restricts, moves, membership and role changes.
- **Shared section**: pages granted to me (directly, to one of my teamspaces or to the
  workspace) that are outside my teamspaces and my private section, showing the topmost
  ones only. It is paginated.
- **Favorites** are user-private change-log entries with a fractional position.
  **Follows** are user-private entries too (notifications use them in M6). **Recents**
  go through `PUT/GET /api/workspaces/:id/recents`, capped at 50.
- **Public links**: `publicLink.set` enables or disables a page's link. Re-enabling
  issues a new token.
  - The page is read through `/api/public/:token` (rate limited), rendered at
    `/share/:token` with `noindex` (meta tag and `X-Robots-Tag`).
  - Content arrives with the editor in M3; M2 shows the title, icon, cover and subpages.
- **WebSocket**: `ws` (MIT) attached to the HTTP server's `upgrade` event at
  `/sync/ws`. It shares the server with `/collab` in M3 (ADR 0004).
- **Drag and drop** uses native HTML5 events on the flattened, virtualized tree (no
  dependency). "Move to" covers keyboard and touch.
- **Restricting a page keeps the restrictor's access**: when the person restricting
  would otherwise lose Full access, they get an explicit Full access grant on the page.
- **Member directory**: `member` entries are not delivered to guests (they cannot list
  members in M1 either), except their own entry.
- **Membership mutations** (`teamspace.*`, `member.*`) also lock the counter row first;
  that serializes them and replaces the M1 advisory locks for the "last owner" rules.
- **Partial client cache**: a mutation on an entity the client does not hold is queued
  without local effect; the server decides. A page just created is shown from the store
  until the server's read returns it.
- **Scoped reads** stay under `/api/workspaces/:id/...` and carry `seq`. Mutations and
  pull are under `/sync/` and use the same session guard and CSRF rules.
- **New dependencies** (licenses checked): `fractional-indexing` (CC0-1.0), `bullmq`
  (MIT), `ws` (MIT), `dexie` (Apache-2.0), `@tanstack/react-virtual` (MIT),
  `fake-indexeddb` (Apache-2.0, tests).

## Risks and open questions

- **Seq serialization** caps structured-write throughput per workspace. The benchmark
  measures it, and the result is recorded below.
- **Trash and purge of very large subtrees** run in one statement while holding the
  workspace counter lock. They are benchmarked; a chunked job like moves is the fallback.
- **The 100k-row database** of `db:seed:large` needs databases (M4). M2 seeds pages,
  trees and grants only.

## Summary (2026-11-22)

**Status: done, pending review.** All M2 boxes are ticked in `docs/ROADMAP.md`.

### What was built
- **Shared** (`packages/shared`): fractional positions (`fractional-indexing`, CC0), the
  page model, the permission evaluator (pure, exhaustive oracle test over 3,600
  combinations), the mutation catalog (zod) with one pure apply function per mutation,
  the sync protocol types.
- **Data model** (migration `0002`): pages, page_permissions, favorites, recents,
  page_follows, public_links, change_log, applied_mutations (ADR 0006).
- **Server**:
  - `sync`: `POST /sync/mutations` runs one transaction per mutation. It is idempotent
    (rejections included) and gives gap-free seqs, with the counter locked last (or first
    for structural and membership mutations). `GET /sync/pull` applies the ADR 0006
    delivery rules and answers `resync_required` when the cursor is too old. `/sync/ws`
    pokes go through Valkey and are coalesced per client (100 ms); kicks close sockets.
  - `permissions`: chains loaded through `path` and evaluated by the shared evaluator,
    cached in Valkey under `perm_epoch`. A large move keeps pre-move ancestry until the
    job ends.
  - `pages`: tree reads (children, teamspace roots, private, shared), page detail with
    breadcrumb, sharing (who and why), trash, favorites, recents (direct upsert), public
    links.
  - Mutation handlers for pages, favorites, follows, grants, restrict, owner recovery
    (logged), public links, and the workspace/teamspace/member writes. Their REST write
    routes are removed (ADR 0005). Each new workspace gets a default teamspace.
  - BullMQ jobs: large subtree move (chunked path rewrite), large duplicate, daily trash
    retention and change-log purge.
- **Client** (`packages/sync`): normalized store, optimistic apply with the shared
  functions, pending queue, rebase on pull, per-entity seq and tombstones, scope rules
  (known entities, listed parents, favorites), rejection and access events, Dexie
  persistence of pending writes, cursor and favorites, HTTP transport and a reconnecting
  poke socket.
- **Web**:
  - **Sidebar:** Favorites, Teamspaces, Shared and Private in one virtualized list, with
    lazy trees, native drag and drop, and "Move to".
  - **Page view:** title, icon, cover, width, font, lock, follow, duplicate, move, trash
    and restore, subpages, and recovery of access for owners.
  - **Share dialog:** who has access and why, grants, restrict, public link.
  - **Other screens:** the trash, the public page `/share/:token` (`noindex`), and the
    settings, which now write through mutations.
- **Seeds and bench:** `db:seed`, `db:seed:large` (1,111,040 pages, 22,220 grants, a
  40-deep chain, 83 s), and `apps/server/bench`.

### Tests
- 461 unit tests: 110 shared, 188 server, 22 sync, 63 web, plus i18n, db and scripts.
- 37 integration tests:
  - mutations, pull and pokes across 2 api nodes;
  - gap-free seqs under concurrent writers on both nodes;
  - WebSocket upgrade refusals;
  - permission filtering of pull;
  - small and large (job) subtree moves;
  - public links;
  - seeds.
- 14 e2e tests: *create nested pages, move them by drag and drop, share with another user
  who sees them live*, live renames both ways, trash and restore, plus the M1 journeys.

### Acceptance verification
- Full pipeline from `pnpm install --frozen-lockfile`: licenses (676), SPDX (288), lint,
  typecheck, unit, integration.
- `pnpm test:e2e` (Testcontainers stack): 14/14. The Docker image under
  `docker compose up` is healthy, and the same 14 e2e tests pass against it.
  `/share/*` sends `X-Robots-Tag: noindex`.
- **Benchmarks on the large seed**, run over HTTP against the production build with
  role=all.
  - Host: 32 vCPU Ryzen 9 5950X, 31 GB, WSL2. It is faster than the reference hardware
    (4 vCPU, 8 GB), so re-run on reference hardware before treating the margins as final.

| Operation | p50 | p95 | Budget (p95) |
|---|---|---|---|
| Sidebar level load, ≤100 children, cold permission cache | 7.4 ms | 8.6 ms | 100 ms |
| Sidebar level load, warm | 5.4 ms | 6.1 ms | 100 ms |
| Page metadata (open a page) | 6.7 ms | 7.6 ms | 300 ms |
| Mutation round-trip (`page.update`) | 11.6 ms | 14.0 ms | 150 ms |

- **Seq serialization** (renames, one workspace):

| Concurrent writers | Throughput | p50 | p95 |
|---|---|---|---|
| 1 | 77/s | 12.8 ms | 14.3 ms |
| 4 | 184/s | 21.0 ms | 26.1 ms |
| 16 | 184/s | 72.1 ms | 163.0 ms |
| 32 | 190/s | 155.3 ms | 254.6 ms |
| 32, split over 2 workspaces | 292/s | 106.0 ms | 138.2 ms |

  - Structured writes in one workspace level off at about 190/s, which is the expected
    cost of the per-workspace counter lock. Different workspaces do not contend.
  - Under 16+ concurrent writers to one workspace, single-mutation p95 goes above the
    150 ms budget.

### Deviations and decisions
- **ADRs:**
  - ADR 0006 (approved at the start): page roots, members-only teamspace access, strict
    maximum, delivery rules, lock placement, pull format, `/sync/ws`, catalog additions;
  - ADR 0007 (decided during M2): the ltree GiST index fails past about 51 levels, so
    nesting is capped at 40 (`too_deep`). PRODUCT now says "up to 40 levels".
- **Behaviour choices:**
  - Restricting a page grants Full access to the person restricting it, if they would
    otherwise lose it.
  - Guests do not receive `member` entries.
  - Membership mutations lock the counter first.
- **Bug fixed during e2e:** `hasChildren` was always false, because the subquery bound
  to the wrong table. Also, a just-created page is now shown from the store until the
  server has it.
- **Dependency pinning:** `@tanstack/react-virtual` is pinned to 3.14.26 to respect the
  minimum release age, and the optional native `msgpackr-extract` build is disabled.

### Known limitations
- **Not verified on Windows**, and **CI not run on GitHub**.
- **Benchmarks** come from a fast dev host, not reference hardware.
- **Trash and purge of very large subtrees** run in one statement under the counter lock.
  They were not benchmarked at 100k pages; the fallback is the chunked job used for
  moves.
- **Duplicate copies the tree, options and grants, not content.** Content duplication
  arrives with Yjs documents in M3.
- **The client store keeps loaded pages in memory** without LRU eviction. Only pending
  writes, the cursor, favorites and their ancestors persist (M5 extends the cached
  scope).
- **The "Shared" section** only shows the topmost pages within each fetched page of
  results.
- **Drag and drop** uses native HTML5 events, so it does not work on touch screens;
  "Move to" covers touch and keyboard.
- **Page content** (blocks) arrives with the editor in M3; the page view says so.
- **The Notion import (M8)** must handle trees deeper than 40 levels (ADR 0007).
