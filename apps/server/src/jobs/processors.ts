// SPDX-License-Identifier: AGPL-3.0-only
/** Framework-free job processors (worker role). */
import type { Logger } from '@nestjs/common';
import type { Clock } from '../common/clock.js';
import { toPageDto } from '../pages/page-dto.js';
import { childPath, copyDescendants, SUBTREE_CHUNK } from '../pages/page-tree.js';
import type { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { Store } from '../store/store.js';
import { appendEntries } from '../sync/change-log.js';
import type { SyncEventBus } from '../sync/pokes.js';
import type { JobName, JobPayloads } from './jobs.js';

/** Change-log retention (ARCHITECTURE §4.8). */
export const CHANGE_LOG_HORIZON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export class JobProcessors {
  constructor(
    private readonly store: Store,
    private readonly settings: InstanceSettingsService,
    private readonly bus: SyncEventBus,
    private readonly clock: Clock,
    private readonly logger: Pick<Logger, 'log' | 'warn'>,
  ) {}

  async run<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    switch (name) {
      case 'page.moveSubtree':
        return this.moveSubtree(data as JobPayloads['page.moveSubtree']);
      case 'page.duplicateSubtree':
        return this.duplicateSubtree(data as JobPayloads['page.duplicateSubtree']);
      case 'trash.purgeExpired':
        await this.purgeExpiredTrash();
        return;
      case 'changeLog.purge':
        await this.purgeChangeLog();
        return;
    }
  }

  private async poke(workspaceId: string, seq: number | undefined): Promise<void> {
    if (seq !== undefined) await this.bus.publish({ type: 'poke', workspaceId, seq });
  }

  /**
   * Rewrites the descendants' paths in chunks outside the counter lock, then the root's
   * path last, which ends the pre-move permission window (ADR 0003 item 5).
   */
  async moveSubtree({
    workspaceId,
    pageId,
    actorId,
  }: JobPayloads['page.moveSubtree']): Promise<void> {
    const page = await this.store.pages.findById(workspaceId, pageId);
    if (!page || page.moveState !== 'moving') return;
    const parent =
      page.parentKind === 'page'
        ? await this.store.pages.findById(workspaceId, page.parentId)
        : null;
    const newPath = childPath(parent ?? null, page.id);
    let moved = 0;
    for (;;) {
      const n = await this.store.pages.rewritePaths(workspaceId, page.path, newPath, {
        limit: SUBTREE_CHUNK,
        excludeId: page.id,
      });
      moved += n;
      if (n === 0) break;
    }
    const seq = await this.store.transaction(async (store) => {
      await store.changeLog.lockCounter(workspaceId);
      // Catches pages created under not-yet-rewritten parents, and the root itself.
      await store.pages.rewritePaths(workspaceId, page.path, newPath);
      const now = this.clock.now();
      await store.pages.update(workspaceId, page.id, { moveState: null, updatedAt: now });
      await store.workspaces.bumpPermEpoch(workspaceId);
      const updated = (await store.pages.findById(workspaceId, page.id))!;
      const hasChildren = (await store.pages.withChildren(workspaceId, [page.id])).has(page.id);
      return appendEntries(
        store,
        workspaceId,
        [
          {
            change: {
              type: 'page',
              id: page.id,
              op: 'upsert',
              data: toPageDto(updated, hasChildren),
            },
            scope: { pageId: page.id },
          },
          {
            change: {
              type: 'access',
              id: `move:${page.id}:${now.getTime()}`,
              op: 'upsert',
              data: { scope: 'page', id: page.id, userIds: null },
            },
            scope: {},
          },
        ],
        { mutationId: null, actorId, at: now },
      );
    });
    this.logger.log(`moved subtree of ${pageId} (${moved + 1} pages)`);
    await this.poke(workspaceId, seq);
  }

  async duplicateSubtree({
    workspaceId,
    sourceId,
    newId,
    actorId,
  }: JobPayloads['page.duplicateSubtree']): Promise<void> {
    const copy = await this.store.pages.findById(workspaceId, newId);
    const source = await this.store.pages.findById(workspaceId, sourceId);
    if (!copy || copy.moveState !== 'moving') return;
    // A retried job must not copy twice.
    const started = (await this.store.pages.withChildren(workspaceId, [copy.id])).has(copy.id);
    if (source && !started)
      await copyDescendants(this.store, source, copy, actorId, this.clock.now());
    const seq = await this.store.transaction(async (store) => {
      await store.changeLog.lockCounter(workspaceId);
      const now = this.clock.now();
      await store.pages.update(workspaceId, copy.id, { moveState: null, updatedAt: now });
      const updated = (await store.pages.findById(workspaceId, copy.id))!;
      const hasChildren = (await store.pages.withChildren(workspaceId, [copy.id])).has(copy.id);
      return appendEntries(
        store,
        workspaceId,
        [
          {
            change: {
              type: 'page',
              id: copy.id,
              op: 'upsert',
              data: toPageDto(updated, hasChildren),
            },
            scope: { pageId: copy.id },
          },
        ],
        { mutationId: null, actorId, at: now },
      );
    });
    await this.poke(workspaceId, seq);
  }

  /** Purges trash roots past the retention period, one subtree per transaction. */
  async purgeExpiredTrash(): Promise<number> {
    const { trashRetentionDays } = await this.settings.limits();
    const before = new Date(this.clock.now().getTime() - trashRetentionDays * DAY_MS);
    let purged = 0;
    for (;;) {
      const roots = await this.store.pages.expiredTrashRoots(before, 100);
      if (roots.length === 0) break;
      for (const root of roots) {
        const seq = await this.store.transaction(async (store) => {
          await store.changeLog.lockCounter(root.workspaceId);
          await store.files.markDeletedUnder(root.workspaceId, root.path, this.clock.now());
          await store.pages.purgeSubtree(root.workspaceId, root.path);
          return appendEntries(
            store,
            root.workspaceId,
            [{ change: { type: 'page', id: root.id, op: 'delete' }, scope: { pageId: root.id } }],
            {
              mutationId: null,
              actorId: null,
              at: this.clock.now(),
            },
          );
        });
        await this.poke(root.workspaceId, seq);
        purged++;
      }
    }
    if (purged > 0) this.logger.log(`purged ${purged} expired trash roots`);
    return purged;
  }

  async purgeChangeLog(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - CHANGE_LOG_HORIZON_DAYS * DAY_MS);
    return this.store.changeLog.purgeBefore(before);
  }
}
