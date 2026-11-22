// SPDX-License-Identifier: AGPL-3.0-only
import {
  DomainError,
  type AdminUserDto,
  type AdminWorkspaceDto,
  type Page,
  type PaginationQuery,
  type UpdateAdminUserInput,
} from '@ardoise/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { Clock } from '../common/clock.js';
import type { Store, UserRecord } from '../store/store.js';

export function toAdminUser(user: UserRecord): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** `admin` module: users and workspaces of the instance (super-admins only). */
export class AdminService {
  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly clock: Clock,
  ) {}

  private requireSuperAdmin(actor: UserRecord): void {
    if (!actor.isSuperAdmin) throw new DomainError('forbidden');
  }

  async listUsers(actor: UserRecord, query: PaginationQuery): Promise<Page<AdminUserDto>> {
    this.requireSuperAdmin(actor);
    const page = await this.store.users.list(query);
    return { items: page.items.map(toAdminUser), nextCursor: page.nextCursor };
  }

  async updateUser(
    actor: UserRecord,
    userId: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserDto> {
    this.requireSuperAdmin(actor);
    return this.store.withLock('super-admins', async (store) => {
      const target = await store.users.findById(userId);
      if (!target) throw new DomainError('not_found');
      const demotes = input.isSuperAdmin === false && target.isSuperAdmin;
      const disables = input.disabled === true && target.disabledAt === null;
      if (target.id === actor.id && (demotes || disables)) throw new DomainError('self_action');
      if (target.isSuperAdmin && !target.disabledAt && (demotes || disables)) {
        if ((await store.users.countActiveSuperAdmins()) <= 1)
          throw new DomainError('last_super_admin');
      }
      const patch: Partial<UserRecord> = {};
      if (input.isSuperAdmin !== undefined) patch.isSuperAdmin = input.isSuperAdmin;
      if (input.disabled !== undefined)
        patch.disabledAt = input.disabled ? (target.disabledAt ?? this.clock.now()) : null;
      await store.users.update(userId, patch);
      if (disables) await this.auth.revokeAllSessions(userId, undefined, store);
      else await this.auth.evictUser(userId, store);
      return toAdminUser({ ...target, ...patch });
    });
  }

  async deleteUser(actor: UserRecord, userId: string): Promise<void> {
    this.requireSuperAdmin(actor);
    if (userId === actor.id) throw new DomainError('self_action');
    await this.store.withLock('super-admins', async (store) => {
      const target = await store.users.findById(userId);
      if (!target) throw new DomainError('not_found');
      if (
        target.isSuperAdmin &&
        !target.disabledAt &&
        (await store.users.countActiveSuperAdmins()) <= 1
      )
        throw new DomainError('last_super_admin');
      if ((await store.workspaces.soleOwnerWorkspaces(userId)).length > 0)
        throw new DomainError('sole_workspace_owner');
      await this.auth.revokeAllSessions(userId, undefined, store);
      await store.users.delete(userId);
    });
  }

  async listWorkspaces(
    actor: UserRecord,
    query: PaginationQuery,
  ): Promise<Page<AdminWorkspaceDto>> {
    this.requireSuperAdmin(actor);
    const page = await this.store.workspaces.listAll(query);
    return {
      items: page.items.map((w) => ({
        id: w.id,
        name: w.name,
        icon: w.icon,
        memberCount: w.memberCount,
        createdAt: w.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
