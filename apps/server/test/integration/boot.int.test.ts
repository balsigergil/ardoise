// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@ardoise/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { startStack, type TestStack } from '../containers.js';

let stack: TestStack;
let app: NestExpressApplication;
let baseUrl: string;
let webDist: string;

beforeAll(async () => {
  stack = await startStack();
  webDist = mkdtempSync(join(tmpdir(), 'ardoise-web-'));
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Ardoise</title>');
  app = await createApp(stack.config(), { webDist });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  baseUrl = baseUrl.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await stack?.stop();
});

describe('server boot (role=all)', () => {
  it('serves /healthz', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('reports every dependency as ready on /readyz', async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe('ok');
    expect(Object.keys(body.checks).sort()).toEqual(['database', 's3', 'valkey']);
    for (const check of Object.values(body.checks)) {
      expect(check).not.toHaveProperty('error');
      expect(check.status).toBe('ok');
    }
  });

  it('ran the migrations on boot (extensions installed)', async () => {
    const client = new pg.Client({ connectionString: stack.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('ltree', 'pg_trgm', 'unaccent') ORDER BY extname",
      );
      expect(rows.map((r) => r.extname)).toEqual(['ltree', 'pg_trgm', 'unaccent']);
    } finally {
      await client.end();
    }
  });

  it('serves the SPA for client routes but not for server routes', async () => {
    const page = await fetch(`${baseUrl}/some/client/route`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Ardoise</title>');
    expect(page.headers.get('cache-control')).toBe('no-cache');

    const api = await fetch(`${baseUrl}/api/unknown`);
    expect(api.status).toBe(404);
    expect(await api.text()).not.toContain('<title>Ardoise</title>');
  });

  it('does not leak stack traces or the framework name', async () => {
    const res = await fetch(`${baseUrl}/api/unknown`);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(await res.text()).not.toMatch(/at .+\.(ts|js):\d+/);
  });
});

describe('migrations', () => {
  it('are safe to run concurrently and idempotent', async () => {
    const connectionString = stack.env.DATABASE_URL!;
    await Promise.all([1, 2, 3, 4].map(() => runMigrations({ connectionString })));
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM drizzle.__drizzle_migrations',
      );
      expect(Number(rows[0]?.count)).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe('roles', () => {
  it.each(['api', 'collab', 'worker'])('role=%s boots and is ready', async (role) => {
    const roleApp = await createApp(stack.config({ ARDOISE_ROLE: role }), { webDist });
    await roleApp.listen(0, '127.0.0.1');
    try {
      const url = (await roleApp.getUrl()).replace('[::1]', '127.0.0.1');
      expect((await fetch(`${url}/readyz`)).status).toBe(200);
      const spa = await fetch(`${url}/`);
      expect(spa.status).toBe(role === 'api' ? 200 : 404);
    } finally {
      await roleApp.close();
    }
  });
});

describe('readiness failure', () => {
  it('returns 503 without internal details when a dependency is down', async () => {
    const broken = await createApp(
      stack.config({
        S3_BUCKET: 'bucket-that-does-not-exist',
        ARDOISE_ROLE: 'worker',
        ARDOISE_MIGRATE_ON_BOOT: 'false',
      }),
      { webDist },
    );
    await broken.listen(0, '127.0.0.1');
    try {
      const url = (await broken.getUrl()).replace('[::1]', '127.0.0.1');
      const res = await fetch(`${url}/readyz`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string; checks: Record<string, object> };
      expect(body.status).toBe('error');
      expect(body.checks.s3).toEqual({ status: 'error', latencyMs: expect.any(Number) as number });
    } finally {
      await broken.close();
    }
  });
});
