// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  checkInvite,
  invitationAcceptError,
  invitationExpiry,
  invitationStatus,
  type InviterContext,
} from './invitations.js';

const t0 = new Date('2026-01-01T00:00:00Z');
const pending = { expiresAt: invitationExpiry(t0, 7), acceptedAt: null, revokedAt: null };

describe('invitation lifecycle', () => {
  it('is pending until it expires', () => {
    expect(invitationStatus(pending, t0)).toBe('pending');
    expect(invitationAcceptError(pending, t0)).toBeUndefined();
    const end = invitationExpiry(t0, 7);
    expect(invitationStatus(pending, new Date(end.getTime() - 1))).toBe('pending');
    expect(invitationStatus(pending, end)).toBe('expired');
    expect(invitationAcceptError(pending, end)).toBe('invitation_expired');
  });
  it('is single use', () => {
    const accepted = { ...pending, acceptedAt: t0 };
    expect(invitationStatus(accepted, t0)).toBe('accepted');
    expect(invitationAcceptError(accepted, t0)).toBe('invitation_used');
  });
  it('can be revoked', () => {
    const revoked = { ...pending, revokedAt: t0 };
    expect(invitationStatus(revoked, t0)).toBe('revoked');
    expect(invitationAcceptError(revoked, t0)).toBe('invitation_revoked');
  });
  it('reports acceptance before revocation or expiry', () => {
    const both = { expiresAt: t0, acceptedAt: t0, revokedAt: t0 };
    expect(invitationStatus(both, new Date(t0.getTime() + 1))).toBe('accepted');
  });
  it('computes the expiry in days', () => {
    expect(invitationExpiry(t0, 7).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});

describe('checkInvite', () => {
  const ctx = (over: Partial<InviterContext>): InviterContext => ({
    isSuperAdmin: false,
    workspaceRole: undefined,
    workspaceInvitationsEnabled: true,
    ...over,
  });
  const ws = (role: 'owner' | 'admin' | 'member' | 'guest') =>
    ({ kind: 'workspace', workspaceId: 'w', role }) as const;

  it('restricts instance invitations to super-admins', () => {
    expect(checkInvite({ kind: 'instance' }, ctx({ isSuperAdmin: true }))).toBeUndefined();
    expect(checkInvite({ kind: 'instance' }, ctx({ workspaceRole: 'owner' }))).toBe('forbidden');
  });
  it('lets owners and admins invite to their workspace', () => {
    expect(checkInvite(ws('member'), ctx({ workspaceRole: 'owner' }))).toBeUndefined();
    expect(checkInvite(ws('guest'), ctx({ workspaceRole: 'admin' }))).toBeUndefined();
    expect(checkInvite(ws('member'), ctx({ workspaceRole: 'member' }))).toBe('forbidden');
    expect(checkInvite(ws('member'), ctx({ workspaceRole: 'guest' }))).toBe('forbidden');
    expect(checkInvite(ws('member'), ctx({ isSuperAdmin: true }))).toBe('forbidden');
  });
  it('only lets owners invite owners', () => {
    expect(checkInvite(ws('owner'), ctx({ workspaceRole: 'owner' }))).toBeUndefined();
    expect(checkInvite(ws('owner'), ctx({ workspaceRole: 'admin' }))).toBe('role_not_assignable');
  });
  it('honors the instance toggle, except for super-admins', () => {
    const off = { workspaceInvitationsEnabled: false };
    expect(checkInvite(ws('member'), ctx({ ...off, workspaceRole: 'owner' }))).toBe(
      'invitations_disabled',
    );
    expect(
      checkInvite(ws('member'), ctx({ ...off, workspaceRole: 'owner', isSuperAdmin: true })),
    ).toBeUndefined();
  });
});
