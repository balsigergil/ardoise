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
  /** Projects a stored document into search, links and mentions (ARCHITECTURE §11). */
  'projection.document': { workspaceId: string; pageId: string; docName: string };
  /** Thumbnail of an uploaded image. */
  'file.thumbnail': { workspaceId: string; fileId: string };
  /** Daily: removes the S3 objects and rows of deleted files. */
  'files.purgeDeleted': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  jobId?: string;
  /**
   * At most one job per id and `delayMs` window, run when the window ends (later
   * enqueues in the window are merged into it).
   */
  debounce?: { id: string; delayMs: number };
}

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<void>;
}

/** Collects jobs (unit tests). */
export class RecordingJobQueue implements JobQueue {
  readonly jobs: { name: JobName; data: unknown; options?: EnqueueOptions }[] = [];
  enqueue<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<void> {
    this.jobs.push({ name, data, ...(options && { options }) });
    return Promise.resolve();
  }
}
