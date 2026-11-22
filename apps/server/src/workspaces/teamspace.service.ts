// SPDX-License-Identifier: AGPL-3.0-only
import {
  canBeTeamspaceMember,
  canManageTeamspace,
  canSeeTeamspace,
  checkTeamspaceJoin,
  checkTeamspaceMemberRemoval,
  checkTeamspaceRoleChange,
  DomainError,
  newId,
  type AddTeamspaceMemberInput,
  type CreateTeamspaceInput,
  type Page,
  type PaginationQuery,
  type TeamspaceContext,
  type TeamspaceDto,
  type TeamspaceMemberDto,
  type TeamspaceRole,
  type UpdateTeamspaceInput,
} from '@ardoise/shared';
import type { Clock } from '../common/clock.js';
import type { Store, TeamspaceRecord, TeamspaceWithStats, UserRecord } from '../store/store.js';
import type { WorkspaceService } from './workspace.service.js';

function toDto(t: TeamspaceWithStats, ctx: TeamspaceContext): TeamspaceDto {
  return {
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    visibility: t.visibility,
    defaultLevel: t.defaultLevel,
    myRole: t.myRole,
    canManage: canManageTeamspace(ctx),
    memberCount: t.memberCount,
  };
}

/** `workspaces` module: teamspaces and their members (REST until M2, ADR 0005). */
export class TeamspaceService {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceService,
    private readonly clock: Clock,
  ) {}

  private async context(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    store: Store = this.store,
  ): Promise<{ teamspace: TeamspaceRecord; ctx: TeamspaceContext }> {
    const member = await this.workspaces.requireMember(workspaceId, actor.id, store);
    const teamspace = await store.teamspaces.findById(workspaceId, teamspaceId);
    if (!teamspace) throw new DomainError('not_found');
    const own = await store.teamspaces.membership(workspaceId, teamspaceId, actor.id);
    const ctx = {
      workspaceRole: member.role,
      teamspaceRole: own?.role,
      visibility: teamspace.visibility,
    };
    if (!canSeeTeamspace(ctx)) throw new DomainError('not_found');
    return { teamspace, ctx };
  }

  async list(
    actor: UserRecord,
    workspaceId: string,
    query: PaginationQuery & { mine?: boolean },
  ): Promise<Page<TeamspaceDto>> {
    const member = await this.workspaces.requireMember(workspaceId, actor.id);
    if (member.role === 'guest') return { items: [], nextCursor: null };
    const scope = query.mine
      ? 'mine'
      : member.role === 'owner' || member.role === 'admin'
        ? 'all'
        : 'visible';
    const page = await this.store.teamspaces.listVisible(workspaceId, actor.id, scope, query);
    return {
      items: page.items.map((t) =>
        toDto(t, {
          workspaceRole: member.role,
          teamspaceRole: t.myRole ?? undefined,
          visibility: t.visibility,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async get(actor: UserRecord, workspaceId: string, teamspaceId: string): Promise<TeamspaceDto> {
    const { teamspace, ctx } = await this.context(actor, workspaceId, teamspaceId);
    const stats = await this.stats(actor.id, teamspace);
    return toDto(stats, ctx);
  }

  private async stats(userId: string, teamspace: TeamspaceRecord): Promise<TeamspaceWithStats> {
    const own = await this.store.teamspaces.membership(teamspace.workspaceId, teamspace.id, userId);
    const memberCount = await this.store.teamspaces.countMembers(
      teamspace.workspaceId,
      teamspace.id,
    );
    return { ...teamspace, myRole: own?.role ?? null, memberCount };
  }

  /** Only workspace owners and admins create teamspaces; the creator becomes owner. */
  async create(
    actor: UserRecord,
    workspaceId: string,
    input: CreateTeamspaceInput,
  ): Promise<TeamspaceDto> {
    const member = await this.workspaces.requireManager(workspaceId, actor.id);
    const teamspace: TeamspaceRecord = {
      workspaceId,
      id: newId(),
      name: input.name.trim(),
      icon: input.icon ?? null,
      description: input.description ?? '',
      visibility: input.visibility ?? 'open',
      defaultLevel: input.defaultLevel ?? 'can_edit',
      createdAt: this.clock.now(),
    };
    await this.store.transaction(async (store) => {
      await store.teamspaces.insert(teamspace, actor.id);
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
    return toDto(
      { ...teamspace, myRole: 'owner', memberCount: 1 },
      { workspaceRole: member.role, teamspaceRole: 'owner', visibility: teamspace.visibility },
    );
  }

  async update(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    input: UpdateTeamspaceInput,
  ): Promise<TeamspaceDto> {
    const { ctx } = await this.context(actor, workspaceId, teamspaceId);
    if (!canManageTeamspace(ctx)) throw new DomainError('forbidden');
    await this.store.transaction(async (store) => {
      await store.teamspaces.update(workspaceId, teamspaceId, {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.visibility !== undefined && { visibility: input.visibility }),
        ...(input.defaultLevel !== undefined && { defaultLevel: input.defaultLevel }),
      });
      if (input.visibility !== undefined || input.defaultLevel !== undefined)
        await store.workspaces.bumpPermEpoch(workspaceId);
    });
    return this.get(actor, workspaceId, teamspaceId);
  }

  async join(actor: UserRecord, workspaceId: string, teamspaceId: string): Promise<void> {
    const { ctx } = await this.context(actor, workspaceId, teamspaceId);
    const error = checkTeamspaceJoin(ctx);
    if (error) throw new DomainError(error);
    await this.store.transaction(async (store) => {
      await store.teamspaces.addMember({
        workspaceId,
        teamspaceId,
        userId: actor.id,
        role: 'member',
        createdAt: this.clock.now(),
      });
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }

  async listMembers(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    query: PaginationQuery,
  ): Promise<Page<TeamspaceMemberDto>> {
    await this.context(actor, workspaceId, teamspaceId);
    const page = await this.store.teamspaces.listMembers(workspaceId, teamspaceId, query);
    return {
      items: page.items.map((m) => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async addMember(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    input: AddTeamspaceMemberInput,
  ): Promise<void> {
    const { ctx } = await this.context(actor, workspaceId, teamspaceId);
    if (!canManageTeamspace(ctx)) throw new DomainError('forbidden');
    const target = await this.store.workspaces.membership(workspaceId, input.userId);
    if (!target) throw new DomainError('not_found');
    if (!canBeTeamspaceMember(target.role)) throw new DomainError('forbidden');
    if (await this.store.teamspaces.membership(workspaceId, teamspaceId, input.userId))
      throw new DomainError('already_member');
    await this.store.transaction(async (store) => {
      await store.teamspaces.addMember({
        workspaceId,
        teamspaceId,
        userId: input.userId,
        role: input.role ?? 'member',
        createdAt: this.clock.now(),
      });
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }

  async changeRole(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    userId: string,
    role: TeamspaceRole,
  ): Promise<void> {
    await this.store.withLock(`teamspace-members:${workspaceId}:${teamspaceId}`, async (store) => {
      const { ctx } = await this.context(actor, workspaceId, teamspaceId, store);
      const target = await store.teamspaces.membership(workspaceId, teamspaceId, userId);
      if (!target) throw new DomainError('not_found');
      if (target.role === role) return;
      const error = checkTeamspaceRoleChange({
        actor: ctx,
        actorIsTarget: actor.id === userId,
        targetRole: target.role,
        newRole: role,
        ownerCount: await store.teamspaces.countOwners(workspaceId, teamspaceId),
      });
      if (error) throw new DomainError(error);
      await store.teamspaces.setMemberRole(workspaceId, teamspaceId, userId, role);
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }

  /** Removes a member, or leaves when `userId` is the actor. */
  async removeMember(
    actor: UserRecord,
    workspaceId: string,
    teamspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.store.withLock(`teamspace-members:${workspaceId}:${teamspaceId}`, async (store) => {
      const { ctx } = await this.context(actor, workspaceId, teamspaceId, store);
      const target = await store.teamspaces.membership(workspaceId, teamspaceId, userId);
      if (!target) throw new DomainError('not_found');
      const error = checkTeamspaceMemberRemoval({
        actor: ctx,
        actorIsTarget: actor.id === userId,
        targetRole: target.role,
        ownerCount: await store.teamspaces.countOwners(workspaceId, teamspaceId),
      });
      if (error) throw new DomainError(error);
      await store.teamspaces.removeMember(workspaceId, teamspaceId, userId);
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }
}
