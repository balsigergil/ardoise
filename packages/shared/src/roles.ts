// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorCode } from './errors.js';

export const workspaceRoles = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const teamspaceRoles = ['owner', 'member'] as const;
export type TeamspaceRole = (typeof teamspaceRoles)[number];

export const teamspaceVisibilities = ['open', 'closed', 'private'] as const;
export type TeamspaceVisibility = (typeof teamspaceVisibilities)[number];

/** Permission levels, highest first (PRODUCT §13). */
export const permissionLevels = [
  'full_access',
  'can_edit',
  'can_edit_content',
  'can_comment',
  'can_view',
  'no_access',
] as const;
export type PermissionLevel = (typeof permissionLevels)[number];

/** Levels a teamspace may grant by default to its members. */
export const teamspaceDefaultLevels = [
  'full_access',
  'can_edit',
  'can_comment',
  'can_view',
] as const satisfies readonly PermissionLevel[];
export type TeamspaceDefaultLevel = (typeof teamspaceDefaultLevels)[number];

/** Owners and admins manage members, teamspaces and settings (PRODUCT §4). */
export function canManageWorkspace(role: WorkspaceRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Roles an actor may give to someone (by invitation or role change). */
export function assignableRoles(actor: WorkspaceRole | undefined): readonly WorkspaceRole[] {
  if (actor === 'owner') return workspaceRoles;
  if (actor === 'admin') return ['admin', 'member', 'guest'];
  return [];
}

export interface MemberChange {
  actorRole: WorkspaceRole | undefined;
  actorIsTarget: boolean;
  targetRole: WorkspaceRole;
  /** Number of owners in the workspace before the change. */
  ownerCount: number;
}

/** Checks a role change. Returns the error code, or undefined when allowed. */
export function checkRoleChange(
  change: MemberChange & { newRole: WorkspaceRole },
): ErrorCode | undefined {
  const { actorRole, targetRole, newRole, ownerCount } = change;
  if (!canManageWorkspace(actorRole)) return 'forbidden';
  if (targetRole === 'owner' && actorRole !== 'owner') return 'owner_protected';
  if (!assignableRoles(actorRole).includes(newRole)) return 'role_not_assignable';
  if (targetRole === 'owner' && newRole !== 'owner' && ownerCount <= 1) return 'last_owner';
  return undefined;
}

/** Checks removing a member (or leaving, when the actor is the target). */
export function checkMemberRemoval(change: MemberChange): ErrorCode | undefined {
  const { actorRole, actorIsTarget, targetRole, ownerCount } = change;
  if (targetRole === 'owner' && ownerCount <= 1) return 'last_owner';
  if (actorIsTarget) return undefined;
  if (!canManageWorkspace(actorRole)) return 'forbidden';
  if (targetRole === 'owner' && actorRole !== 'owner') return 'owner_protected';
  return undefined;
}

export interface TeamspaceContext {
  workspaceRole: WorkspaceRole | undefined;
  teamspaceRole: TeamspaceRole | undefined;
  visibility: TeamspaceVisibility;
}

/** Guests only see pages shared with them; private teamspaces are hidden from non-members. */
export function canSeeTeamspace(ctx: TeamspaceContext): boolean {
  if (ctx.teamspaceRole) return true;
  if (!ctx.workspaceRole || ctx.workspaceRole === 'guest') return false;
  if (canManageWorkspace(ctx.workspaceRole)) return true;
  return ctx.visibility !== 'private';
}

/** Teamspace owners and workspace owners/admins manage a teamspace. */
export function canManageTeamspace(ctx: TeamspaceContext): boolean {
  if (!ctx.workspaceRole) return false;
  return ctx.teamspaceRole === 'owner' || canManageWorkspace(ctx.workspaceRole);
}

/** Joining by oneself: open teamspaces only, never for guests (ADR 0005). */
export function checkTeamspaceJoin(ctx: TeamspaceContext): ErrorCode | undefined {
  if (ctx.teamspaceRole) return 'already_member';
  if (!ctx.workspaceRole || ctx.workspaceRole === 'guest') return 'forbidden';
  if (ctx.visibility !== 'open') return 'teamspace_join_forbidden';
  return undefined;
}

export interface TeamspaceMemberChange {
  actor: TeamspaceContext;
  actorIsTarget: boolean;
  targetRole: TeamspaceRole;
  ownerCount: number;
}

export function checkTeamspaceMemberRemoval(change: TeamspaceMemberChange): ErrorCode | undefined {
  if (change.targetRole === 'owner' && change.ownerCount <= 1) return 'last_teamspace_owner';
  if (change.actorIsTarget) return undefined;
  return canManageTeamspace(change.actor) ? undefined : 'forbidden';
}

export function checkTeamspaceRoleChange(
  change: TeamspaceMemberChange & { newRole: TeamspaceRole },
): ErrorCode | undefined {
  if (!canManageTeamspace(change.actor)) return 'forbidden';
  if (change.targetRole === 'owner' && change.newRole !== 'owner' && change.ownerCount <= 1)
    return 'last_teamspace_owner';
  return undefined;
}

/** Guests cannot be teamspace members: they only get explicit page grants. */
export function canBeTeamspaceMember(role: WorkspaceRole | undefined): boolean {
  return role !== undefined && role !== 'guest';
}
