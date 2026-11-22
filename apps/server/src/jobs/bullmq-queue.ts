// SPDX-License-Identifier: AGPL-3.0-only
/** BullMQ over Valkey: the api role enqueues, the worker role processes (ARCHITECTURE §2). */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { JobName, JobPayloads, JobQueue } from './jobs.js';
import type { JobProcessors } from './processors.js';

export const QUEUE_NAME = 'ardoise';

/** BullMQ needs dedicated connections without per-request retry limits. */
function connection(url: string, name: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: null, connectionName: name });
  // Reconnection is automatic; errors are reported by /readyz, not as crashes.
  redis.on('error', () => undefined);
  return redis;
}

export class BullJobQueue implements JobQueue {
  private readonly queue: Queue;

  constructor(valkeyUrl: string) {
    this.queue = new Queue(QUEUE_NAME, { connection: connection(valkeyUrl, 'ardoise-queue') });
  }

  async enqueue<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options: { jobId?: string } = {},
  ): Promise<void> {
    await this.queue.add(name, data, {
      ...(options.jobId && { jobId: options.jobId }),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Daily maintenance jobs, registered idempotently by every worker. */
  async scheduleMaintenance(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'trash-purge',
      { pattern: '17 3 * * *' },
      { name: 'trash.purgeExpired', data: {} },
    );
    await this.queue.upsertJobScheduler(
      'change-log-purge',
      { pattern: '37 3 * * *' },
      { name: 'changeLog.purge', data: {} },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function startWorker(valkeyUrl: string, processors: JobProcessors): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      await processors.run(job.name as JobName, job.data as never);
    },
    { connection: connection(valkeyUrl, 'ardoise-worker'), concurrency: 4 },
  );
}
