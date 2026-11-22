// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Seeds (CLAUDE.md §8): a small demo workspace and a large one for benchmarks
 * (ARCHITECTURE §12: 1M pages, deep trees, many grants). Set-based SQL: one
 * statement per tree level, so a million pages insert in minutes.
 */
import { newId, positionsBetween, uuidToLabel } from '@ardoise/shared';
import type pg from 'pg';

/** UUIDv7 in SQL (Postgres 17 has no built-in): 48-bit ms timestamp + random bits. */
const UUID7_FUNCTION = `
CREATE OR REPLACE FUNCTION pg_temp.ardoise_uuid7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(set_bit(set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
      -- version nibble 0111: set_bit counts from the least significant bit of each byte.
      52, 1), 53, 1), 54, 1), 55, 0),
    'hex')::uuid
$$ LANGUAGE sql VOLATILE`;

export interface SeedOwner {
  id: string;
  email: string;
}

/** The user who will own the seeded workspace: by email, else the first super-admin. */
export async function findOwner(client: pg.PoolClient, email?: string): Promise<SeedOwner> {
  const { rows } = email
    ? await client.query<SeedOwner>('SELECT id, email FROM users WHERE email = $1', [
        email.toLowerCase(),
      ])
    : await client.query<SeedOwner>(
        'SELECT id, email FROM users WHERE is_super_admin ORDER BY created_at LIMIT 1',
      );
  const owner = rows[0];
  if (!owner)
    throw new Error(
      email ? `no user ${email}` : 'no super-admin yet: run the first-run setup first',
    );
  return owner;
}

async function createWorkspace(
  client: pg.PoolClient,
  name: string,
  ownerId: string,
): Promise<string> {
  const id = newId();
  await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [id, name]);
  await client.query('INSERT INTO workspace_counters (workspace_id) VALUES ($1)', [id]);
  await client.query(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, ownerId],
  );
  return id;
}

async function createTeamspace(
  client: pg.PoolClient,
  workspaceId: string,
  name: string,
  ownerId: string,
): Promise<string> {
  const id = newId();
  await client.query(
    "INSERT INTO teamspaces (workspace_id, id, name, visibility, default_level) VALUES ($1, $2, $3, 'open', 'can_edit')",
    [workspaceId, id, name],
  );
  await client.query(
    "INSERT INTO teamspace_members (workspace_id, teamspace_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
    [workspaceId, id, ownerId],
  );
  return id;
}

/** Inserts `perParent` children under every page at `depth` (1 = top level) of the workspace. */
async function insertLevel(
  client: pg.PoolClient,
  workspaceId: string,
  depth: number,
  perParent: number,
  ownerId: string,
  titlePrefix: string,
): Promise<number> {
  const keys = positionsBetween(null, null, perParent);
  const result = await client.query(
    `INSERT INTO pages (workspace_id, id, kind, parent_kind, parent_id, path, position, title, created_by, updated_by)
     SELECT $1, c.id, 'page', 'page', c.parent_id, (c.parent_path::text || '.' || replace(c.id::text, '-', ''))::ltree,
            c.position, $4 || ' ' || c.n, $5, $5
     FROM (
       SELECT pg_temp.ardoise_uuid7() AS id, p.id AS parent_id, p.path AS parent_path, k.position, k.n
       FROM pages p
       CROSS JOIN unnest($3::text[]) WITH ORDINALITY AS k(position, n)
       WHERE p.workspace_id = $1 AND nlevel(p.path) = $2 AND p.deleted_at IS NULL
     ) c`,
    [workspaceId, depth, keys, titlePrefix, ownerId],
  );
  return result.rowCount ?? 0;
}

async function insertRoots(
  client: pg.PoolClient,
  workspaceId: string,
  parent: { kind: 'teamspace' | 'private'; id: string },
  count: number,
  ownerId: string,
  titlePrefix: string,
): Promise<number> {
  const keys = positionsBetween(null, null, count);
  const result = await client.query(
    `INSERT INTO pages (workspace_id, id, kind, parent_kind, parent_id, path, position, title, created_by, updated_by)
     SELECT $1, r.id, 'page', $2::parent_kind, $3, replace(r.id::text, '-', '')::ltree, r.position, $5 || ' ' || r.n, $6, $6
     FROM (SELECT pg_temp.ardoise_uuid7() AS id, k.position, k.n FROM unnest($4::text[]) WITH ORDINALITY AS k(position, n)) r`,
    [workspaceId, parent.kind, parent.id, keys, titlePrefix, ownerId],
  );
  return result.rowCount ?? 0;
}

/** A single chain of `depth` nested pages under the first root of a teamspace. */
async function insertDeepChain(
  client: pg.PoolClient,
  workspaceId: string,
  teamspaceId: string,
  depth: number,
  ownerId: string,
): Promise<void> {
  const position = positionsBetween(null, null, 1)[0]!;
  let parent: { id: string; path: string } | null = null;
  for (let i = 0; i < depth; i++) {
    const id = newId();
    const path: string = parent ? `${parent.path}.${uuidToLabel(id)}` : uuidToLabel(id);
    await client.query(
      `INSERT INTO pages (workspace_id, id, kind, parent_kind, parent_id, path, position, title, created_by, updated_by)
       VALUES ($1, $2, 'page', $3, $4, $5::ltree, $6, $7, $8, $8)`,
      [
        workspaceId,
        id,
        parent ? 'page' : 'teamspace',
        parent ? parent.id : teamspaceId,
        path,
        position,
        `Deep ${i + 1}`,
        ownerId,
      ],
    );
    parent = { id, path };
  }
}

export interface SeedReport {
  workspaceId: string;
  pages: number;
  grants: number;
  ms: number;
}

/** A small demo workspace: two teamspaces, nested pages, a private section, grants. */
export async function seedDemo(pool: pg.Pool, ownerEmail?: string): Promise<SeedReport> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(UUID7_FUNCTION);
    const owner = await findOwner(client, ownerEmail);
    const ws = await createWorkspace(client, 'Demo', owner.id);
    let pages = 0;
    for (const name of ['Demo', 'Engineering']) {
      const ts = await createTeamspace(client, ws, name, owner.id);
      pages += await insertRoots(
        client,
        ws,
        { kind: 'teamspace', id: ts },
        5,
        owner.id,
        `${name} page`,
      );
    }
    pages += await insertRoots(
      client,
      ws,
      { kind: 'private', id: owner.id },
      3,
      owner.id,
      'Private page',
    );
    pages += await insertLevel(client, ws, 1, 4, owner.id, 'Subpage');
    pages += await insertLevel(client, ws, 2, 3, owner.id, 'Note');
    await client.query('COMMIT');
    return { workspaceId: ws, pages, grants: 0, ms: Date.now() - started };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface LargeSeedOptions {
  teamspaces: number;
  /** Children per page at each level below the roots, e.g. [10, 10, 10]. */
  fanout: number[];
  roots: number;
  deepChain: number;
  /** One grant every `grantEvery` pages, to `members` seeded users. */
  grantEvery: number;
  members: number;
  log?: (line: string) => void;
}

export const LARGE_DEFAULTS: LargeSeedOptions = {
  teamspaces: 10,
  roots: 100,
  fanout: [10, 10, 10],
  deepChain: 200,
  grantEvery: 50,
  members: 20,
};

/**
 * The benchmark workspace (ARCHITECTURE §12): by default 10 teamspaces × 100 roots with
 * fan-out 10/10/10 (1,111,000 pages), a 200-deep chain and ~22k grants. Members are
 * created without a usable password (they only receive grants).
 */
export async function seedLarge(
  pool: pg.Pool,
  ownerEmail?: string,
  options: Partial<LargeSeedOptions> = {},
): Promise<SeedReport> {
  const o = { ...LARGE_DEFAULTS, ...options };
  const log = o.log ?? (() => undefined);
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query(UUID7_FUNCTION);
    const owner = await findOwner(client, ownerEmail);
    const ws = await createWorkspace(
      client,
      `Large ${new Date().toISOString().slice(0, 16)}`,
      owner.id,
    );
    const members: string[] = [];
    for (let i = 0; i < o.members; i++) {
      const id = newId();
      await client.query(
        "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, '!')",
        [id, `seed-${id.slice(-12)}@example.invalid`, `Seed member ${i + 1}`],
      );
      await client.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
        [ws, id],
      );
      members.push(id);
    }
    let pages = 0;
    const teamspaces: string[] = [];
    for (let t = 0; t < o.teamspaces; t++) {
      const ts = await createTeamspace(client, ws, `Team ${t + 1}`, owner.id);
      teamspaces.push(ts);
      pages += await insertRoots(
        client,
        ws,
        { kind: 'teamspace', id: ts },
        o.roots,
        owner.id,
        `Team ${t + 1} page`,
      );
    }
    log(`roots: ${pages}`);
    for (let level = 0; level < o.fanout.length; level++) {
      pages += await insertLevel(
        client,
        ws,
        level + 1,
        o.fanout[level]!,
        owner.id,
        `Level ${level + 2}`,
      );
      log(`level ${level + 2}: ${pages} pages`);
    }
    if (o.deepChain > 0) {
      await insertDeepChain(client, ws, teamspaces[0]!, o.deepChain, owner.id);
      pages += o.deepChain;
      log(`deep chain: ${o.deepChain}`);
    }
    // Grants: every n-th page (by id) to a seeded member, round robin; some restricted.
    const grants = await client.query(
      `INSERT INTO page_permissions (workspace_id, page_id, principal_kind, principal_id, level, created_by)
       SELECT $1, p.id, 'user', ($2::uuid[])[1 + (p.rn % array_length($2::uuid[], 1))], 'can_edit', $4
       FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM pages WHERE workspace_id = $1) p
       WHERE p.rn % $3 = 0`,
      [ws, members, o.grantEvery, owner.id],
    );
    await client.query(
      `UPDATE pages SET restrict_inheritance = true
       WHERE workspace_id = $1 AND id IN (
         SELECT page_id FROM page_permissions WHERE workspace_id = $1 AND principal_kind = 'user'
         ORDER BY page_id LIMIT (SELECT count(*) / 20 FROM page_permissions WHERE workspace_id = $1))`,
      [ws],
    );
    log(`grants: ${grants.rowCount ?? 0}`);
    await client.query('ANALYZE pages');
    await client.query('ANALYZE page_permissions');
    return { workspaceId: ws, pages, grants: grants.rowCount ?? 0, ms: Date.now() - started };
  } finally {
    client.release();
  }
}
