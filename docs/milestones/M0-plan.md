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
