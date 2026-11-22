# Ardoise

Ardoise is a free and open-source (AGPL-3.0), self-hosted collaborative workspace:
nested pages, a block editor, databases with views, real-time co-editing, comments,
version history, offline support, a public API, an MCP server and bring-your-own-key AI.
Every feature ships to every instance: there is no paid edition.

> Status: early development. Milestone M0 (foundations) is done; see
> [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start (Docker Compose)

Requirements: Docker with Compose v2.

```sh
cp docker/.env.example docker/.env   # then set the secrets in docker/.env
docker compose -f docker/docker-compose.yml up -d --wait
```

Open <http://localhost:3000>. The stack runs one Ardoise container (`ARDOISE_ROLE=all`),
PostgreSQL, Valkey and RustFS (S3 storage). Migrations run automatically at startup.

- Liveness: `GET /healthz`. Readiness (database, Valkey, S3): `GET /readyz`.
- Run migrations explicitly: `docker compose -f docker/docker-compose.yml exec ardoise ardoise migrate`.
- Put a reverse proxy (Caddy, Traefik...) in front for HTTPS. With split roles, route
  `/collab` to the collab containers (ADR 0004).

## Development

Requirements: Node.js 26 (see `.nvmrc`), pnpm 12 (`npm install -g pnpm@12`), Docker.

```sh
pnpm install
pnpm dev          # Postgres/Valkey/RustFS in Docker, server on :3100, web on :5173
pnpm dev:down     # stop the dev dependencies
```

Dev ports avoid the usual defaults so Ardoise can run next to other stacks; override them
with `ARDOISE_DEV_SERVER_PORT`, `ARDOISE_DEV_WEB_PORT`, `ARDOISE_DEV_POSTGRES_PORT`,
`ARDOISE_DEV_VALKEY_PORT` and `ARDOISE_DEV_S3_PORT`.

| Command | What it does |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | TypeScript, ESLint + Prettier, unit tests |
| `pnpm test:integration` | Testcontainers (Postgres, Valkey, RustFS) + the server in-process |
| `pnpm test:e2e` | Playwright (needs `pnpm --filter @ardoise/e2e exec playwright install chromium`) |
| `pnpm check:licenses` / `pnpm check:spdx` | Dependency license allowlist, SPDX headers |
| `pnpm build` | Build every package and app |

See [CONTRIBUTING.md](CONTRIBUTING.md) and the documents in [docs/](docs/).

## License

[AGPL-3.0-only](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
