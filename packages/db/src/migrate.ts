// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Advisory lock key that serializes migrations across processes (ARCHITECTURE §2).
 * Arbitrary constant, stable forever: the ASCII bytes of "ardoise" as a bigint.
 */
export const MIGRATION_LOCK_KEY = 0x6172646f697365n;

/** Folder containing the generated SQL migrations (shipped with the package). */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Minimal client surface needed to hold the lock, so the protocol can be unit tested. */
export interface LockClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Runs `fn` while holding the session-level migration advisory lock. Other processes
 * wait on the lock, then find nothing left to apply. The lock is always released.
 */
export async function withMigrationLock<T>(client: LockClient, fn: () => Promise<T>): Promise<T> {
  const key = MIGRATION_LOCK_KEY.toString();
  await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
  }
}

export interface RunMigrationsOptions {
  connectionString: string;
  /** Defaults to the migrations shipped with this package. */
  folder?: string;
}

/** Applies pending migrations under the advisory lock, on a dedicated connection. */
export async function runMigrations({
  connectionString,
  folder = migrationsFolder,
}: RunMigrationsOptions): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'ardoise-migrate' });
  await client.connect();
  try {
    await withMigrationLock(client, () => migrate(drizzle(client), { migrationsFolder: folder }));
  } finally {
    await client.end();
  }
}
