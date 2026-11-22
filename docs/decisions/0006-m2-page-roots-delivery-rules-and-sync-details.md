# 0006 — Page roots, change-log delivery rules and sync protocol details

- Status: accepted (approved by the maintainer at the start of M2)
- Date: 2026-11-22
- Milestone: M2

## Context
M2 builds the mutation pipeline, the change log, pull and pokes, the page tree and
permissions. ARCHITECTURE §4.3, §6, §7 and §9 leave several points open:

- `pages.parent_kind` allows `workspace`, but the sidebar (PRODUCT §4) has no
  workspace-level section, and a new workspace has no teamspace.
- The base access to teamspace pages for non-members is not defined.
- A `no_access` grant has no effect under the "maximum of matching grants" rule.
- `public_links` has no primary key; `page_permissions` records no author.
- Pull filtering is only defined for page-governed entries, while M2 also logs
  workspaces, members and teamspaces.
- Where the counter row is locked in a mutation transaction decides how long
  structured writes of one workspace are serialized.
- The pull response, its resync signal and how clients reconcile scoped reads with
  the log are not specified.

## Decision
1. **Page roots**: top-level pages hang off a teamspace (`parent_kind=teamspace`) or a
   user's private section (`parent_kind=private`, `parent_id=<user id>`). No page is
   created at the workspace root. Creating a workspace also creates one open teamspace
   with the workspace's name, owned by its creator. A restored page whose parent is gone
   or still in the trash goes to the root of its original teamspace, or to the
   restorer's private section when that teamspace is not reachable.
2. **Teamspace base access**: teamspace members get the teamspace `default_level`;
   teamspace owners get Full access. Nobody else gets base access, including workspace
   owners and admins (they can join or be added, and owners keep the explicit "Recover
   access" action). Guests get explicit grants only.
3. **Strict maximum**: effective access is the maximum of the matching grants and root
   rules (§9 as written). `no_access` is not a grantable level; removing a principal
   deletes its grant, and restricting inheritance is how a subpage excludes people.
4. **Data model additions**:
   - `public_links (workspace_id, id, page_id, token_hash, token_encrypted,
     include_subpages, created_by, created_at, revoked_at)`, PK `(workspace_id, id)`, at
     most one non-revoked link per page;
   - `page_permissions.created_by`, `page_permissions.created_at`.
5. **Pull delivery rules**, per `entity_type`:
   - entries with `user_id` go to that user only;
   - page-governed entries (`page_id` set) go to users who can view that page now;
     `delete` entries of pages carry no data and are not filtered;
   - `workspace` and `member` entries go to every workspace member;
   - `teamspace` and `teamspace_member` entries go to members who can see the
     teamspace (`canSeeTeamspace`);
   - `access` entries carry only ids and go to every workspace member, whose client
     refetches or evicts the affected scope.
6. **Counter lock placement**: the `workspace_counters` row is updated at the end of
   the mutation transaction, so the serialized section is short. Structural page
   mutations (create, move, trash, restore, purge, duplicate) lock it first instead, so
   cycle and parent checks see a stable tree.
7. **Pull and reconciliation**:
   - `GET /sync/pull` returns `{ entries, cursor, hasMore }`, at most 1000 entries per
     call; the cursor advances past filtered entries;
   - it fails with `resync_required` when `since` is older than the retained log;
   - scoped reads return the `seq` they were read at; clients keep a per-entity seq and
     ignore data older than what they hold.
8. **`/sync/ws`** authenticates the WebSocket upgrade with the session cookie and an
   `Origin` check, and only sends pokes (`{type:'poke', seq}`) from server to client.
   Sockets close when the session ends or the membership is removed.
9. **Catalog additions**: `follow.add/remove` (user-private entries),
   `permission.recover` (explicit, logged owner recovery) and `publicLink.set`
   (enable/disable with options; the token is generated server-side and read back
   through the share endpoint). Recents use a per-user REST endpoint (ADR 0003).

## Consequences
- ARCHITECTURE §4.3, §6, §7 and §9 and PRODUCT §4, §5 and §13 are updated.
- Workspace creation (still REST, ADR 0005) creates the default teamspace.
