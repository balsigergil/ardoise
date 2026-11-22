// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M2 benchmarks (ARCHITECTURE §12), run on demand against a running server with a
 * `db:seed:large` workspace:
 *
 *   BENCH_URL=http://127.0.0.1:3100 BENCH_EMAIL=… BENCH_PASSWORD=… pnpm --filter @ardoise/server bench
 *
 * Measures sidebar level loads (≤100 children, cold and warm permission cache), page
 * detail at depth, single-mutation round-trips, and the seq serialization (throughput
 * of concurrent writers in one workspace versus two workspaces).
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import {
  newId,
  type PageListDto,
  type PushResponse,
  type TeamspaceDto,
  type WorkspaceDto,
} from '@ardoise/shared';

const BASE = process.env.BENCH_URL ?? 'http://127.0.0.1:3100';
const EMAIL = process.env.BENCH_EMAIL;
const PASSWORD = process.env.BENCH_PASSWORD;
const ORIGIN = process.env.BENCH_ORIGIN ?? BASE;
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 200);

if (!EMAIL || !PASSWORD) {
  console.error('BENCH_EMAIL and BENCH_PASSWORD are required');
  process.exit(1);
}

let cookie = '';
let csrf = '';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(cookie && { cookie }),
      ...(csrf && method !== 'GET' && { 'x-csrf-token': csrf }),
      origin: ORIGIN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ardoise_session='));
  if (setCookie) cookie = setCookie.split(';')[0]!;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = performance.now();
  const value = await fn();
  return [performance.now() - start, value];
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1)! };
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const fmt = (ms: number) => `${ms.toFixed(1)} ms`;

async function main() {
  const session = await call<{ csrfToken: string }>('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  csrf = session.csrfToken;
  const workspaces = await call<WorkspaceDto[]>('GET', '/api/workspaces');
  const large = workspaces.filter((w) => w.name.startsWith('Large')).at(-1);
  const other = workspaces.find((w) => w !== large);
  if (!large) throw new Error('no "Large …" workspace: run pnpm db:seed:large first');
  const ws = large.id;
  const teamspaces = (
    await call<{ items: TeamspaceDto[] }>(
      'GET',
      `/api/workspaces/${ws}/teamspaces?mine=true&limit=100`,
    )
  ).items;

  // Collect a sample of pages at each level, through the API itself.
  const roots: string[] = [];
  const level2: string[] = [];
  for (const ts of teamspaces) {
    const list = await call<PageListDto>(
      'GET',
      `/api/workspaces/${ws}/teamspaces/${ts.id}/pages?limit=100`,
    );
    roots.push(...list.items.filter((p) => !p.title.startsWith('Deep')).map((p) => p.id));
  }
  for (let i = 0; i < 20; i++) {
    const list = await call<PageListDto>(
      'GET',
      `/api/workspaces/${ws}/pages/${pick(roots)}/children?limit=100`,
    );
    level2.push(...list.items.map((p) => p.id));
  }

  const results: Record<string, unknown> = {};
  const report: string[] = [];
  const row = (name: string, s: ReturnType<typeof stats>, budget?: number) => {
    results[name] = s;
    report.push(
      `| ${name} | ${s.n} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${budget ? `${budget} ms ${s.p95 <= budget ? '✅' : '❌'}` : '—'} |`,
    );
  };

  // 1. Sidebar level loads. Cold: each page once (permission cache misses); warm: again.
  const sidebarTargets = Array.from({ length: ITERATIONS }, (_, i) =>
    i % 3 === 0
      ? `/api/workspaces/${ws}/teamspaces/${pick(teamspaces).id}/pages?limit=100`
      : `/api/workspaces/${ws}/pages/${pick(i % 3 === 1 ? roots : level2)}/children?limit=100`,
  );
  const cold: number[] = [];
  for (const path of sidebarTargets) cold.push((await timed(() => call('GET', path)))[0]);
  const warm: number[] = [];
  for (const path of sidebarTargets) warm.push((await timed(() => call('GET', path)))[0]);
  row('Sidebar level load (cold perm cache)', stats(cold), 100);
  row('Sidebar level load (warm)', stats(warm), 100);

  // 2. Page detail (metadata + breadcrumb), including the 200-deep chain.
  const detail: number[] = [];
  for (let i = 0; i < ITERATIONS / 2; i++)
    detail.push((await timed(() => call('GET', `/api/workspaces/${ws}/pages/${pick(level2)}`)))[0]);
  row('Page metadata (depth 2)', stats(detail), 300);

  // 3. Single-mutation round-trip (rename), sequential.
  const push = (workspaceId: string, pageId: string) =>
    call<PushResponse>('POST', '/sync/mutations', {
      mutations: [
        {
          id: newId(),
          workspaceId,
          name: 'page.update',
          args: { id: pageId, title: `Renamed ${Math.random().toString(36).slice(2, 8)}` },
          clientTime: new Date().toISOString(),
        },
      ],
    });
  const roundTrips: number[] = [];
  for (let i = 0; i < ITERATIONS; i++)
    roundTrips.push((await timed(() => push(ws, pick(level2))))[0]);
  row('Mutation round-trip (page.update)', stats(roundTrips), 150);

  // 4. Seq serialization: concurrent writers in one workspace.
  const serialization: string[] = [];
  const perWriter = Number(process.env.BENCH_WRITES ?? 50);
  for (const writers of [1, 4, 16, 32]) {
    const latencies: number[] = [];
    const start = performance.now();
    await Promise.all(
      Array.from({ length: writers }, async () => {
        for (let i = 0; i < perWriter; i++)
          latencies.push((await timed(() => push(ws, pick(level2))))[0]);
      }),
    );
    const seconds = (performance.now() - start) / 1000;
    const s = stats(latencies);
    results[`serialization ${writers} writers`] = { ...s, throughput: latencies.length / seconds };
    serialization.push(
      `| ${writers} | ${latencies.length} | ${(latencies.length / seconds).toFixed(0)}/s | ${fmt(s.p50)} | ${fmt(s.p95)} |`,
    );
  }
  // Same load split across two workspaces: the counter lock is per workspace.
  if (other) {
    const otherPage = (
      await call<PageListDto>('GET', `/api/workspaces/${other.id}/private/pages?limit=10`).catch(
        () => ({ items: [] }),
      )
    ).items[0];
    if (otherPage) {
      const latencies: number[] = [];
      const start = performance.now();
      await Promise.all(
        Array.from({ length: 32 }, async (_, w) => {
          for (let i = 0; i < perWriter; i++)
            latencies.push(
              (
                await timed(() => (w % 2 ? push(ws, pick(level2)) : push(other.id, otherPage.id)))
              )[0],
            );
        }),
      );
      const seconds = (performance.now() - start) / 1000;
      const s = stats(latencies);
      results['serialization 32 writers, 2 workspaces'] = {
        ...s,
        throughput: latencies.length / seconds,
      };
      serialization.push(
        `| 32 (2 workspaces) | ${latencies.length} | ${(latencies.length / seconds).toFixed(0)}/s | ${fmt(s.p50)} | ${fmt(s.p95)} |`,
      );
    }
  }

  const host = `${os.cpus().length} vCPU (${os.cpus()[0]?.model.trim() ?? '?'}), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.platform()} ${os.release()}`;
  const output = [
    `Host: ${host}`,
    `Workspace: ${large.name} (${ws})`,
    '',
    '| Operation | n | p50 | p95 | max | Budget (p95) |',
    '|---|---|---|---|---|---|',
    ...report,
    '',
    '| Concurrent writers | Mutations | Throughput | p50 | p95 |',
    '|---|---|---|---|---|',
    ...serialization,
  ].join('\n');
  console.log(output);
  writeFileSync(
    process.env.BENCH_OUT ?? 'bench-results.json',
    JSON.stringify({ host, workspace: ws, results }, null, 2),
  );
}

await main();
