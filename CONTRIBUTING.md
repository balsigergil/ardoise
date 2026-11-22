# Contributing to Ardoise

Thank you for helping. Please read [CLAUDE.md](CLAUDE.md) first: it holds the binding
rules for every change (clean-room implementation, licensing, stack, conventions, tests,
definition of done).

## Clean-room rule

Ardoise reimplements publicly observable behavior in its own words. Never read, copy or
paraphrase Notion's source code (including the JavaScript served to browsers), private
APIs, network traffic, UI copy, icons, illustrations or any brand asset. Use only this
repository's specifications, Notion's public end-user documentation (for behavior only),
and open-source code under compatible licenses.

## Workflow

- Work happens milestone by milestone (`docs/ROADMAP.md`), each with a plan in
  `docs/milestones/`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`).
- Deviations from `docs/ARCHITECTURE.md` need an ADR in `docs/decisions/`
  (copy `0000-template.md`).

## Before opening a pull request

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm check:licenses && pnpm check:spdx
pnpm test:integration   # when you touch the server or the database
```

- New logic comes with unit tests.
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`
  (scope in ADR 0001).
- Every UI string goes through i18n, in both `fr` and `en`
  (`packages/i18n/src/locales`). A test enforces identical keys.
- New dependencies must pass the license allowlist (`scripts/license-policy.json`).
  Tiptap: MIT packages only.

## Conventions worth knowing

- **ESM everywhere.** Internal packages resolve to `src/` through the `development`
  export condition (dev, tests, typecheck) and to `dist/` in production.
- **Explicit DI tokens in NestJS**: inject with `@Inject(Token)`; constructor parameter
  types are not reflected.
- **Domain logic is plain TypeScript**, unit tested without NestJS or a database.
- **Line endings are LF** (`.gitattributes`); this matters on Windows.

By contributing you agree that your contributions are licensed under AGPL-3.0-only.
