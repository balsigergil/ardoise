// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /sync/pull` (ARCHITECTURE §7): change-log entries after a cursor, filtered by
 * the delivery rules of ADR 0006 item 5.
 */
import {
  atLeast,
  canSeeTeamspace,
  DomainError,
  type ChangeEntry,
  type PullQuery,
  type PullResponse,
} from '@ardoise/shared';
import type { PermissionService } from '../permissions/permission.service.js';
import type { ChangeLogRow, Store, UserRecord } from '../store/store.js';

const PAGE_GOVERNED = new Set(['page', 'grant', 'publicLink']);
const TEAMSPACE_TYPES = new Set(['teamspace', 'teamspaceMember']);

function teamspaceIdOf(row: ChangeLogRow): string {
  return row.entityType === 'teamspace' ? row.entityId : row.entityId.split(':')[0]!;
}

export class PullService {
  constructor(
    private readonly store: Store,
    private readonly permissions: PermissionService,
  ) {}

  async pull(actor: UserRecord, query: PullQuery): Promise<PullResponse> {
    const { workspace: workspaceId, since, limit } = query;
    const member = await this.store.workspaces.membership(workspaceId, actor.id);
    if (!member) throw new DomainError('not_found');

    const current = await this.store.changeLog.currentSeq(workspaceId);
    const min = await this.store.changeLog.minSeq(workspaceId);
    // A cursor ahead of the server (restored database) or older than the retained log.
    if (since > current || (min === null ? since < current : since < min - 1)) {
      throw new DomainError('resync_required');
    }

    const rows = await this.store.changeLog.since(workspaceId, since, limit);
    const subject = await this.permissions.subject(workspaceId, actor.id, member.role);

    // Page-governed entries: one batched permission check per distinct page.
    const pageIds = new Set<string>();
    for (const row of rows) {
      if (row.userId && row.userId !== actor.id) continue;
      if (row.entityType === 'page' && row.op === 'delete') continue;
      if (row.pageId && PAGE_GOVERNED.has(row.entityType)) pageIds.add(row.pageId);
    }
    const pages = await this.store.pages.findMany(workspaceId, [...pageIds]);
    const levels = await this.permissions.levels(workspaceId, subject, pages);

    const teamspaceIds = new Set(
      rows.filter((r) => TEAMSPACE_TYPES.has(r.entityType)).map(teamspaceIdOf),
    );
    const teamspaces = new Map(
      (await this.store.teamspaces.findMany(workspaceId, [...teamspaceIds])).map((t) => [t.id, t]),
    );

    const visible = (row: ChangeLogRow): boolean => {
      if (row.userId) return row.userId === actor.id;
      if (row.entityType === 'page' && row.op === 'delete') return true;
      if (PAGE_GOVERNED.has(row.entityType)) {
        return row.pageId !== null && atLeast(levels.get(row.pageId) ?? 'no_access', 'can_view');
      }
      if (TEAMSPACE_TYPES.has(row.entityType)) {
        // Users always learn about their own memberships, even after leaving.
        if (row.entityType === 'teamspaceMember' && row.entityId.endsWith(`:${actor.id}`))
          return true;
        const teamspace = teamspaces.get(teamspaceIdOf(row));
        return (
          teamspace !== undefined &&
          canSeeTeamspace({
            workspaceRole: member.role,
            teamspaceRole: subject.teamspaceRoles.get(teamspace.id),
            visibility: teamspace.visibility,
          })
        );
      }
      // The member directory is hidden from guests, except their own entry.
      if (row.entityType === 'member') return member.role !== 'guest' || row.entityId === actor.id;
      return true; // workspace, access
    };

    const entries: ChangeEntry[] = rows.filter(visible).map(
      (row) =>
        ({
          seq: row.seq,
          type: row.entityType,
          id: row.entityId,
          op: row.op,
          ...(row.op === 'upsert' && { data: row.data }),
        }) as ChangeEntry,
    );
    return {
      entries,
      cursor: rows.length > 0 ? rows[rows.length - 1]!.seq : since,
      hasMore: rows.length === limit,
    };
  }
}
