// SPDX-License-Identifier: AGPL-3.0-only
import {
  canManageWorkspace,
  checkMemberRemoval,
  checkRoleChange,
  DomainError,
  newId,
  type CreateWorkspaceInput,
  type MemberDto,
  type Page,
  type PaginationQuery,
  type UpdateWorkspaceInput,
  type WorkspaceDto,
  type WorkspaceRole,
} from '@ardoise/shared';
import type { Clock } from '../common/clock.js';
import type { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { MemberRecord, Store, UserRecord } from '../store/store.js';

/** A user belongs to a bounded number of workspaces in the switcher. */
export const MAX_WORKSPACES_PER_USER = 500;

/**
 * `workspaces` module: workspaces and members (REST until M2, ADR 0005).
 * Non-members get `not_found`, so workspace ids do not leak.
 */
export class WorkspaceService {
  constructor(
    private readonly store: Store,
    private readonly settings: InstanceSettingsService,
    private readonly clock: Clock,
  ) {}

  async requireMember(
    workspaceId: string,
    userId: string,
    store: Store = this.store,
  ): Promise<MemberRecord> {
    const member = await store.workspaces.membership(workspaceId, userId);
    if (!member) throw new DomainError('not_found');
    return member;
  }

  async requireManager(
    workspaceId: string,
    userId: string,
    store: Store = this.store,
  ): Promise<MemberRecord> {
    const member = await this.requireMember(workspaceId, userId, store);
    if (!canManageWorkspace(member.role)) throw new DomainError('forbidden');
    return member;
  }

  async listMine(userId: string): Promise<WorkspaceDto[]> {
    const rows = await this.store.workspaces.listForUser(userId, MAX_WORKSPACES_PER_USER);
    return rows.map((w) => ({ id: w.id, name: w.name, icon: w.icon, role: w.role }));
  }

  async create(actor: UserRecord, input: CreateWorkspaceInput): Promise<WorkspaceDto> {
    const general = await this.settings.general();
    if (general.workspaceCreation === 'super_admins' && !actor.isSuperAdmin)
      throw new DomainError('workspace_creation_disabled');
    const workspace = {
      id: newId(),
      name: input.name.trim(),
      icon: input.icon ?? null,
      createdAt: this.clock.now(),
    };
    await this.store.transaction((store) => store.workspaces.create(workspace, actor.id));
    return { id: workspace.id, name: workspace.name, icon: workspace.icon, role: 'owner' };
  }

  async get(actor: UserRecord, workspaceId: string): Promise<WorkspaceDto> {
    const member = await this.requireMember(workspaceId, actor.id);
    const workspace = await this.store.workspaces.findById(workspaceId);
    if (!workspace) throw new DomainError('not_found');
    return { id: workspace.id, name: workspace.name, icon: workspace.icon, role: member.role };
  }

  async update(
    actor: UserRecord,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<WorkspaceDto> {
    await this.requireManager(workspaceId, actor.id);
    await this.store.workspaces.update(workspaceId, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.icon !== undefined && { icon: input.icon }),
    });
    return this.get(actor, workspaceId);
  }

  /** Guests only see pages shared with them, not the member directory. */
  async listMembers(
    actor: UserRecord,
    workspaceId: string,
    query: PaginationQuery,
  ): Promise<Page<MemberDto>> {
    const member = await this.requireMember(workspaceId, actor.id);
    if (member.role === 'guest') throw new DomainError('forbidden');
    const page = await this.store.workspaces.listMembers(workspaceId, query);
    return {
      items: page.items.map((m) => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async changeRole(
    actor: UserRecord,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await this.store.withLock(`workspace-members:${workspaceId}`, async (store) => {
      const actorMember = await this.requireMember(workspaceId, actor.id, store);
      const target = await store.workspaces.membership(workspaceId, userId);
      if (!target) throw new DomainError('not_found');
      if (target.role === role) return;
      const error = checkRoleChange({
        actorRole: actorMember.role,
        actorIsTarget: actor.id === userId,
        targetRole: target.role,
        newRole: role,
        ownerCount: await store.workspaces.countOwners(workspaceId),
      });
      if (error) throw new DomainError(error);
      await store.workspaces.setMemberRole(workspaceId, userId, role);
      // Guests cannot be teamspace members.
      if (role === 'guest') await store.teamspaces.removeUserEverywhere(workspaceId, userId);
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }

  /** Removes a member, or leaves the workspace when `userId` is the actor. */
  async removeMember(actor: UserRecord, workspaceId: string, userId: string): Promise<void> {
    await this.store.withLock(`workspace-members:${workspaceId}`, async (store) => {
      const actorMember = await this.requireMember(workspaceId, actor.id, store);
      const target = await store.workspaces.membership(workspaceId, userId);
      if (!target) throw new DomainError('not_found');
      const error = checkMemberRemoval({
        actorRole: actorMember.role,
        actorIsTarget: actor.id === userId,
        targetRole: target.role,
        ownerCount: await store.workspaces.countOwners(workspaceId),
      });
      if (error) throw new DomainError(error);
      await store.workspaces.removeMember(workspaceId, userId);
      await store.workspaces.bumpPermEpoch(workspaceId);
    });
  }
}
