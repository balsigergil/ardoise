// SPDX-License-Identifier: AGPL-3.0-only
import {
  canManageTeamspace,
  canSeeTeamspace,
  DomainError,
  type Page,
  type PaginationQuery,
  type TeamspaceContext,
  type TeamspaceDto,
  type TeamspaceMemberDto,
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

/** `workspaces` module: teamspace reads. Writes are mutations (`workspace-mutations.ts`). */
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
}
