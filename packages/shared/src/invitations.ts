// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorCode } from './errors.js';
import type { WorkspaceRole } from './roles.js';

export interface InvitationState {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export function invitationStatus(invitation: InvitationState, now: Date): InvitationStatus {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  if (now.getTime() >= invitation.expiresAt.getTime()) return 'expired';
  return 'pending';
}

/** Error code that prevents accepting, or undefined when the invitation is usable. */
export function invitationAcceptError(
  invitation: InvitationState,
  now: Date,
): ErrorCode | undefined {
  switch (invitationStatus(invitation, now)) {
    case 'accepted':
      return 'invitation_used';
    case 'revoked':
      return 'invitation_revoked';
    case 'expired':
      return 'invitation_expired';
    default:
      return undefined;
  }
}

export function invitationExpiry(createdAt: Date, expiryDays: number): Date {
  return new Date(createdAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

export type InvitationScope =
  { kind: 'instance' } | { kind: 'workspace'; workspaceId: string; role: WorkspaceRole };

export interface InviterContext {
  isSuperAdmin: boolean;
  /** Inviter's role in the target workspace, for workspace invitations. */
  workspaceRole: WorkspaceRole | undefined;
  /** Instance setting: workspace owners/admins may invite new people. */
  workspaceInvitationsEnabled: boolean;
}

/** Who may create an invitation (PRODUCT §3). */
export function checkInvite(
  scope: InvitationScope,
  inviter: InviterContext,
): ErrorCode | undefined {
  if (scope.kind === 'instance') return inviter.isSuperAdmin ? undefined : 'forbidden';
  const role = inviter.workspaceRole;
  if (role !== 'owner' && role !== 'admin') return 'forbidden';
  if (!inviter.workspaceInvitationsEnabled && !inviter.isSuperAdmin) return 'invitations_disabled';
  if (scope.role === 'owner' && role !== 'owner') return 'role_not_assignable';
  return undefined;
}
