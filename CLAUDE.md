# CLAUDE.md — Ardoise

Ardoise is a free and open-source (AGPL-3.0), self-hosted, collaborative workspace:
nested pages, a block editor, databases with views, real-time co-editing, comments,
version history, offline support (PWA), a public API, an MCP server and BYOK AI.
Its functional goal is feature parity with Notion, built as a **clean-room
implementation** (see below).

This file holds the rules that apply to every task. Read these before starting any work:

- `docs/PRODUCT.md`: what we build (functional specification, v1 vs later)
- `docs/ARCHITECTURE.md`: how we build it (components, data model, sync, scaling)
- `docs/ROADMAP.md`: in what order (milestones, acceptance criteria, progress)
- `docs/decisions/`: Architecture Decision Records (ADRs)

If these documents contradict each other, the order of precedence is:
this file > ARCHITECTURE.md > PRODUCT.md > ROADMAP.md. Report the contradiction and
fix it in the same change.

---

## 1. Non-negotiable rules

### 1.1 Clean-room implementation
Ardoise must never contain anything derived from Notion's proprietary material.

**Allowed sources**
- This repository's specifications (`docs/`)
- Notion's **public end-user documentation**, read to understand *behavior* only
- Publicly observable behavior, described in your own words
- General software engineering knowledge, open standards and libraries with compatible licenses

**Forbidden, without exception**
- Reading, copying, translating or paraphrasing Notion source code, including the
  minified or bundled JavaScript served to browsers or apps
- Reverse-engineering Notion's private/internal APIs or network traffic
- Reusing Notion's names for internal concepts as identifiers when they are not
  generic words, or copying its UI copy, icons, illustrations, fonts, templates,
  colors, logos or any brand asset
- Using the word "Notion" anywhere in the product UI, except for the nominative
  "Import from Notion" feature
- Copying code from projects with licenses that are not compatible with AGPL-3.0, or
  that are not open source (for example: AFFiNE's Enterprise Edition backend,
  Outline under BSL, Anytype under ASAL)

If a task seems to require any forbidden source, stop and write down why in the task
output instead of proceeding.

### 1.2 Licensing
- The project is **AGPL-3.0-only**. Every source file starts with an SPDX header:
  `// SPDX-License-Identifier: AGPL-3.0-only`.
- **There is no open core.** No feature flags tied to editions, no license keys, no
  "enterprise" modules, no artificial limits. Every feature ships to every instance.
- Dependencies must use AGPL-compatible licenses: MIT, ISC, BSD-2/3, Apache-2.0,
  MPL-2.0, CC0, Unlicense, LGPL, GPL-3.0 and AGPL-3.0.
  Forbidden: proprietary, BSL/BUSL, SSPL, Elastic, Commons Clause, FSL,
  non-commercial and "source-available" licenses.
- **Tiptap**: only the MIT-licensed open-source packages. Never use Tiptap Pro or
  paid extensions, Tiptap Cloud, or any package that needs a private registry or token.
- The full allowlist (including `0BSD`, `BlueOak-1.0.0`, `Zlib`, `Python-2.0` and
  data-only `CC-BY-*`) and the SPDX header scope are defined in ADR 0001.
- CI runs a license check against an allowlist. Adding a dependency that fails the
  check is a blocking error.

### 1.3 Performance is a feature
Large workspaces (hundreds of thousands of pages, databases with 100k+ rows) must stay
fast. Never load an unbounded collection, either on the client or in a single query.
Paginate, lazy-load and virtualize. Respect the performance budgets in
`ARCHITECTURE.md` §12.

### 1.4 Tests
Unit tests are the priority. Every change that adds or changes logic ships with unit
tests. Integration and e2e tests are required where `ROADMAP.md` says so.

---

## 2. Stack (do not change without an ADR)

| Area | Choice |
|---|---|
| Language | TypeScript (strict) everywhere, current Node.js LTS |
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS |
| DB | PostgreSQL (+ `ltree`, `pg_trgm`, `unaccent`) via Drizzle ORM and drizzle-kit migrations |
| Cache, pub/sub, jobs | Valkey + BullMQ |
| Object storage | S3 API (RustFS in the default deployment) |
| Real-time collaboration | Yjs + Hocuspocus (server and provider) |
| Frontend | React SPA, Vite, TanStack Router |
| Editor | Tiptap (MIT packages only) / ProseMirror, `y-prosemirror` |
| UI | shadcn/ui (as is), Tailwind CSS, Radix, lucide icons |
| Client persistence | IndexedDB via Dexie, `y-indexeddb` |
| PWA | `vite-plugin-pwa` (Workbox) |
| i18n | i18next / react-i18next (UI: `fr`, `en`) |
| Validation and contracts | zod schemas shared in `packages/shared` |
| Markdown | unified / remark (GFM) |
| Tests | Vitest (unit), Vitest + Testcontainers (integration), Playwright (e2e) |
| Lint/format | ESLint + Prettier |

## 3. Repository layout

```
apps/
  server/        NestJS: one codebase, several process roles (api | collab | worker | all)
  web/           React SPA + PWA
packages/
  shared/        zod schemas, domain types, mutation definitions, permission logic
  db/            Drizzle schema, migrations, seed scripts (incl. large-workspace seed)
  sync/          isomorphic sync core: client store, mutation queue, rebase
  editor/        Tiptap extensions, node views, editor schema
  markdown/      editor JSON <-> Markdown conversion
  i18n/          locale files (fr, en) and helpers
  config/        shared tsconfig / eslint / prettier presets
docker/          Dockerfile (single image), docker-compose.yml
e2e/             Playwright tests
docs/            PRODUCT, ARCHITECTURE, ROADMAP, decisions/ (ADRs)
```

## 4. Conventions

- **Language**: code, comments, commit messages and docs are in English. The UI is
  localized in French and English. Never hardcode a user-facing string: every string
  goes through i18n keys, and both `fr` and `en` are complete.
- **IDs**: UUIDv7 everywhere, and they may be generated on the client (required for offline creation).
- **Multi-tenancy**: every workspace-scoped table has `workspace_id` as the first
  column of its primary key and of its main indexes (see ARCHITECTURE §4).
- **Structured writes** go through the mutation pipeline (ARCHITECTURE §6), never
  through ad-hoc REST updates. Page content goes through Yjs only.
- **Ordering**: use fractional indexing (string keys) for siblings, never integer positions.
- **Backend structure**: NestJS modules by domain (`auth`, `admin`, `workspaces`,
  `pages`, `permissions`, `sync`, `collab`, `databases`, `files`, `projection`, `search`,
  `comments`, `notifications`, `history`, `templates`, `import-export`, `ai`,
  `api-public`, `mcp`, `mail`), as listed in ARCHITECTURE §3. Keep domain logic
  in plain TypeScript services that can be unit tested without NestJS or a database. Put
  persistence behind repository interfaces.
- **Errors**: typed domain errors that map to stable API error codes. Never leak stack
  traces to clients.
- **Security**: hash passwords with argon2id; use httpOnly SameSite cookies with CSRF
  protection for web sessions; check permissions on every read and write on the server;
  encrypt secrets (AI keys, SMTP password) at rest with `ARDOISE_SECRET_KEY`.
- **Cross-platform dev**: the maintainer develops on Windows 11. `package.json`
  scripts must be cross-platform (no bash-only syntax; use Node scripts when needed).
  Docker Compose is the reference dev environment.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

## 5. Testing rules

- **Unit (priority)**: Vitest. Required for all domain logic: permissions and
  inheritance, mutation validation/apply/rebase, conflict resolution, view
  filter/sort/group compilation, Markdown conversion, Yjs-to-block projection,
  fractional indexing use, import parsing, i18n completeness.
- **Integration**: Vitest + Testcontainers (Postgres, Valkey, RustFS) against the
  NestJS app. Required for new endpoints, the sync pull/push protocol, Hocuspocus
  persistence and authorization, and file storage.
- **E2E**: Playwright, only for critical journeys (listed in ROADMAP).
- Tests must be deterministic: no real network calls, mocked AI providers and fixed clocks.

## 6. Definition of done (every task)

1. `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, plus integration/e2e when relevant.
2. New logic is covered by unit tests.
3. UI strings exist in both `fr` and `en`.
4. Server-side permission checks exist for every new read/write path.
5. No unbounded queries or lists; performance budgets respected.
6. The license check passes and SPDX headers are present.
7. Docs are updated: ARCHITECTURE when design changed, PRODUCT when behavior changed,
   and the ROADMAP checkboxes ticked.
8. Any deviation from these documents has an ADR in `docs/decisions/NNNN-title.md`
   (context, decision, consequences).

## 7. How to work

- Work **milestone by milestone** in ROADMAP order. Do not start a milestone before
  the previous one meets its acceptance criteria.
- At the start of a milestone, write `docs/milestones/Mx-plan.md`: a breakdown into
  small tasks, open questions and risks. Then execute it task by task, committing often.
- Prefer small, reviewable changes. Keep `main` green.
- When the spec is ambiguous, choose the simplest option consistent with PRODUCT.md,
  record it in the milestone plan, and continue. Stop and ask only for decisions
  that are hard to reverse, such as the data model, the sync protocol or a license question.
- At the end of a milestone, write a short summary in the milestone plan: what was
  done, deviations, known limitations. Then stop for review.

## 8. Commands (keep this section up to date)

```
pnpm install                     # Node 26 + pnpm 12 (ADR 0002)
pnpm dev                         # docker compose deps + server (role=all, :3100) + web (:5173)
pnpm dev:down                    # stop the dev dependencies
pnpm typecheck | lint | test | test:integration | test:e2e
pnpm check:licenses | check:spdx
pnpm build
pnpm db:migrate | db:generate    # db:seed and db:seed:large arrive in M2
docker compose -f docker/docker-compose.yml up   # needs docker/.env (see .env.example)
```
