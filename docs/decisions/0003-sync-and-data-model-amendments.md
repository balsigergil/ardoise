# 0003 — Sync protocol and data model amendments

- Status: accepted (approved by the maintainer before M0)
- Date: 2026-11-22
- Milestone: M0 (design), implemented from M2 onwards

## Context
A review of ARCHITECTURE.md before M0 found gaps in the data model and sync protocol
that would block or degrade M2–M6. Each item below was approved by the maintainer.

## Decision
1. **Idempotency table**: `applied_mutations (workspace_id, id, actor_id, result jsonb,
   created_at)`, PK `(workspace_id, id)`, purged with the change-log horizon. It also
   records rejected mutations and mutations that produce no change-log entry.
2. **`page_permissions`** is part of the data model (§4.3), not only of §9.
3. **User-private change-log entries**: `change_log.user_id` (nullable). When set, the
   entry is delivered only to that user (favorites, per-user state), regardless of
   `page_id`.
4. **`recent.touch` bypasses the workspace sequence**: it is a direct upsert on
   `recents` with no `seq` and no change-log entry, so page visits never contend on
   `workspace_counters`. Clients read recents through a per-user endpoint. It stays on
   the offline whitelist (replayed as an upsert).
5. **Large subtree moves**: only the moved root produces a change-log entry; `path` is
   server-only and clients derive ancestry from `parent_id`. Subtrees above a threshold
   are rewritten in chunks by a job, outside the counter lock. `pages.move_state`
   (nullable: `moving`) marks the subtree; while set, further moves into or out of the
   subtree are rejected and permission evaluation uses the pre-move ancestry.
6. **Access change entries**: grant, revoke, restrict, membership and role changes
   append `access` change-log entries targeted to affected principals
   (`entity_type=access`). Clients react by refetching (grant) or evicting (revoke) the
   affected scope.
7. **Restrict inheritance**: when the ancestor walk hits a page with
   `restrict_inheritance=true`, root rules (teamspace default level, workspace
   membership) are **not** applied. Workspace owner recovery is an explicit, logged
   "Recover access" action that creates a grant; it is never implicit access.
8. **Child pages**: the tree (`pages.parent_id`, `position`) is authoritative for the
   existence of a child page; the child-page block in the content is a view of it.
   Deleting the block trashes the page; projection repairs orphans. Sidebar order is
   `pages.position`, independent of block order in the content.
9. **Inline databases**: `pages(kind=database, is_inline=true)` under the host page,
   hidden from the sidebar tree; deleting the block trashes the database.
10. **Offline-created pages**: the client pushes pending mutations before connecting a
    Hocuspocus provider for a page created offline.
11. **Last write wins** for properties uses server arrival order; client clocks are
    never trusted.

## Consequences
- ARCHITECTURE §4, §6, §7, §9 and PRODUCT §15 are updated accordingly.
- Items 1–7, 10, 11 are implemented in M2/M5; items 8–9 in M3/M4.
