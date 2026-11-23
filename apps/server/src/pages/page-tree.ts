// SPDX-License-Identifier: AGPL-3.0-only
/** Subtree operations shared by mutations and jobs (ARCHITECTURE §4.3, ADR 0003 item 5). */
import { copyDocuments } from './page-content.js';
import { DomainError, MAX_PAGE_DEPTH, newId, uuidToLabel } from '@ardoise/shared';
import type { PageRecord, Store, SubtreeCursor } from '../store/store.js';

/** Subtrees above this size are moved or duplicated by a job. */
export const SUBTREE_INLINE_LIMIT = 2000;
export const SUBTREE_CHUNK = 1000;

const under = (path: string, root: string) => path === root || path.startsWith(`${root}.`);

/** The path of `id` placed under `parent` (null for a section root). */
export function childPath(parent: PageRecord | null, id: string): string {
  const label = uuidToLabel(id);
  if (!parent) return label;
  const path = `${parent.path}.${label}`;
  if (path.split('.').length > MAX_PAGE_DEPTH) throw new DomainError('too_deep');
  return path;
}

/**
 * Rejects structural changes to a subtree that contains a page being moved or
 * duplicated, or the destination of one (`page_moving`).
 */
export async function assertNotBusy(store: Store, page: PageRecord): Promise<void> {
  const moving = await store.pages.movingRoots(page.workspaceId);
  if (moving.length === 0) return;
  const parentIds = moving.filter((m) => m.parentKind === 'page').map((m) => m.parentId);
  const parents = new Map(
    (await store.pages.findMany(page.workspaceId, parentIds)).map((p) => [p.id, p]),
  );
  for (const m of moving) {
    if (under(m.path, page.path)) throw new DomainError('page_moving');
    const target = parents.get(m.parentId);
    if (target && under(target.path, page.path)) throw new DomainError('page_moving');
  }
}

/**
 * Copies the descendants of `source` under `copy` with new ids, keeping their order,
 * options and grants. Pages whose parent was not copied (moved away meanwhile) are
 * skipped with their subtree. Returns the number of pages copied.
 */
export async function copyDescendants(
  store: Store,
  source: PageRecord,
  copy: PageRecord,
  actorId: string,
  now: Date,
): Promise<number> {
  const ws = source.workspaceId;
  const ids = new Map<string, PageRecord>([[source.id, copy]]);
  let after: SubtreeCursor | null = {
    depth: source.path.split('.').length,
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  };
  let copied = 0;
  for (;;) {
    const batch = await store.pages.subtreeBatch(ws, source.path, after, SUBTREE_CHUNK);
    if (batch.length === 0) break;
    const inserts: PageRecord[] = [];
    const sourceIds: string[] = [];
    for (const page of batch) {
      const parent = ids.get(page.parentId);
      if (!parent || page.deletedAt) continue;
      const id = newId();
      const { depth: _depth, ...fields } = page;
      const record: PageRecord = {
        ...fields,
        id,
        parentId: parent.id,
        path: `${parent.path}.${uuidToLabel(id)}`,
        moveState: null,
        isLocked: false,
        createdBy: actorId,
        createdAt: now,
        updatedBy: actorId,
        updatedAt: now,
        deletedAt: null,
        deletedRootId: null,
      };
      ids.set(page.id, record);
      inserts.push(record);
      sourceIds.push(page.id);
    }
    await store.pages.insertMany(inserts);
    const grants = await store.grants.forPages(ws, sourceIds);
    await store.grants.insertMany(
      ws,
      grants.map((g) => ({
        ...g,
        pageId: ids.get(g.pageId)!.id,
        createdBy: actorId,
        createdAt: now,
      })),
    );
    copied += inserts.length;
    const last = batch[batch.length - 1]!;
    after = { depth: last.depth, id: last.id };
  }
  // Content last, once every copy exists, so child page blocks can point to copies.
  const pageIds = new Map([...ids].map(([sourceId, record]) => [sourceId, record.id]));
  await copyDocuments(
    store,
    ws,
    [...ids].map(([sourceId, record]) => [sourceId, record.id, record.title] as const),
    pageIds,
    now,
  );
  return copied;
}
