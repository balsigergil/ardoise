// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M2 integration: mutations + pull + pokes across two api nodes, permission filtering
 * of pull, a large subtree move through the job, public links (ROADMAP M2).
 */
import {
  newId,
  positionBetween,
  uuidToLabel,
  type CreatedInvitationDto,
  type PageListDto,
  type PullResponse,
  type SharingDto,
  type SyncServerMessage,
  type WorkspaceDto,
} from '@ardoise/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/bootstrap.js';
import { SUBTREE_INLINE_LIMIT } from '../../src/pages/page-tree.js';
import { startStack, type TestStack } from '../containers.js';
import { TestClient } from '../http-client.js';

const PUBLIC_URL = 'http://localhost:3000';
const ADMIN = { email: 'admin@example.test', password: 'admin password 1234' };
const pos = positionBetween(null, null);

let stack: TestStack;
let nodeA: NestExpressApplication;
let nodeB: NestExpressApplication;
let urlA: string;
let urlB: string;
let workspaceId: string;
let teamspaceId: string;
let admin: TestClient;
let bob: TestClient;
let bobId: string;

async function listen(app: NestExpressApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

async function login(base: string, email: string, password: string): Promise<TestClient> {
  const c = new TestClient(base, PUBLIC_URL);
  const res = await c.post('/api/auth/login', { email, password });
  expect(res.status).toBe(200);
  return c;
}

const cookieOf = (client: TestClient) => client.cookieHeader;

/** Opens `/sync/ws` and collects pokes. */
async function subscribe(base: string, client: TestClient, ws: string) {
  const messages: SyncServerMessage[] = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/sync/ws?workspace=${ws}`, {
    headers: { cookie: cookieOf(client), origin: PUBLIC_URL },
  });
  socket.on('message', (data: Buffer) =>
    messages.push(JSON.parse(data.toString()) as SyncServerMessage),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) =>
      reject(new Error(`status ${res.statusCode}`)),
    );
  });
  return { socket, messages };
}

async function until<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  stack = await startStack();
  nodeA = await createApp(
    stack.config({ ARDOISE_ADMIN_EMAIL: ADMIN.email, ARDOISE_ADMIN_PASSWORD: ADMIN.password }),
    { webDist: '/nonexistent' },
  );
  urlA = await listen(nodeA);
  nodeB = await createApp(stack.config({ ARDOISE_ROLE: 'api', ARDOISE_MIGRATE_ON_BOOT: 'false' }), {
    webDist: '/nonexistent',
  });
  urlB = await listen(nodeB);

  admin = await login(urlA, ADMIN.email, ADMIN.password);
  const ws = await admin.post<WorkspaceDto>('/api/workspaces', { name: 'Sync' });
  workspaceId = ws.body.id;
  const roots = await admin.get<{ items: { id: string; name: string }[] }>(
    `/api/workspaces/${workspaceId}/teamspaces`,
  );
  teamspaceId = roots.body.items[0]!.id;
  const invite = await admin.post<CreatedInvitationDto>(
    `/api/workspaces/${workspaceId}/invitations`,
    {
      email: 'bob@example.test',
      role: 'member',
    },
  );
  const accept = await new TestClient(urlB, PUBLIC_URL).post<{ userId?: string }>(
    '/api/invitations/accept',
    {
      token: invite.body.link.split('#token=')[1],
      name: 'Bob',
      password: 'bob password 12345',
    },
  );
  expect(accept.status).toBe(200);
  bob = await login(urlB, 'bob@example.test', 'bob password 12345');
  bobId = (await bob.get<{ user: { id: string } }>('/api/auth/session')).body.user.id;
}, 180_000);

afterAll(async () => {
  await nodeB?.close();
  await nodeA?.close();
  await stack?.stop();
});

describe('mutations, pull and pokes across two api nodes', () => {
  it('pokes a client on node B when node A applies a mutation, and pull returns it', async () => {
    const { socket, messages } = await subscribe(urlB, admin, workspaceId);
    try {
      const pageId = newId();
      const result = await admin.mutate(workspaceId, 'page.create', {
        id: pageId,
        parent: { kind: 'teamspace', id: teamspaceId },
        position: pos,
        title: 'Hello',
      });
      expect(result.status).toBe('applied');
      expect(typeof result.seq).toBe('number');
      const poke = await until(() => messages.find((m) => m.seq >= result.seq!));
      expect(poke).toMatchObject({ type: 'poke', workspaceId });
      const pulled = await admin.get<PullResponse>(
        `/sync/pull?workspace=${workspaceId}&since=${result.seq! - 1}`,
      );
      expect(pulled.body.entries).toHaveLength(1);
      expect(pulled.body.entries[0]).toMatchObject({
        seq: result.seq,
        type: 'page',
        id: pageId,
        op: 'upsert',
        data: { title: 'Hello' },
      });
    } finally {
      socket.close();
    }
  });

  it('is idempotent across nodes', async () => {
    const id = newId();
    const args = { id: newId(), parent: { kind: 'teamspace', id: teamspaceId }, position: pos };
    const first = await admin.mutate(workspaceId, 'page.create', args, id);
    const adminOnB = admin.on(urlB);
    expect(await adminOnB.mutate(workspaceId, 'page.create', args, id)).toEqual(first);
  });

  it('keeps seqs gap-free under concurrent writers on both nodes', async () => {
    const adminOnB = admin.on(urlB);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? admin : adminOnB).mutate(workspaceId, 'page.create', {
          id: newId(),
          parent: { kind: 'teamspace', id: teamspaceId },
          position: pos,
          title: `c${i}`,
        }),
      ),
    );
    const seqs = results.map((r) => r.seq!).sort((a, b) => a - b);
    expect(seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1)).toBe(true);
  });

  it('refuses WebSocket upgrades without a session, from another origin or for another workspace', async () => {
    const attempt = (headers: Record<string, string>, ws = workspaceId) =>
      new Promise<number>((resolve) => {
        const s = new WebSocket(`${urlA.replace('http', 'ws')}/sync/ws?workspace=${ws}`, {
          headers,
        });
        s.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        s.once('open', () => {
          s.close();
          resolve(101);
        });
      });
    expect(await attempt({ origin: PUBLIC_URL })).toBe(401);
    expect(await attempt({ origin: 'https://evil.test', cookie: cookieOf(admin) })).toBe(403);
    expect(await attempt({ origin: PUBLIC_URL, cookie: cookieOf(admin) }, newId())).toBe(403);
  });
});

describe('permission filtering of pull', () => {
  it("hides another user's private pages until they are shared", async () => {
    const secret = newId();
    await admin.mutate(workspaceId, 'page.create', {
      id: secret,
      parent: {
        kind: 'private',
        id: (await admin.get<{ user: { id: string } }>('/api/auth/session')).body.user.id,
      },
      position: pos,
      title: 'Secret',
    });
    const before = await bob.get<PullResponse>(
      `/sync/pull?workspace=${workspaceId}&since=0&limit=1000`,
    );
    expect(before.body.entries.some((e) => e.id === secret)).toBe(false);
    expect((await bob.get(`/api/workspaces/${workspaceId}/pages/${secret}`)).status).toBe(404);

    await admin.mutate(workspaceId, 'permission.grant', {
      pageId: secret,
      principal: { kind: 'user', id: bobId },
      level: 'can_view',
    });
    const after = await bob.get<PullResponse>(
      `/sync/pull?workspace=${workspaceId}&since=0&limit=1000`,
    );
    expect(after.body.entries.some((e) => e.id === secret && e.type === 'page')).toBe(true);
    const shared = await bob.get<PageListDto>(`/api/workspaces/${workspaceId}/shared/pages`);
    expect(shared.body.items.map((p) => p.id)).toContain(secret);
    const sharing = await bob.get<SharingDto>(
      `/api/workspaces/${workspaceId}/pages/${secret}/sharing`,
    );
    expect(sharing.body).toMatchObject({ myLevel: 'can_view', publicLink: { url: null } });
    expect(await bob.mutate(workspaceId, 'page.update', { id: secret, title: 'x' })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('subtree moves', () => {
  it('rewrites small subtrees inside the mutation', async () => {
    const parent = newId();
    const child = newId();
    const target = newId();
    for (const [id, p] of [
      [parent, { kind: 'teamspace', id: teamspaceId }],
      [child, { kind: 'page', id: parent }],
      [target, { kind: 'teamspace', id: teamspaceId }],
    ] as const) {
      await admin.mutate(workspaceId, 'page.create', { id, parent: p, position: pos });
    }
    expect(
      await admin.mutate(workspaceId, 'page.move', {
        id: parent,
        parent: { kind: 'page', id: target },
        position: pos,
      }),
    ).toMatchObject({ status: 'applied' });
    const db = new pg.Client({ connectionString: stack.env.DATABASE_URL });
    await db.connect();
    try {
      const { rows } = await db.query<{ path: string }>(
        'SELECT path::text FROM pages WHERE id = $1',
        [child],
      );
      expect(rows[0]!.path).toBe([target, parent, child].map(uuidToLabel).join('.'));
    } finally {
      await db.end();
    }
    const list = await admin.get<PageListDto>(
      `/api/workspaces/${workspaceId}/pages/${target}/children`,
    );
    expect(list.body.items.map((p) => [p.id, p.hasChildren])).toEqual([[parent, true]]);
    expect(
      await admin.mutate(workspaceId, 'page.move', {
        id: target,
        parent: { kind: 'page', id: child },
        position: pos,
      }),
    ).toMatchObject({ status: 'rejected', code: 'move_cycle' });
  });

  it('rewrites paths through the job and ends the moving state', async () => {
    const big = newId();
    await admin.mutate(workspaceId, 'page.create', {
      id: big,
      parent: { kind: 'teamspace', id: teamspaceId },
      position: pos,
      title: 'Big',
    });
    const target = newId();
    await admin.mutate(workspaceId, 'page.create', {
      id: target,
      parent: { kind: 'teamspace', id: teamspaceId },
      position: pos,
      title: 'Target',
    });
    const db = new pg.Client({ connectionString: stack.env.DATABASE_URL });
    await db.connect();
    try {
      // Two levels under `big`: 50 children with ~45 children each.
      const total = SUBTREE_INLINE_LIMIT + 300;
      await db.query(
        `WITH kids AS (
           SELECT gen_random_uuid() AS id, i FROM generate_series(1, 50) i
         ), ins AS (
           INSERT INTO pages (workspace_id, id, kind, parent_kind, parent_id, path, position, title)
           SELECT $1, k.id, 'page', 'page', $2, ($3 || '.' || replace(k.id::text, '-', ''))::ltree,
                  'a' || lpad(k.i::text, 4, '0'), 'kid ' || k.i
           FROM kids k RETURNING id, path
         ), leaves AS (
           SELECT gen_random_uuid() AS id, ins.id AS parent, ins.path AS parent_path, n
           FROM ins CROSS JOIN generate_series(1, $4::int) n
         )
         INSERT INTO pages (workspace_id, id, kind, parent_kind, parent_id, path, position, title)
         SELECT $1, l.id, 'page', 'page', l.parent,
                (l.parent_path::text || '.' || replace(l.id::text, '-', ''))::ltree,
                'a' || lpad(l.n::text, 4, '0'), 'leaf'
         FROM leaves l`,
        [workspaceId, big, uuidToLabel(big), Math.ceil(total / 50)],
      );
      const moved = await admin.mutate(workspaceId, 'page.move', {
        id: big,
        parent: { kind: 'page', id: target },
        position: pos,
      });
      expect(moved.status).toBe('applied');
      const state = await db.query<{ move_state: string | null }>(
        'SELECT move_state FROM pages WHERE id = $1',
        [big],
      );
      expect(state.rows[0]!.move_state).toBe('moving');
      await until(async () => {
        const r = await db.query<{ move_state: string | null }>(
          'SELECT move_state FROM pages WHERE id = $1',
          [big],
        );
        return r.rows[0]!.move_state === null || undefined;
      }, 60_000);
      const stale = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pages WHERE workspace_id = $1 AND path <@ $2::ltree`,
        [workspaceId, uuidToLabel(big)],
      );
      expect(stale.rows[0]!.n).toBe(0);
      const movedCount = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pages WHERE workspace_id = $1 AND path <@ $2::ltree`,
        [workspaceId, `${uuidToLabel(target)}.${uuidToLabel(big)}`],
      );
      expect(movedCount.rows[0]!.n).toBeGreaterThan(SUBTREE_INLINE_LIMIT);
      const children = await admin.get<PageListDto>(
        `/api/workspaces/${workspaceId}/pages/${target}/children`,
      );
      expect(children.body.items.map((p) => [p.id, p.moveState])).toEqual([[big, null]]);
    } finally {
      await db.end();
    }
  }, 90_000);
});

describe('public links', () => {
  it('serves a shared page anonymously with noindex, and stops after revoke', async () => {
    const page = newId();
    await admin.mutate(workspaceId, 'page.create', {
      id: page,
      parent: { kind: 'teamspace', id: teamspaceId },
      position: pos,
      title: 'Public',
    });
    await admin.mutate(workspaceId, 'publicLink.set', {
      pageId: page,
      enabled: true,
      includeSubpages: false,
    });
    const sharing = await admin.get<SharingDto>(
      `/api/workspaces/${workspaceId}/pages/${page}/sharing`,
    );
    const token = sharing.body.publicLink.url!.split('/share/')[1]!;
    const anon = new TestClient(urlB);
    const res = await anon.get<{ page: { title: string } }>(`/api/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.page.title).toBe('Public');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    await admin.mutate(workspaceId, 'publicLink.set', { pageId: page, enabled: false });
    expect((await anon.get(`/api/public/${token}`)).status).toBe(404);
  });
});
