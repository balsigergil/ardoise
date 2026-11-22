# 0004 — File delivery, collab routing and public link tokens

- Status: accepted
- Date: 2026-11-22
- Milestone: M0 (design), implemented in M2/M3

## Context
- ARCHITECTURE §4.7 serves downloads with presigned S3 URLs. In the default compose
  deployment the S3 store (RustFS) is not reachable from browsers, and a strict CSP plus
  the single public origin (§2) make a second origin undesirable.
- §2 says `/collab` is "proxied to collab role" without saying by whom.
- §4.3 stores `public_links.token` in clear, contradicting §13 (tokens hashed at rest),
  while the share menu must be able to show the link again.

## Decision
- **Files**: `GET /files/:id` checks permission, then by default **streams** the object
  from S3 through the API (range requests supported). If `S3_PUBLIC_URL` is set, the API
  instead redirects (302) to a short-lived presigned URL on that public endpoint.
- **Collab routing**: with `role=all`, Hocuspocus is attached in-process to the same
  HTTP server at `/collab`. With split roles, the reverse proxy routes `/collab` to the
  collab nodes; the `api` process never proxies WebSockets. Examples document this.
- **Public links**: `public_links` stores `token_hash` (HMAC-SHA-256 with a key derived
  from `ARDOISE_SECRET_KEY`) for lookup and `token_encrypted` (AES-256-GCM) so the
  share menu can display it again.
- **Secret key rotation** is a known limitation for v1; a re-encryption command is
  planned.

## Consequences
- New optional env var `S3_PUBLIC_URL`; ARCHITECTURE §2, §4.3 and §4.7 are updated.
