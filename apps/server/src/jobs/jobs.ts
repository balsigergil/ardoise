// SPDX-License-Identifier: AGPL-3.0-only
/** Background jobs (BullMQ in production, see `bullmq-queue.ts`). */

export interface JobPayloads {
  /** Rewrites `path` of a large moved subtree in chunks (ADR 0003 item 5). */
  'page.moveSubtree': { workspaceId: string; pageId: string; actorId: string };
  /** Copies the descendants of a large duplicated subtree. */
  'page.duplicateSubtree': {
    workspaceId: string;
    sourceId: string;
    newId: string;
    actorId: string;
  };
  /** Daily: purges trash roots past the retention period. */
  'trash.purgeExpired': Record<string, never>;
  /** Daily: purges change-log entries past the horizon. */
  'changeLog.purge': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: { jobId?: string },
  ): Promise<void>;
}

/** Collects jobs (unit tests). */
export class RecordingJobQueue implements JobQueue {
  readonly jobs: { name: JobName; data: unknown }[] = [];
  enqueue<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    this.jobs.push({ name, data });
    return Promise.resolve();
  }
}
