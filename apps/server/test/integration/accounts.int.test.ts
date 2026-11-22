// SPDX-License-Identifier: AGPL-3.0-only
/** M1 integration: setup, login, sessions, CSRF, invite → accept, reset, admin, workspaces. */
import { newId } from '@ardoise/shared';
import type {
  AcceptedInvitationDto,
  AdminUserDto,
  CreatedInvitationDto,
  MemberDto,
  Page,
  SessionDto,
  SessionListItemDto,
  TeamspaceDto,
  WorkspaceDto,
} from '@ardoise/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SetupService } from '../../src/admin/setup.service.js';
import { createApp } from '../../src/bootstrap.js';
import { startStack, type TestStack } from '../containers.js';
import { TestClient } from '../http-client.js';
import { startSmtpCapture } from '../smtp-capture.js';

const PUBLIC_URL = 'http://localhost:3000';
const ROOT = { email: 'root@example.test', password: 'root password 1234', name: 'Root' };

let stack: TestStack;
let smtp: Awaited<ReturnType<typeof startSmtpCapture>>;
let app: NestExpressApplication;
let baseUrl: string;
let workspaceId: string;

const client = () => new TestClient(baseUrl, PUBLIC_URL);
const tokenOf = (link: string) => link.split('#token=')[1]!;

async function signedIn(email: string, password: string): Promise<TestClient> {
  const c = client();
  const res = await c.post<SessionDto>('/api/auth/login', { email, password });
  expect(res.status).toBe(200);
  return c;
}

beforeAll(async () => {
  [stack, smtp] = await Promise.all([startStack(), startSmtpCapture()]);
  app = await createApp(
    stack.config({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_FROM: 'Ardoise <no-reply@example.test>',
    }),
    { webDist: '/nonexistent' },
  );
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await smtp?.close();
  await stack?.stop();
});

describe('first-run setup', () => {
  it('reports setup as required and refuses a wrong token', async () => {
    const c = client();
    expect((await c.get('/api/setup')).body).toEqual({ required: true });
    const res = await c.post('/api/setup', {
      token: 'x'.repeat(43),
      ...ROOT,
      workspaceName: 'Acme',
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'setup_token_invalid' } });
  });

  it('creates the super-admin and first workspace with the logged token', async () => {
    const state = await app.get(SetupService).prepare();
    expect(state.kind).toBe('pending');
    if (state.kind !== 'pending') return;
    expect(state.url.startsWith(`${PUBLIC_URL}/setup#token=`)).toBe(true);
    const c = client();
    const res = await c.post<{ session: SessionDto; workspaceId: string }>('/api/setup', {
      token: tokenOf(state.url),
      ...ROOT,
      workspaceName: 'Acme',
    });
    expect(res.status).toBe(201);
    expect(res.body.session.user).toMatchObject({ email: ROOT.email, isSuperAdmin: true });
    workspaceId = res.body.workspaceId;
    const cookie = res.headers.getSetCookie().find((l) => l.startsWith('ardoise_session='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect((await c.get<WorkspaceDto[]>('/api/workspaces')).body).toEqual([
      { id: workspaceId, name: 'Acme', icon: null, role: 'owner' },
    ]);
    expect((await client().get('/api/setup')).body).toEqual({ required: false });
    expect(
      (
        await client().post('/api/setup', {
          token: tokenOf(state.url),
          ...ROOT,
          workspaceName: 'X',
        })
      ).status,
    ).toBe(409);
  });
});

describe('login, sessions and CSRF', () => {
  it('rejects bad credentials with a stable code and no account hint', async () => {
    const wrong = await client().post('/api/auth/login', { email: ROOT.email, password: 'nope' });
    const unknown = await client().post('/api/auth/login', {
      email: 'ghost@example.test',
      password: 'nope',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual({ error: { code: 'invalid_credentials' } });
  });

  it('requires a session on protected routes', async () => {
    const res = await client().get('/api/workspaces');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'unauthenticated' } });
  });

  it('requires the CSRF token and a same-origin request for writes', async () => {
    const c = await signedIn(ROOT.email, ROOT.password);
    const token = c.csrfToken;
    c.csrfToken = undefined;
    expect((await c.post('/api/workspaces', { name: 'No CSRF' })).body).toEqual({
      error: { code: 'csrf_invalid' },
    });
    c.csrfToken = token;
    const cross = await c.request(
      'POST',
      '/api/workspaces',
      { name: 'Cross' },
      { origin: 'https://evil.test' },
    );
    expect(cross.status).toBe(403);
    expect(cross.body).toEqual({ error: { code: 'origin_invalid' } });
    expect((await c.post('/api/workspaces', { name: 'Second' })).status).toBe(201);
  });

  it('lists and revokes sessions; logout clears the cookie', async () => {
    const a = await signedIn(ROOT.email, ROOT.password);
    const b = await signedIn(ROOT.email, ROOT.password);
    const list = (await a.get<SessionListItemDto[]>('/api/auth/sessions')).body;
    const current = list.find((s) => s.current);
    expect(current).toBeDefined();
    const sessionB = (await b.get<SessionListItemDto[]>('/api/auth/sessions')).body.find(
      (s) => s.current,
    )!;
    expect((await a.delete(`/api/auth/sessions/${sessionB.id}`)).status).toBe(204);
    expect((await b.get('/api/auth/session')).status).toBe(401);
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect(a.cookieNames).not.toContain('ardoise_session');
    expect((await a.get('/api/auth/session')).status).toBe(401);
  });

  it('validates bodies with field issues', async () => {
    const res = await client().post<{ error: { code: string; issues: { path: string }[] } }>(
      '/api/auth/login',
      { email: 'x' },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.issues.map((i) => i.path).sort()).toEqual(['email', 'password']);
  });

  it('rate-limits login attempts per client address', async () => {
    const c = client();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await c.request(
        'POST',
        '/api/auth/login',
        { email: 'limited@example.test', password: 'x' },
        {
          'x-forwarded-for': '203.0.113.7',
        },
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('invite → accept → login', () => {
  it('invites by email, accepts the link, and signs in', async () => {
    const owner = await signedIn(ROOT.email, ROOT.password);
    const invited = await owner.post<CreatedInvitationDto>(
      `/api/workspaces/${workspaceId}/invitations`,
      {
        email: 'Nina@Example.test',
        role: 'member',
        locale: 'fr',
      },
    );
    expect(invited.status).toBe(201);
    expect(invited.body.emailSent).toBe(true);
    expect(invited.body.invitation.email).toBe('nina@example.test');
    const link = await smtp.linkFor('nina@example.test');
    expect(link).toBe(invited.body.link);
    const mail = smtp.messages.find((m) => m.to.includes('nina@example.test'))!;
    expect(mail.decoded).toContain('Accepter l’invitation');

    const guest = client();
    const preview = await guest.post('/api/invitations/preview', { token: tokenOf(link) });
    expect(preview.body).toMatchObject({
      email: 'nina@example.test',
      workspaceName: 'Acme',
      inviterName: 'Root',
      hasAccount: false,
    });
    const accepted = await guest.post<AcceptedInvitationDto>('/api/invitations/accept', {
      token: tokenOf(link),
      name: 'Nina',
      password: 'nina password 1234',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspaceId).toBe(workspaceId);
    expect((await guest.get<WorkspaceDto[]>('/api/workspaces')).body.map((w) => w.role)).toEqual([
      'member',
    ]);
    expect(
      (
        await client().post('/api/invitations/accept', {
          token: tokenOf(link),
          name: 'X',
          password: 'x'.repeat(12),
        })
      ).status,
    ).toBe(410);

    const nina = await signedIn('nina@example.test', 'nina password 1234');
    const members = await nina.get<Page<MemberDto>>(`/api/workspaces/${workspaceId}/members`);
    expect(members.body.items.map((m) => [m.email, m.role])).toEqual([
      ['nina@example.test', 'member'],
      ['root@example.test', 'owner'],
    ]);
    // Members cannot invite.
    expect(
      (await nina.post(`/api/workspaces/${workspaceId}/invitations`, { email: 'z@example.test' }))
        .status,
    ).toBe(403);
  });

  it('super-admins invite people to the instance', async () => {
    const root = await signedIn(ROOT.email, ROOT.password);
    const res = await root.post<CreatedInvitationDto>('/api/admin/invitations', {
      email: 'solo@example.test',
    });
    expect(res.status).toBe(201);
    const c = client();
    const accepted = await c.post<AcceptedInvitationDto>('/api/invitations/accept', {
      token: tokenOf(res.body.link),
      name: 'Solo',
      password: 'solo password 1234',
    });
    expect(accepted.body.workspaceId).toBeNull();
    expect((await c.get('/api/workspaces')).body).toEqual([]);
  });
});

describe('password reset', () => {
  it('sends a link that sets a new password once and signs out other sessions', async () => {
    const before = await signedIn('nina@example.test', 'nina password 1234');
    const res = await client().post('/api/auth/password-reset/request', {
      email: 'nina@example.test',
    });
    expect(res.status).toBe(204);
    const unknown = await client().post('/api/auth/password-reset/request', {
      email: 'ghost@example.test',
    });
    expect(unknown.status).toBe(204);
    const link = await smtp.linkFor('nina@example.test').then(async (first) => {
      // The invitation email came first; wait for the reset email.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const reset = smtp.messages.filter((m) => m.to.includes('nina@example.test')).at(-1);
        const found =
          reset && /https?:\/\/[^\s"<>]+\/reset-password#token=[\w-]+/.exec(reset.decoded)?.[0];
        if (found) return found;
        await new Promise((r) => setTimeout(r, 50));
      }
      return first;
    });
    expect(link).toContain('/reset-password#token=');
    const confirm = await client().post('/api/auth/password-reset/confirm', {
      token: tokenOf(link),
      password: 'nina new password 1',
    });
    expect(confirm.status).toBe(204);
    expect((await before.get('/api/auth/session')).status).toBe(401);
    await signedIn('nina@example.test', 'nina new password 1');
    const again = await client().post('/api/auth/password-reset/confirm', {
      token: tokenOf(link),
      password: 'other password 12',
    });
    expect(again.body).toEqual({ error: { code: 'reset_token_invalid' } });
  });
});

describe('workspaces and teamspaces', () => {
  it('creates teamspaces and lets members join open ones (mutations)', async () => {
    const root = await signedIn(ROOT.email, ROOT.password);
    const nina = await signedIn('nina@example.test', 'nina new password 1');
    const open = newId();
    expect(
      await root.mutate(workspaceId, 'teamspace.create', { id: open, name: 'Engineering' }),
    ).toMatchObject({
      status: 'applied',
    });
    await root.mutate(workspaceId, 'teamspace.create', {
      id: newId(),
      name: 'Board',
      visibility: 'private',
    });
    expect(
      await nina.mutate(workspaceId, 'teamspace.create', { id: newId(), name: 'Mine' }),
    ).toMatchObject({
      status: 'rejected',
      code: 'forbidden',
    });
    const visible = await nina.get<Page<TeamspaceDto>>(`/api/workspaces/${workspaceId}/teamspaces`);
    expect(visible.body.items.map((t) => t.name)).toEqual(['Acme', 'Engineering']);
    expect(await nina.mutate(workspaceId, 'teamspace.join', { teamspaceId: open })).toMatchObject({
      status: 'applied',
    });
    const after = await nina.get<TeamspaceDto>(`/api/workspaces/${workspaceId}/teamspaces/${open}`);
    expect(after.body).toMatchObject({ myRole: 'member', memberCount: 2, canManage: false });
    // The M1 REST write routes are gone (ADR 0005).
    expect(
      (await root.post(`/api/workspaces/${workspaceId}/teamspaces`, { name: 'x' })).status,
    ).toBe(404);
  });

  it('bumps the permission epoch on membership changes', async () => {
    const db = new pg.Client({ connectionString: stack.env.DATABASE_URL });
    await db.connect();
    try {
      const { rows } = await db.query<{ perm_epoch: string }>(
        'SELECT perm_epoch FROM workspace_counters WHERE workspace_id = $1',
        [workspaceId],
      );
      expect(Number(rows[0]?.perm_epoch)).toBeGreaterThanOrEqual(3);
    } finally {
      await db.end();
    }
  });

  it('hides other workspaces and malformed ids as not found', async () => {
    const nina = await signedIn('nina@example.test', 'nina new password 1');
    const root = await signedIn(ROOT.email, ROOT.password);
    const other = (await root.get<WorkspaceDto[]>('/api/workspaces')).body.find(
      (w) => w.name === 'Second',
    )!;
    expect((await nina.get(`/api/workspaces/${other.id}`)).status).toBe(404);
    expect((await nina.get('/api/workspaces/not-a-uuid')).status).toBe(404);
  });
});

describe('admin', () => {
  it('is forbidden to non super-admins', async () => {
    const nina = await signedIn('nina@example.test', 'nina new password 1');
    for (const path of [
      '/api/admin/users',
      '/api/admin/workspaces',
      '/api/admin/settings',
      '/api/admin/smtp',
    ])
      expect((await nina.get(path)).status).toBe(403);
  });

  it('lists users, disables one (signing them out) and sends a test email', async () => {
    const root = await signedIn(ROOT.email, ROOT.password);
    const nina = await signedIn('nina@example.test', 'nina new password 1');
    const users = await root.get<Page<AdminUserDto>>('/api/admin/users?limit=50');
    const ninaRow = users.body.items.find((u) => u.email === 'nina@example.test')!;
    expect(ninaRow.disabled).toBe(false);
    expect((await root.patch(`/api/admin/users/${ninaRow.id}`, { disabled: true })).status).toBe(
      200,
    );
    expect((await nina.get('/api/auth/session')).status).toBe(401);
    expect(
      (
        await client().post('/api/auth/login', {
          email: 'nina@example.test',
          password: 'nina new password 1',
        })
      ).body,
    ).toEqual({
      error: { code: 'account_disabled' },
    });
    expect((await root.patch(`/api/admin/users/${ninaRow.id}`, { disabled: false })).status).toBe(
      200,
    );

    const settings = await root.patch('/api/admin/settings', {
      limits: { invitationExpiryDays: 3 },
    });
    expect(settings.body).toMatchObject({
      limits: { invitationExpiryDays: 3, maxUploadSizeMb: 100 },
    });
    expect((await root.get('/api/admin/smtp')).body).toMatchObject({
      source: 'env',
      hasPassword: false,
    });
    expect((await root.post('/api/admin/smtp/test', { to: 'ops@example.test' })).status).toBe(204);
    await expect
      .poll(() => smtp.messages.some((m) => m.to.includes('ops@example.test')))
      .toBe(true);
  });
});

describe('security headers', () => {
  it('sets a strict CSP and related headers', async () => {
    const res = await fetch(`${baseUrl}/api/auth/session`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
