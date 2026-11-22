// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace, teamspace and member writes as mutations (ADR 0005: moved from REST in
 * M2). They lock the workspace counter first, which serializes membership changes and
 * keeps the "at least one owner" rules race-free.
 */
import {
  canBeTeamspaceMember,
  canManageTeamspace,
  canManageWorkspace,
  canSeeTeamspace,
  checkMemberRemoval,
  checkRoleChange,
  checkTeamspaceJoin,
  checkTeamspaceMemberRemoval,
  checkTeamspaceRoleChange,
  DomainError,
  type TeamspaceContext,
  type TeamspaceEntityDto,
  type TeamspaceRole,
} from '@ardoise/shared';
import type {
  MutationContext,
  MutationHandler,
  MutationHandlers,
} from '../sync/mutation.service.js';
import type { SyncEventBus } from '../sync/pokes.js';
import type { TeamspaceRecord } from '../store/store.js';

type WorkspaceHandlers = Pick<
  MutationHandlers,
  | 'workspace.update'
  | 'teamspace.create'
  | 'teamspace.update'
  | 'teamspace.join'
  | 'teamspace.addMember'
  | 'teamspace.setMemberRole'
  | 'teamspace.removeMember'
  | 'member.setRole'
  | 'member.remove'
>;

export const toTeamspaceEntity = (t: TeamspaceRecord): TeamspaceEntityDto => ({
  id: t.id,
  name: t.name,
  icon: t.icon,
  description: t.description,
  visibility: t.visibility,
  defaultLevel: t.defaultLevel,
});

async function teamspaceContext(
  ctx: MutationContext,
  teamspaceId: string,
): Promise<{ teamspace: TeamspaceRecord; tsCtx: TeamspaceContext }> {
  const teamspace = await ctx.store.teamspaces.findById(ctx.workspaceId, teamspaceId);
  if (!teamspace) throw new DomainError('not_found');
  const own = await ctx.store.teamspaces.membership(ctx.workspaceId, teamspaceId, ctx.actor.id);
  const tsCtx = {
    workspaceRole: ctx.member.role,
    teamspaceRole: own?.role,
    visibility: teamspace.visibility,
  };
  if (!canSeeTeamspace(tsCtx)) throw new DomainError('not_found');
  return { teamspace, tsCtx };
}

function emitTeamspaceMember(
  ctx: MutationContext,
  teamspaceId: string,
  userId: string,
  role: TeamspaceRole | null,
): void {
  const id = `${teamspaceId}:${userId}`;
  ctx.emit(
    role
      ? { type: 'teamspaceMember', id, op: 'upsert', data: { teamspaceId, userId, role } }
      : { type: 'teamspaceMember', id, op: 'delete' },
  );
  ctx.access('teamspace', teamspaceId, [userId]);
}

async function emitMember(ctx: MutationContext, userId: string): Promise<void> {
  const member = await ctx.store.workspaces.membership(ctx.workspaceId, userId);
  const user = await ctx.store.users.findById(userId);
  if (!member || !user) return;
  ctx.emit({
    type: 'member',
    id: userId,
    op: 'upsert',
    data: { userId, email: user.email, name: user.name, role: member.role },
  });
}

/** Removes every teamspace membership of a user, emitting one entry each. */
async function leaveAllTeamspaces(ctx: MutationContext, userId: string): Promise<void> {
  const roles = await ctx.store.teamspaces.rolesForUser(ctx.workspaceId, userId, 10_000);
  await ctx.store.teamspaces.removeUserEverywhere(ctx.workspaceId, userId);
  for (const teamspaceId of roles.keys()) emitTeamspaceMember(ctx, teamspaceId, userId, null);
}

export function workspaceHandlers(bus: SyncEventBus): WorkspaceHandlers {
  const first = <N extends keyof WorkspaceHandlers>(
    run: MutationHandler<N>['run'],
  ): MutationHandler<N> => ({
    lockFirst: true,
    run,
  });

  return {
    'workspace.update': first(async (ctx, args) => {
      if (!canManageWorkspace(ctx.member.role)) throw new DomainError('forbidden');
      const workspace = await ctx.store.workspaces.findById(ctx.workspaceId);
      const [change] = ctx.apply('workspace.update', args, {
        workspace: workspace
          ? [{ id: workspace.id, name: workspace.name, icon: workspace.icon }]
          : [],
      });
      await ctx.store.workspaces.update(ctx.workspaceId, {
        ...(args.name !== undefined && { name: args.name.trim() }),
        ...(args.icon !== undefined && { icon: args.icon }),
      });
      ctx.emit(change!);
    }),

    /** Only workspace owners and admins create teamspaces; the creator becomes owner. */
    'teamspace.create': first(async (ctx, args) => {
      if (!canManageWorkspace(ctx.member.role)) throw new DomainError('forbidden');
      if (await ctx.store.teamspaces.findById(ctx.workspaceId, args.id))
        throw new DomainError('validation_failed');
      const changes = ctx.apply('teamspace.create', { ...args, name: args.name.trim() }, {});
      await ctx.store.teamspaces.insert(
        { workspaceId: ctx.workspaceId, ...args, name: args.name.trim(), createdAt: ctx.now },
        ctx.actor.id,
      );
      for (const change of changes) ctx.emit(change);
      ctx.access('teamspace', args.id, [ctx.actor.id]);
    }),

    'teamspace.update': first(async (ctx, args) => {
      const { teamspace, tsCtx } = await teamspaceContext(ctx, args.id);
      if (!canManageTeamspace(tsCtx)) throw new DomainError('forbidden');
      const { id, ...patch } = args;
      if (patch.name !== undefined) patch.name = patch.name.trim();
      const [change] = ctx.apply(
        'teamspace.update',
        { id, ...patch },
        { teamspace: [toTeamspaceEntity(teamspace)] },
      );
      await ctx.store.teamspaces.update(ctx.workspaceId, id, patch);
      ctx.emit(change!);
      if (patch.visibility !== undefined || patch.defaultLevel !== undefined)
        ctx.access('teamspace', id);
    }),

    'teamspace.join': first(async (ctx, args) => {
      const { tsCtx } = await teamspaceContext(ctx, args.teamspaceId);
      const error = checkTeamspaceJoin(tsCtx);
      if (error) throw new DomainError(error);
      await ctx.store.teamspaces.addMember({
        workspaceId: ctx.workspaceId,
        teamspaceId: args.teamspaceId,
        userId: ctx.actor.id,
        role: 'member',
        createdAt: ctx.now,
      });
      emitTeamspaceMember(ctx, args.teamspaceId, ctx.actor.id, 'member');
    }),

    'teamspace.addMember': first(async (ctx, args) => {
      const { tsCtx } = await teamspaceContext(ctx, args.teamspaceId);
      if (!canManageTeamspace(tsCtx)) throw new DomainError('forbidden');
      const target = await ctx.store.workspaces.membership(ctx.workspaceId, args.userId);
      if (!target) throw new DomainError('not_found');
      if (!canBeTeamspaceMember(target.role)) throw new DomainError('forbidden');
      if (await ctx.store.teamspaces.membership(ctx.workspaceId, args.teamspaceId, args.userId))
        throw new DomainError('already_member');
      await ctx.store.teamspaces.addMember({
        workspaceId: ctx.workspaceId,
        teamspaceId: args.teamspaceId,
        userId: args.userId,
        role: args.role,
        createdAt: ctx.now,
      });
      emitTeamspaceMember(ctx, args.teamspaceId, args.userId, args.role);
    }),

    'teamspace.setMemberRole': first(async (ctx, args) => {
      const { tsCtx } = await teamspaceContext(ctx, args.teamspaceId);
      const target = await ctx.store.teamspaces.membership(
        ctx.workspaceId,
        args.teamspaceId,
        args.userId,
      );
      if (!target) throw new DomainError('not_found');
      if (target.role === args.role) return;
      const error = checkTeamspaceRoleChange({
        actor: tsCtx,
        actorIsTarget: ctx.actor.id === args.userId,
        targetRole: target.role,
        newRole: args.role,
        ownerCount: await ctx.store.teamspaces.countOwners(ctx.workspaceId, args.teamspaceId),
      });
      if (error) throw new DomainError(error);
      await ctx.store.teamspaces.setMemberRole(
        ctx.workspaceId,
        args.teamspaceId,
        args.userId,
        args.role,
      );
      emitTeamspaceMember(ctx, args.teamspaceId, args.userId, args.role);
    }),

    /** Removes a member, or leaves when `userId` is the actor. */
    'teamspace.removeMember': first(async (ctx, args) => {
      const { tsCtx } = await teamspaceContext(ctx, args.teamspaceId);
      const target = await ctx.store.teamspaces.membership(
        ctx.workspaceId,
        args.teamspaceId,
        args.userId,
      );
      if (!target) throw new DomainError('not_found');
      const error = checkTeamspaceMemberRemoval({
        actor: tsCtx,
        actorIsTarget: ctx.actor.id === args.userId,
        targetRole: target.role,
        ownerCount: await ctx.store.teamspaces.countOwners(ctx.workspaceId, args.teamspaceId),
      });
      if (error) throw new DomainError(error);
      await ctx.store.teamspaces.removeMember(ctx.workspaceId, args.teamspaceId, args.userId);
      emitTeamspaceMember(ctx, args.teamspaceId, args.userId, null);
    }),

    'member.setRole': first(async (ctx, args) => {
      const target = await ctx.store.workspaces.membership(ctx.workspaceId, args.userId);
      if (!target) throw new DomainError('not_found');
      if (target.role === args.role) return;
      const error = checkRoleChange({
        actorRole: ctx.member.role,
        actorIsTarget: ctx.actor.id === args.userId,
        targetRole: target.role,
        newRole: args.role,
        ownerCount: await ctx.store.workspaces.countOwners(ctx.workspaceId),
      });
      if (error) throw new DomainError(error);
      await ctx.store.workspaces.setMemberRole(ctx.workspaceId, args.userId, args.role);
      // Guests cannot be teamspace members.
      if (args.role === 'guest') await leaveAllTeamspaces(ctx, args.userId);
      await emitMember(ctx, args.userId);
      ctx.access('workspace', ctx.workspaceId, [args.userId]);
    }),

    /** Removes a member, or leaves the workspace when `userId` is the actor. */
    'member.remove': first(async (ctx, args) => {
      const target = await ctx.store.workspaces.membership(ctx.workspaceId, args.userId);
      if (!target) throw new DomainError('not_found');
      const error = checkMemberRemoval({
        actorRole: ctx.member.role,
        actorIsTarget: ctx.actor.id === args.userId,
        targetRole: target.role,
        ownerCount: await ctx.store.workspaces.countOwners(ctx.workspaceId),
      });
      if (error) throw new DomainError(error);
      await leaveAllTeamspaces(ctx, args.userId);
      await ctx.store.workspaces.removeMember(ctx.workspaceId, args.userId);
      ctx.emit({ type: 'member', id: args.userId, op: 'delete' });
      ctx.access('workspace', ctx.workspaceId, [args.userId]);
      ctx.afterCommit(() =>
        bus.publish({ type: 'kick', workspaceId: ctx.workspaceId, userId: args.userId }),
      );
    }),
  };
}
