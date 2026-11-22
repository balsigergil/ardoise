// SPDX-License-Identifier: AGPL-3.0-only
import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { Config } from '../config/config.js';
import { BullJobQueue, startWorker } from '../jobs/bullmq-queue.js';
import type { JobQueue } from '../jobs/jobs.js';
import { JobProcessors } from '../jobs/processors.js';
import { CONFIG, JOB_QUEUE } from '../tokens.js';

/** BullMQ job processors (worker role). */
class JobWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker: Worker | undefined;

  constructor(
    @Inject(PinoLogger) private readonly logger: PinoLogger,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(JobProcessors) private readonly processors: JobProcessors,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {
    this.logger.setContext('worker');
  }

  async onApplicationBootstrap(): Promise<void> {
    this.worker = startWorker(this.config.valkeyUrl, this.processors);
    this.worker.on('failed', (job, error) => {
      this.logger.error({ err: error, job: job?.name }, 'job failed');
    });
    if (this.queue instanceof BullJobQueue) await this.queue.scheduleMaintenance();
    this.logger.info('worker role enabled');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}

@Module({ providers: [JobWorker] })
export class WorkerModule {}
