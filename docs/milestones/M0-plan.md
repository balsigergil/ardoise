# M0 — Foundations: plan

Goal (ROADMAP M0): a monorepo, a bootable server with roles, health and migrations, a
web app shell (fr/en, light/dark/system), Docker image + compose, test infrastructure
and CI.

Pre-M0 review decisions: ADR 0001 (license allowlist, SPDX scope), 0002 (Node 26,
pnpm 12, TS 6.0, PG 17, ltree labels), 0003 (sync/data model amendments, from M2),
0004 (file delivery, collab routing, public link tokens).

## Tasks

| # | Task | Tests |
|---|---|---|
| T1 | Root tooling: pnpm workspace, Turborepo, `packages/config` (tsconfig, ESLint flat config, Prettier), `.nvmrc`, `.gitattributes` (LF), `.editorconfig` | lint/typecheck run |
| T2 | `scripts/check-licenses.mjs` + `scripts/check-spdx.mjs` (logic in `scripts/lib`, pure) | unit: SPDX expression evaluation, header detection, path scope |
| T3 | `packages/shared`: UUIDv7 ids, ltree label helpers | unit |
| T4 | `packages/i18n`: `fr`/`en` JSON locales, resources export, language detection helper | unit: key completeness, no empty values, detection |
| T5 | `packages/db`: Drizzle config, first migration (extensions), `migrate()` with advisory lock | integration (Testcontainers Postgres): extensions exist, concurrent migrate is safe |
| T6 | `apps/server`: NestJS app, zod env config, role → modules, pino, `/healthz`, `/readyz` (DB, Valkey, S3), migrate on boot, `ardoise migrate` command, S3 bucket bootstrap, SPA static serving | unit: config, roles, readiness aggregation, SPA fallback rule. Integration: boot with containers, `/healthz`, `/readyz` |
| T7 | `apps/web`: Vite + React + TanStack Router + Tailwind + shadcn/ui; app shell (sidebar sections + main), theme light/dark/system, language fr/en | unit: theme resolution, shell renders in both languages |
| T8 | `docker/Dockerfile` (multi-stage, single image) + `docker/docker-compose.yml` (ardoise, postgres, valkey, rustfs) with health checks | manual: `docker compose up`, `/readyz` green |
| T9 | Test infrastructure: root Vitest projects, Testcontainers helpers, Playwright project with a smoke test | e2e: shell visible, language and theme switch |
| T10 | GitHub Actions CI: lint, typecheck, unit, license, SPDX (push); integration (PR + main); e2e + image build (main) | — |
| T11 | `README.md`, `LICENSE`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`; `pnpm dev` (Node script: compose deps + server + web); CLAUDE.md §8 | manual: `pnpm dev` on Linux |

## Choices made (spec ambiguities, simplest option)

- **ESM everywhere.** NestJS 12 ships as ESM. Internal packages resolve to `src/*.ts`
  under the `development` condition (dev, tests, typecheck) and to `dist/` otherwise.
- **Explicit DI tokens**: Nest providers are injected with `@Inject(Token)`, never by
  reflected constructor types. That makes the server work under tsx/esbuild (dev) and
  Vitest without decorator metadata emission. `tsc` builds production output.
- **All roles serve HTTP** for `/healthz` and `/readyz`, so every container has health
  checks. Only `api`/`all` serve the SPA.
- **S3 bucket** is created at boot if missing (by the process that runs migrations).
- **Migrations on boot** are on by default (`ARDOISE_MIGRATE_ON_BOOT=false` disables them).
- **Routing** is code-based in M0 (no generated route tree).
- **Testcontainers helpers** live in `apps/server/test/`; the migration integration test
  lives there too, since migrate-on-boot is server behavior.
- **Playwright smoke test** runs against the built web app (`vite preview`) by default,
  or against any `E2E_BASE_URL` (for example the compose stack).

## Risks and open questions

- Node 26 / pnpm 12 / NestJS 12 / Vite 8 are recent; there may be ecosystem friction
  (peer ranges). We will pin exact versions and note any workaround.
- Playwright browsers need system libraries; on CI we use `--with-deps`.
- I can verify on Linux (WSL) only: Windows `pnpm dev` must be checked by the maintainer.
- CI can only be checked green once the repository is pushed to GitHub.

## Summary (2026-11-22)

**Status: done, pending review.** All M0 boxes are ticked in `docs/ROADMAP.md`.

### What was built
- **Monorepo**: pnpm 12 workspaces + Turborepo; strict TypeScript 6.0; ESLint 10
  (type-aware) + Prettier; shared presets in `packages/config`. Packages `shared` (UUIDv7,
  ltree labels), `i18n` (fr/en), `db` (Drizzle, extensions migration, migrator with an
  advisory lock); `sync`, `editor`, `markdown` are stubs for later milestones.
- **Server** (`apps/server`): NestJS 12 (ESM), zod-validated env config (errors name
  variables, never values; empty strings count as unset), roles `all|api|collab|worker`,
  pino JSON logs with credential redaction, `/healthz`, `/readyz` (Postgres, Valkey, S3 in
  parallel with timeouts; failures logged, details hidden from clients), migrations on boot,
  `ardoise migrate`, S3 bucket creation, SPA serving with client-route fallback and cache
  headers. Collab and worker modules are placeholders.
- **Web** (`apps/web`): Vite 8, React 19, TanStack Router, Tailwind 4, shadcn/ui. App shell
  with the four sidebar sections and footer entries (PRODUCT §4), light/dark/system theme
  (stored, follows OS changes, no flash), fr/en with browser detection and persistence,
  localized not-found page.
- **Docker**: one multi-stage image (`node:26.13.1-trixie-slim`, non-root, 292 MB, health
  check, `ardoise` entrypoint), reference compose (ardoise, postgres 17, valkey 9, rustfs)
  with health checks, and a dev overlay.
- **Tests**: 149 unit tests (Vitest projects), 10 integration tests (Testcontainers:
  boot, readiness, migrations on boot, concurrent migrations, every role, 503 path),
  6 Playwright e2e tests (languages, themes, routing).
- **CI** (`.github/workflows/ci.yml`): checks on every push, integration on PRs and
  main, then on main the image build plus e2e against the running compose stack.
- **Docs**: README, CONTRIBUTING, LICENSE (AGPL-3.0 text), THIRD_PARTY_NOTICES,
  ADRs 0001–0004, CLAUDE.md §8.

### Acceptance verification
- `docker compose up` (on Linux/WSL): all four containers healthy. `/readyz` reports
  every check ok. The shell renders in English and French, and in light and dark themes
  (checked with screenshots and with the e2e suite run against the stack). `ardoise migrate`
  works inside the container.
- `pnpm dev` on Linux: deps start, the server migrates and serves, and Vite proxies to it.
- Full pipeline from a clean `pnpm install --frozen-lockfile`: licenses (649 package
  versions), SPDX, lint, typecheck, unit, integration and e2e all pass locally.

### Deviations and decisions
- ADRs 0001–0004 (approved before M0). TypeScript stays on 6.0 because typescript-eslint
  does not support 7.x yet (ADR 0002).
- `pnpm dev` uses non-default host ports (server 3100, Postgres 15432, Valkey 16379,
  RustFS 19000) and a separate compose project (`ardoise-dev`), so it can run next to
  other local stacks and never shares volumes with a production-like compose.
- Prettier does not format Markdown, so hand-written docs are left untouched.
- shadcn components are used as they are, except that their four built-in English
  strings go through i18n, and `use-mobile` was rewritten to satisfy the React hooks
  lint rules.
- pnpm `allowBuilds`: esbuild is allowed; the optional native builds pulled by
  Testcontainers (ssh2, cpu-features, protobufjs) are denied.

### Known limitations
- **Not verified on Windows**: `pnpm dev` and the scripts are written cross-platform
  (Node scripts, no shell syntax), but the maintainer needs to run them on Windows 11.
- **CI not run on GitHub yet**: the repository has no remote. The same steps pass locally.
- No security headers or CSP yet. They are planned with auth in M1 (ARCHITECTURE §13).
- Benchmarks: none apply to M0 (budgets start in M2).
