# 0002 — Runtime and toolchain versions, ltree label encoding

- Status: accepted
- Date: 2026-11-22
- Milestone: M0

## Context
CLAUDE.md says "current Node.js LTS" and TypeScript strict, without pinning versions.
`pages.path` is an `ltree` of page ids. UUIDs contain hyphens, which `ltree` labels
only accept from PostgreSQL 16.

## Decision
- **Node.js 26 LTS** (`.nvmrc`, `engines.node >= 26`, `node:26` base image). Node 26
  no longer bundles corepack, so pnpm is installed explicitly (`npm i -g pnpm`) and
  pinned through `packageManager`.
- **pnpm 12**, Turborepo 2.
- **TypeScript 6.0.x**, not 7.x: `typescript-eslint` (needed for type-aware linting)
  supports `typescript < 6.1` at the time of writing. Revisit when it supports 7.
- **PostgreSQL 17** in compose, CI and Testcontainers.
- **ltree labels** are page ids encoded as 32 lowercase hex characters (UUID without
  hyphens), so the format does not depend on the PostgreSQL version. Helpers
  `uuidToLabel` / `labelToUuid` live in `packages/shared`.

## Consequences
- Contributors need Node 26 and pnpm 12 (documented in README / CONTRIBUTING).
- A future TS 7 migration is a separate change.
