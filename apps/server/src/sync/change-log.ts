// SPDX-License-Identifier: AGPL-3.0-only
import type { Change } from '@ardoise/shared';
import type { ChangeLogRow, Store } from '../store/store.js';
import type { EntryScope } from './mutation.service.js';

/**
 * Appends entries with consecutive seqs. The counter row stays locked until the
 * transaction ends, which keeps seqs gap-free and in commit order (§4.8).
 */
export async function appendEntries(
  store: Store,
  workspaceId: string,
  entries: readonly { change: Change; scope: EntryScope }[],
  meta: { mutationId: string | null; actorId: string | null; at: Date },
): Promise<number | undefined> {
  if (entries.length === 0) return undefined;
  const last = await store.changeLog.allocate(workspaceId, entries.length);
  const first = last - entries.length + 1;
  const rows: ChangeLogRow[] = entries.map(({ change, scope }, i) => ({
    workspaceId,
    seq: first + i,
    entityType: change.type,
    entityId: change.id,
    pageId: scope.pageId ?? null,
    userId: scope.userId ?? null,
    op: change.op,
    data: change.op === 'upsert' ? change.data : null,
    mutationId: meta.mutationId,
    actorId: meta.actorId,
    createdAt: meta.at,
  }));
  await store.changeLog.append(rows);
  return last;
}
