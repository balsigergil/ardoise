# M1 — Instance, authentication, workspaces: plan

Goal (ROADMAP M1): first-run setup, email + password auth with sessions and CSRF,
password reset by email, invitations (no sign-up), workspaces with roles, teamspaces,
the admin panel and user settings.

Decisions approved at the start of M1: ADR 0005 (session token hash, `password_resets`,
invitation revocation, encrypted setup token; REST writes until M2; closed-teamspace
join requests deferred to M6).

## Tasks

| # | Task | Tests |
|---|---|---|
| T1 | Docs: this plan, ADR 0005, ARCHITECTURE §4.1/4.2/§13, PRODUCT §4 | — |
| T2 | `packages/shared`: API contracts (zod), error codes, workspace/teamspace role rules, invitation lifecycle, session rules, password/email rules, instance settings schemas with defaults | unit |
| T3 | `packages/db`: schema for users, sessions, password_resets, invitations, instance_settings, workspaces, workspace_members, workspace_counters, teamspaces, teamspace_members; migration | integration (via server tests) |
| T4 | Server plumbing: token + hash helpers, AES-GCM secrets, cookies, domain errors → HTTP filter, zod pipe, session guard with CSRF and same-origin check, Valkey rate limiter, security headers + CSP (helmet) | unit |
| T5 | `auth` module: login, logout, current session, session list/revoke, password change, password reset request/confirm; `mail` module (nodemailer, i18n templates, settings from admin or env) | unit + integration |
| T6 | `admin` module: setup (logged URL or env bootstrap), instance settings (SMTP + test email, limits, invitations, workspace creation), users (list/search, invite, disable, delete, promote), workspaces (list with member count) | unit + integration |
| T7 | `workspaces` module: workspaces (create, rename, icon, list mine), members (list, role, remove, leave), workspace invitations, invitation preview/accept, teamspaces (CRUD, visibility, default level, join/leave, members) | unit + integration |
| T8 | Web: API client (TanStack Query), session context, setup, login, forgot/reset password, invitation accept | unit |
| T9 | Web: workspace switcher and creation, workspace settings (general, members, invitations, teamspaces), teamspaces in the sidebar | unit |
| T10 | Web: admin panel; user settings (profile, language, theme, password, sessions) | unit |
| T11 | E2E: *setup → invite → accept → login*; self-contained e2e stack (Testcontainers + built server) and CI update | e2e |
| T12 | Docs, ROADMAP boxes, summary | — |

## Choices made (spec ambiguities, simplest option)

- **Session**: cookie `ardoise_session` (httpOnly, SameSite=Lax, Secure on https)
  holding a 256-bit token; only its SHA-256 is stored. Absolute lifetime 90 days, idle
  timeout 30 days, `last_seen_at` refreshed at most every 5 minutes. Lookups are cached
  in Valkey for 60 s and evicted on revoke.
- **CSRF**: the token is an HMAC of the session id (no storage), returned by
  `GET /api/auth/session` and sent back in `X-CSRF-Token` on every state-changing
  request. Unauthenticated state-changing endpoints (login, setup, reset, accept) require
  a JSON body and an `Origin` matching `ARDOISE_PUBLIC_URL` when the browser sends one.
- **Passwords**: 12 to 256 characters (same minimum as `ARDOISE_ADMIN_PASSWORD`),
  argon2id with OWASP parameters (19 MiB, t=2, p=1) via `@node-rs/argon2`. Login with an
  unknown email still verifies a dummy hash, so timing does not reveal accounts.
- **One-time links** carry their token in the URL fragment (`/setup#…`, `/invite#…`,
  `/reset-password#…`). Reset links expire after 1 hour; invitations after the
  configured expiry (default 7 days).
- **Setup** creates the super-admin and the first workspace (its owner), then signs in.
- **Invitations**: inviting an email that already has a pending invitation for the same
  scope replaces it. The inviter always gets the link to copy, so instances without
  SMTP work. An existing account accepts a workspace invitation by signing in with the
  invited email. Accepting an instance invitation creates the account only.
- **Roles**: owners can assign any role; admins can assign admin, member or guest and
  cannot change or remove owners. A workspace always keeps at least one owner. Only
  owners and admins create teamspaces. A teamspace always keeps at least one owner.
  Workspace owners and admins see and manage every teamspace, including private ones.
- **Workspace creation**: any active user by default; an instance setting can restrict
  it to super-admins.
- **Admin safety**: a super-admin cannot disable, delete or demote themselves, and the
  last super-admin cannot be removed. A user who is the sole owner of a workspace cannot
  be deleted.
- **Emails** are sent within the request (with a timeout). Batching and retries come
  with notifications in M6. Without SMTP settings, email is disabled and the UI says so.
- **Data fetching** for REST screens uses TanStack Query (MIT). The sync store
  (M2) will own structured workspace data.
- **Icons** for workspaces and teamspaces are emoji in M1 (uploads arrive with `files`
  in M3). Avatars likewise wait for M3.

## Risks and open questions

- The e2e journey needs the full server: Playwright starts a stack with Testcontainers
  unless `E2E_BASE_URL` points at a running one (the setup URL is then read from
  `E2E_SETUP_URL`).
- Native argon2 bindings must exist for every target (prebuilt for linux x64/arm64
  glibc and musl, Windows and macOS).
