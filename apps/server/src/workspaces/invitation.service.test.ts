// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createHarness, PUBLIC_URL, tokenFromLink } from '../testing/harness.js';

const DAY = 24 * 60 * 60_000;

async function setup(options?: Parameters<typeof createHarness>[0]) {
  const h = createHarness(options);
  const root = await h.createUser({ email: 'root@x.test', name: 'Root', isSuperAdmin: true });
  const owner = await h.createUser({ email: 'owner@x.test', name: 'Olivia' });
  const ws = await h.createWorkspace(owner, 'Acme');
  return { h, root, owner, ws };
}

const accept = { name: 'New Person', password: 'a long enough password' };

describe('workspace invitations', () => {
  it('invite → email → accept creates the account, the membership and a session', async () => {
    const { h, owner, ws } = await setup();
    const created = await h.invitations.create(
      owner,
      { kind: 'workspace', workspaceId: ws.id, role: 'member' },
      'new@x.test',
      'fr',
    );
    expect(created.emailSent).toBe(true);
    expect(created.link.startsWith(`${PUBLIC_URL}/invite#token=`)).toBe(true);
    expect(h.sent[0]).toMatchObject({ to: 'new@x.test' });
    expect(h.sent[0]?.subject).toBe('Olivia vous invite à rejoindre Acme');
    const token = tokenFromLink(created.link);

    expect(await h.invitations.preview(token)).toEqual({
      email: 'new@x.test',
      workspaceName: 'Acme',
      inviterName: 'Olivia',
      role: 'member',
      hasAccount: false,
    });
    const result = await h.invitations.accept(
      { token, ...accept, locale: 'fr' },
      undefined,
      h.meta,
    );
    expect(result.workspaceId).toBe(ws.id);
    expect(result.issued?.user).toMatchObject({
      email: 'new@x.test',
      locale: 'fr',
      isSuperAdmin: false,
    });
    expect(await h.store.workspaces.membership(ws.id, result.issued!.user.id)).toMatchObject({
      role: 'member',
    });
    await expect(
      h.invitations.accept({ token, ...accept }, undefined, h.meta),
    ).rejects.toMatchObject({
      code: 'invitation_used',
    });
    await expect(h.invitations.preview(token)).rejects.toMatchObject({ code: 'invitation_used' });
  });

  it('requires a name and password for new accounts', async () => {
    const { h, owner, ws } = await setup();
    const { link } = await h.invitations.create(
      owner,
      { kind: 'workspace', workspaceId: ws.id, role: 'member' },
      'n@x.test',
      undefined,
    );
    await expect(
      h.invitations.accept({ token: tokenFromLink(link) }, undefined, h.meta),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('existing accounts accept by signing in as the invited email', async () => {
    const { h, owner, ws } = await setup();
    const bob = await h.createUser({ email: 'bob@x.test' });
    const eve = await h.createUser({ email: 'eve@x.test' });
    const { link } = await h.invitations.create(
      owner,
      { kind: 'workspace', workspaceId: ws.id, role: 'admin' },
      'bob@x.test',
      undefined,
    );
    const token = tokenFromLink(link);
    expect((await h.invitations.preview(token)).hasAccount).toBe(true);
    const ctx = async (u: typeof bob) =>
      (await h.auth.authenticate((await h.auth.createSession(u, h.meta)).token))!;
    await expect(h.invitations.accept({ token }, undefined, h.meta)).rejects.toMatchObject({
      code: 'invitation_email_mismatch',
    });
    await expect(h.invitations.accept({ token }, await ctx(eve), h.meta)).rejects.toMatchObject({
      code: 'invitation_email_mismatch',
    });
    const result = await h.invitations.accept({ token }, await ctx(bob), h.meta);
    expect(result).toEqual({ workspaceId: ws.id });
    expect(await h.store.workspaces.membership(ws.id, bob.id)).toMatchObject({ role: 'admin' });
  });

  it('expires after the configured number of days', async () => {
    const { h, owner, ws } = await setup();
    await h.settings.update({ limits: { invitationExpiryDays: 2 } });
    const { link, invitation } = await h.invitations.create(
      owner,
      { kind: 'workspace', workspaceId: ws.id, role: 'member' },
      'n@x.test',
      undefined,
    );
    expect(new Date(invitation.expiresAt).getTime() - h.clock.now().getTime()).toBe(2 * DAY);
    h.clock.advance(2 * DAY);
    await expect(h.invitations.preview(tokenFromLink(link))).rejects.toMatchObject({
      code: 'invitation_expired',
    });
  });

  it('re-inviting replaces the pending invitation; revoked links stop working', async () => {
    const { h, owner, ws } = await setup();
    const scope = { kind: 'workspace', workspaceId: ws.id, role: 'member' } as const;
    const first = await h.invitations.create(owner, scope, 'n@x.test', undefined);
    const second = await h.invitations.create(owner, scope, 'n@x.test', undefined);
    await expect(h.invitations.preview(tokenFromLink(first.link))).rejects.toMatchObject({
      code: 'invitation_revoked',
    });
    const pending = await h.invitations.listPending(owner, ws.id, { limit: 10 });
    expect(pending.items.map((i) => i.id)).toEqual([second.invitation.id]);
    await h.invitations.revoke(owner, ws.id, second.invitation.id);
    await expect(h.invitations.preview(tokenFromLink(second.link))).rejects.toMatchObject({
      code: 'invitation_revoked',
    });
    expect((await h.invitations.listPending(owner, ws.id, { limit: 10 })).items).toEqual([]);
  });

  it('checks who may invite and for which role', async () => {
    const { h, owner, ws } = await setup();
    const admin = await h.createUser();
    const member = await h.createUser();
    const stranger = await h.createUser();
    await h.addMember(ws.id, admin, 'admin');
    await h.addMember(ws.id, member, 'member');
    const scope = (role: 'owner' | 'member') =>
      ({ kind: 'workspace', workspaceId: ws.id, role }) as const;
    await expect(
      h.invitations.create(member, scope('member'), 'n@x.test', undefined),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      h.invitations.create(stranger, scope('member'), 'n@x.test', undefined),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      h.invitations.create(admin, scope('owner'), 'n@x.test', undefined),
    ).rejects.toMatchObject({
      code: 'role_not_assignable',
    });
    await expect(
      h.invitations.create(owner, scope('member'), 'owner@x.test', undefined),
    ).rejects.toMatchObject({
      code: 'already_member',
    });
    await h.settings.update({ general: { workspaceInvitationsEnabled: false } });
    await expect(
      h.invitations.create(owner, scope('member'), 'n@x.test', undefined),
    ).rejects.toMatchObject({
      code: 'invitations_disabled',
    });
    await expect(h.invitations.listPending(member, ws.id, { limit: 10 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('still returns the link when email is not configured or fails', async () => {
    const off = await setup({ smtp: undefined });
    const a = await off.h.invitations.create(
      off.owner,
      { kind: 'workspace', workspaceId: off.ws.id, role: 'member' },
      'n@x.test',
      undefined,
    );
    expect(a.emailSent).toBe(false);
    const broken = await setup({ failMail: true });
    const b = await broken.h.invitations.create(
      broken.owner,
      { kind: 'workspace', workspaceId: broken.ws.id, role: 'member' },
      'n@x.test',
      undefined,
    );
    expect(b.emailSent).toBe(false);
    expect(broken.h.warnings[0]).toContain('email delivery failed');
  });
});

describe('instance invitations', () => {
  it('are for super-admins and create an account without workspace', async () => {
    const { h, root, owner } = await setup();
    await expect(
      h.invitations.create(owner, { kind: 'instance' }, 'n@x.test', undefined),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      h.invitations.create(root, { kind: 'instance' }, 'owner@x.test', undefined),
    ).rejects.toMatchObject({
      code: 'email_taken',
    });
    const { link } = await h.invitations.create(root, { kind: 'instance' }, 'n@x.test', 'en');
    expect(h.sent[0]?.subject).toBe('You are invited to Ardoise');
    const result = await h.invitations.accept(
      { token: tokenFromLink(link), ...accept },
      undefined,
      h.meta,
    );
    expect(result.workspaceId).toBeNull();
    expect(await h.workspaces.listMine(result.issued!.user.id)).toEqual([]);
    expect((await h.invitations.listPending(root, null, { limit: 10 })).items).toEqual([]);
  });

  it('unknown tokens are not found', async () => {
    const { h } = await setup();
    await expect(h.invitations.preview('y'.repeat(43))).rejects.toMatchObject({
      code: 'invitation_not_found',
    });
  });
});
