# 0001 — License allowlist additions and SPDX header scope

- Status: accepted
- Date: 2026-11-22
- Milestone: M0

## Context
CLAUDE.md §1.2 lists the allowed dependency licenses (MIT, ISC, BSD-2/3, Apache-2.0,
MPL-2.0, CC0, Unlicense, LGPL, GPL-3.0, AGPL-3.0) and requires a CI check against an
allowlist. Several ubiquitous transitive npm dependencies use other licenses that are
permissive and AGPL-compatible, so a strict check would fail on the first install:

- `0BSD` (tslib), `BlueOak-1.0.0` (glob, lru-cache, minimatch, ...),
  `CC-BY-4.0` (caniuse-lite, data only, pulled by browserslist / Vite / Tailwind),
  `CC-BY-3.0` (spdx-exceptions, data only), `Python-2.0` (argparse), `Zlib`.
- Canonical variants that permit the listed GPL family: `MIT-0` (MIT without attribution),
  `GPL-2.0-or-later` (may be used under GPL-3.0).

CLAUDE.md also requires an SPDX header in "every source file", which is not possible
for JSON and is ambiguous for generated files and for vendored MIT code (shadcn/ui).

## Options considered
1. Keep the list strict and replace every offending package: not feasible, they sit
   deep in the toolchain (Vite, ESLint, Tailwind).
2. Extend the allowlist with clearly permissive licenses: simple, legally sound.

## Decision
- The allowlist is extended with: `0BSD`, `BlueOak-1.0.0`, `CC-BY-3.0`, `CC-BY-4.0`, `MIT-0`,
  `GPL-2.0-or-later`, `LGPL-*-or-later`,
  `Python-2.0`, `Zlib`. `CC-BY-*` is accepted for data packages only.
- SPDX expressions: `A OR B` passes if any branch is allowed; `A AND B` passes if every
  part is allowed. Packages without a recognizable license fail.
- The check (`scripts/check-licenses.mjs`) reads `pnpm licenses list --json --recursive`
  (no extra dependency) and covers production and development dependencies alike.
  Explicit per-package exceptions live in `scripts/license-policy.json` with a reason.
- SPDX header scope (`scripts/check-spdx.mjs`): `.ts .tsx .js .mjs .cjs .css .sql`,
  `Dockerfile`. Excluded: JSON, Markdown, YAML, lockfiles, generated files (drizzle
  migration `meta/`, `routeTree.gen.ts`, build outputs). Drizzle SQL migrations get the
  header prepended (`-- SPDX-License-Identifier: AGPL-3.0-only`).
- shadcn/ui components copied into the repo keep our AGPL SPDX header; the upstream MIT
  copyright notice is reproduced in `THIRD_PARTY_NOTICES.md`.

## Consequences
- CLAUDE.md §1.2 refers to this ADR for the full allowlist.
- Adding a license to the allowlist still requires an ADR.
