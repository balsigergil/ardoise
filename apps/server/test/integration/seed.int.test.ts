// SPDX-License-Identifier: AGPL-3.0-only
/** Seeds: demo and (scaled-down) large workspace produce a valid tree the API can read. */
import { runMigrations, seedDemo, seedLarge } from '@ardoise/db';
import { isUuidV7 } from '@ardoise/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../containers.js';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let postgres: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  postgres = await startPostgres();
  await runMigrations({ connectionString: postgres.getConnectionUri() });
  pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
  await pool.query(
    "INSERT INTO users (id, email, name, password_hash, is_super_admin) VALUES ('0190a000-0000-7000-8000-000000000001', 'root@example.test', 'Root', 'x', true)",
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await postgres?.stop();
});

describe('seeds', () => {
  it('seeds a demo workspace for the first super-admin', async () => {
    const report = await seedDemo(pool);
    // 2 teamspaces × 5 roots + 3 private, then ×4 and ×3 below.
    expect(report.pages).toBe(13 + 13 * 4 + 13 * 4 * 3);
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'",
      [report.workspaceId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('seeds a large workspace with consistent paths, UUIDv7 ids, grants and a deep chain', async () => {
    const report = await seedLarge(pool, 'root@example.test', {
      teamspaces: 2,
      roots: 5,
      fanout: [3, 3],
      deepChain: 30,
      grantEvery: 7,
      members: 3,
    });
    expect(report.pages).toBe(2 * 5 * (1 + 3 + 9) + 30);
    expect(report.grants).toBe(Math.floor(report.pages / 7));
    const bad = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pages c LEFT JOIN pages p ON p.workspace_id = c.workspace_id AND p.id = c.parent_id
       WHERE c.workspace_id = $1 AND (
         (c.parent_kind = 'page' AND (p.id IS NULL OR c.path <> p.path || replace(c.id::text, '-', '')::ltree))
         OR (c.parent_kind <> 'page' AND nlevel(c.path) <> 1))`,
      [report.workspaceId],
    );
    expect(bad.rows[0]!.n).toBe(0);
    const depth = await pool.query<{ d: number }>(
      'SELECT max(nlevel(path))::int AS d FROM pages WHERE workspace_id = $1',
      [report.workspaceId],
    );
    expect(depth.rows[0]!.d).toBe(30);
    const ids = await pool.query<{ id: string }>(
      'SELECT id FROM pages WHERE workspace_id = $1 LIMIT 50',
      [report.workspaceId],
    );
    expect(ids.rows.every((r) => isUuidV7(r.id))).toBe(true);
    // Every page gets a search row with generated body text (search benchmarks).
    const search = await pool.query<{ n: number; words: number }>(
      `SELECT count(*)::int AS n, min(array_length(string_to_array(plain_text, ' '), 1))::int AS words
       FROM page_search WHERE workspace_id = $1`,
      [report.workspaceId],
    );
    expect(search.rows[0]).toEqual({ n: report.pages, words: 24 });
  });
});
