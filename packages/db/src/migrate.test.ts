// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MIGRATION_LOCK_KEY, migrationsFolder, withMigrationLock } from './migrate.js';

function recordingClient() {
  const calls: string[] = [];
  return {
    calls,
    client: {
      query: (sql: string, params?: unknown[]) => {
        calls.push(`${sql} ${JSON.stringify(params)}`);
        return Promise.resolve();
      },
    },
  };
}

describe('withMigrationLock', () => {
  const key = JSON.stringify([MIGRATION_LOCK_KEY.toString()]);

  it('locks, runs, then unlocks', async () => {
    const { calls, client } = recordingClient();
    const result = await withMigrationLock(client, () => {
      calls.push('work');
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(calls).toEqual([
      `SELECT pg_advisory_lock($1::bigint) ${key}`,
      'work',
      `SELECT pg_advisory_unlock($1::bigint) ${key}`,
    ]);
  });

  it('unlocks when the work fails', async () => {
    const { calls, client } = recordingClient();
    await expect(
      withMigrationLock(client, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(calls.at(-1)).toBe(`SELECT pg_advisory_unlock($1::bigint) ${key}`);
  });

  it('does not run the work when the lock cannot be taken', async () => {
    let ran = false;
    const client = { query: () => Promise.reject(new Error('connection lost')) };
    await expect(
      withMigrationLock(client, () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow('connection lost');
    expect(ran).toBe(false);
  });
});

describe('migration lock key', () => {
  it('fits in a signed 64-bit integer', () => {
    expect(MIGRATION_LOCK_KEY < 2n ** 63n).toBe(true);
  });

  it('points at the migrations folder of the package', () => {
    expect(migrationsFolder.replaceAll('\\', '/')).toMatch(/packages\/db\/migrations$/);
  });
});
