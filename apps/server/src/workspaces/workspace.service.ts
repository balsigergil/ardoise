// SPDX-License-Identifier: AGPL-3.0-only
import {
  canManageWorkspace,
  DomainError,
  newId,
  type CreateWorkspaceInput,
  type MemberDto,
  type Page,
  type PaginationQuery,
  type WorkspaceDto,
} from '@ardoise/shared';
import type { Clock } from '../common/clock.js';
import type { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { MemberRecord, Store, UserRecord, WorkspaceRecord } from '../store/store.js';

/** A user belongs to a bounded number of workspaces in the switcher. */
export const MAX_WORKSPACES_PER_USER = 500;

/**
 * Creates a workspace with its owner and its default open teamspace, named after it
 * (ADR 0006). Workspace creation stays REST (ADR 0005).
 */
export async function createWorkspaceRecords(
  store: Store,
  workspace: WorkspaceRecord,
  ownerId: string,
): Promise<void> {
  await store.workspaces.create(workspace, ownerId);
  await store.teamspaces.insert(
    {
      workspaceId: workspace.id,
      id: newId(),
      name: workspace.name,
      icon: workspace.icon,
      description: '',
      visibility: 'open',
      defaultLevel: 'can_edit',
      createdAt: workspace.createdAt,
    },
    ownerId,
  );
}

/**
 * `workspaces` module: workspace creation and reads. Writes inside a workspace are
 * mutations (`workspace-mutations.ts`, ADR 0005).
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
    await this.store.transaction((store) => createWorkspaceRecords(store, workspace, actor.id));
    return { id: workspace.id, name: workspace.name, icon: workspace.icon, role: 'owner' };
  }

  async get(actor: UserRecord, workspaceId: string): Promise<WorkspaceDto> {
    const member = await this.requireMember(workspaceId, actor.id);
    const workspace = await this.store.workspaces.findById(workspaceId);
    if (!workspace) throw new DomainError('not_found');
    return { id: workspace.id, name: workspace.name, icon: workspace.icon, role: member.role };
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
}
