# 0005 — Authentication data model, and REST writes before the mutation pipeline

- Status: accepted (approved by the maintainer at the start of M1)
- Date: 2026-11-22
- Milestone: M1

## Context
M1 builds accounts, sessions, invitations, password reset, workspaces and teamspaces.
ARCHITECTURE §4.1/4.2 leaves gaps that block a secure implementation:

- `sessions` has no secret. The cookie must carry an unguessable token, and tokens are
  hashed at rest (§13). A UUIDv7 id is not secret and is shown in the session list.
- Password reset has no storage.
- `invitations` cannot record a revocation, and lists need a creation date.
- The first-run setup token must be printable by every `api` node, not only the one
  that created it.

CLAUDE.md §4 also says structured writes go through the mutation pipeline, but that
pipeline (`/sync/mutations`, change log, `applied_mutations`) is built in M2, while
M1 must already manage workspaces, teamspaces and members.

## Options considered
1. Store reset tokens in Valkey with a TTL: no table, but tokens vanish if Valkey restarts.
2. Add a small `password_resets` table: durable, auditable, purged by expiry.
3. Pull a minimal mutation pipeline into M1: decides part of M2 early and grows M1.
4. REST writes in M1 on framework-free services, converted to mutations in M2.

## Decision
Options 2 and 4.

**Data model additions** (ARCHITECTURE §4.1/4.2 updated):
- `sessions`: `token_hash` (SHA-256 of a 256-bit random token, unique) and `expires_at`
  (absolute lifetime). The idle timeout is computed from `last_seen_at`.
- `password_resets (id, user_id, token_hash, created_at, expires_at, used_at)`.
- `invitations`: `created_at`, `revoked_at`. `role` is null for instance invitations.
- `workspace_members.created_at`, `teamspaces.created_at`, `teamspace_members.created_at`.
- The setup token is stored **encrypted** (AES-256-GCM, key derived from
  `ARDOISE_SECRET_KEY`) in `instance_settings` under `setup`, so every node can print
  the same URL. It is deleted once setup completes.
- Emails are stored lowercased and trimmed; `users.email` is unique.
- Cross-workspace lookup exception: `workspace_members` has an index on
  `(user_id, workspace_id)` to list a user's workspaces. It is the only index that does
  not start with `workspace_id`; under sharding this table becomes a reference table or
  gets a per-user mirror.

**Writes in M1**: workspace, member, invitation and teamspace writes are REST endpoints
over framework-free services with unit-tested rules. In M2, the workspace-scoped writes
(`workspace.update`, `teamspace.*`, `member.*`) become mutations calling the same
services, and their REST write routes are removed. Workspace creation and
instance-level operations (setup, admin, auth, invitations acceptance) stay REST.

**Closed teamspaces**: in M1 they are visible to workspace members, who are added by a
teamspace owner or a workspace owner/admin. "Request to join" ships in M6 with
notifications.

## Consequences
- ARCHITECTURE §4.1, §4.2 and §13 and PRODUCT §4 are updated.
- M2 must migrate the M1 workspace-scoped REST writes to mutations (listed in M2 plan).
