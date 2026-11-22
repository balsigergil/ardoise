// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  canBeTeamspaceMember,
  canManageTeamspace,
  canManageWorkspace,
  canSeeTeamspace,
  checkMemberRemoval,
  checkRoleChange,
  checkTeamspaceJoin,
  checkTeamspaceMemberRemoval,
  checkTeamspaceRoleChange,
  teamspaceVisibilities,
  workspaceRoles,
  type TeamspaceContext,
  type WorkspaceRole,
} from './roles.js';

describe('workspace roles', () => {
  it('lets only owners and admins manage the workspace', () => {
    expect(workspaceRoles.filter((r) => canManageWorkspace(r))).toEqual(['owner', 'admin']);
    expect(canManageWorkspace(undefined)).toBe(false);
  });

  it('lists assignable roles per actor', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member', 'guest']);
    expect(assignableRoles('admin')).toEqual(['admin', 'member', 'guest']);
    expect(assignableRoles('member')).toEqual([]);
    expect(assignableRoles('guest')).toEqual([]);
    expect(assignableRoles(undefined)).toEqual([]);
  });

  describe('checkRoleChange', () => {
    const change = (
      actorRole: WorkspaceRole | undefined,
      targetRole: WorkspaceRole,
      newRole: WorkspaceRole,
      ownerCount = 2,
    ) => checkRoleChange({ actorRole, targetRole, newRole, ownerCount, actorIsTarget: false });

    it('forbids members and guests', () => {
      for (const actor of ['member', 'guest', undefined] as const)
        for (const target of workspaceRoles)
          for (const next of workspaceRoles) expect(change(actor, target, next)).toBe('forbidden');
    });
    it('lets owners do anything that keeps an owner', () => {
      for (const target of workspaceRoles)
        for (const next of workspaceRoles) expect(change('owner', target, next)).toBeUndefined();
      expect(change('owner', 'owner', 'admin', 1)).toBe('last_owner');
      expect(change('owner', 'owner', 'owner', 1)).toBeUndefined();
    });
    it('protects owners from admins and stops admins from creating owners', () => {
      expect(change('admin', 'owner', 'member')).toBe('owner_protected');
      expect(change('admin', 'member', 'owner')).toBe('role_not_assignable');
      expect(change('admin', 'member', 'admin')).toBeUndefined();
      expect(change('admin', 'admin', 'guest')).toBeUndefined();
    });
  });

  describe('checkMemberRemoval', () => {
    const removal = (
      actorRole: WorkspaceRole | undefined,
      targetRole: WorkspaceRole,
      opts: { self?: boolean; owners?: number } = {},
    ) =>
      checkMemberRemoval({
        actorRole,
        targetRole,
        actorIsTarget: opts.self ?? false,
        ownerCount: opts.owners ?? 2,
      });

    it('lets anyone leave except the last owner', () => {
      for (const role of workspaceRoles)
        expect(removal(role, role, { self: true })).toBeUndefined();
      expect(removal('owner', 'owner', { self: true, owners: 1 })).toBe('last_owner');
    });
    it('lets owners remove anyone but the last owner', () => {
      for (const target of workspaceRoles) expect(removal('owner', target)).toBeUndefined();
      expect(removal('owner', 'owner', { owners: 1 })).toBe('last_owner');
    });
    it('lets admins remove non-owners only', () => {
      expect(removal('admin', 'owner')).toBe('owner_protected');
      for (const target of ['admin', 'member', 'guest'] as const)
        expect(removal('admin', target)).toBeUndefined();
    });
    it('forbids members and guests from removing others', () => {
      expect(removal('member', 'guest')).toBe('forbidden');
      expect(removal('guest', 'member')).toBe('forbidden');
    });
  });
});

describe('teamspaces', () => {
  const ctx = (
    workspaceRole: WorkspaceRole | undefined,
    teamspaceRole: 'owner' | 'member' | undefined,
    visibility: (typeof teamspaceVisibilities)[number],
  ): TeamspaceContext => ({ workspaceRole, teamspaceRole, visibility });

  it('visibility matrix', () => {
    for (const visibility of teamspaceVisibilities) {
      expect(canSeeTeamspace(ctx('member', 'member', visibility))).toBe(true);
      expect(canSeeTeamspace(ctx('owner', undefined, visibility))).toBe(true);
      expect(canSeeTeamspace(ctx('admin', undefined, visibility))).toBe(true);
      expect(canSeeTeamspace(ctx('guest', undefined, visibility))).toBe(false);
      expect(canSeeTeamspace(ctx(undefined, undefined, visibility))).toBe(false);
    }
    expect(canSeeTeamspace(ctx('member', undefined, 'open'))).toBe(true);
    expect(canSeeTeamspace(ctx('member', undefined, 'closed'))).toBe(true);
    expect(canSeeTeamspace(ctx('member', undefined, 'private'))).toBe(false);
  });

  it('management is for teamspace owners and workspace owners/admins', () => {
    expect(canManageTeamspace(ctx('member', 'owner', 'private'))).toBe(true);
    expect(canManageTeamspace(ctx('member', 'member', 'open'))).toBe(false);
    expect(canManageTeamspace(ctx('admin', undefined, 'private'))).toBe(true);
    expect(canManageTeamspace(ctx('owner', undefined, 'closed'))).toBe(true);
    expect(canManageTeamspace(ctx(undefined, 'owner', 'open'))).toBe(false);
  });

  it('self-join is for open teamspaces and non-guests', () => {
    expect(checkTeamspaceJoin(ctx('member', undefined, 'open'))).toBeUndefined();
    expect(checkTeamspaceJoin(ctx('member', undefined, 'closed'))).toBe('teamspace_join_forbidden');
    expect(checkTeamspaceJoin(ctx('admin', undefined, 'private'))).toBe('teamspace_join_forbidden');
    expect(checkTeamspaceJoin(ctx('guest', undefined, 'open'))).toBe('forbidden');
    expect(checkTeamspaceJoin(ctx('member', 'member', 'open'))).toBe('already_member');
  });

  it('keeps at least one teamspace owner', () => {
    const owner = ctx('member', 'owner', 'open');
    expect(
      checkTeamspaceMemberRemoval({
        actor: owner,
        actorIsTarget: true,
        targetRole: 'owner',
        ownerCount: 1,
      }),
    ).toBe('last_teamspace_owner');
    expect(
      checkTeamspaceMemberRemoval({
        actor: owner,
        actorIsTarget: true,
        targetRole: 'owner',
        ownerCount: 2,
      }),
    ).toBeUndefined();
    expect(
      checkTeamspaceRoleChange({
        actor: owner,
        actorIsTarget: true,
        targetRole: 'owner',
        newRole: 'member',
        ownerCount: 1,
      }),
    ).toBe('last_teamspace_owner');
  });

  it('lets members leave but not remove others', () => {
    const member = ctx('member', 'member', 'open');
    expect(
      checkTeamspaceMemberRemoval({
        actor: member,
        actorIsTarget: true,
        targetRole: 'member',
        ownerCount: 1,
      }),
    ).toBeUndefined();
    expect(
      checkTeamspaceMemberRemoval({
        actor: member,
        actorIsTarget: false,
        targetRole: 'member',
        ownerCount: 1,
      }),
    ).toBe('forbidden');
    expect(
      checkTeamspaceRoleChange({
        actor: member,
        actorIsTarget: false,
        targetRole: 'member',
        newRole: 'owner',
        ownerCount: 1,
      }),
    ).toBe('forbidden');
  });

  it('excludes guests from teamspace membership', () => {
    expect(canBeTeamspaceMember('guest')).toBe(false);
    expect(canBeTeamspaceMember('member')).toBe(true);
    expect(canBeTeamspaceMember(undefined)).toBe(false);
  });
});
