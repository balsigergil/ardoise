// SPDX-License-Identifier: AGPL-3.0-only
import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { CollabModule } from '../collab/collab.module.js';
import { CollabServer } from '../collab/collab.server.js';
import { HocuspocusContentEditor } from '../collab/content-editor.js';
import { systemClock } from '../common/clock.js';
import type { Config } from '../config/config.js';
import { FileService } from '../files/file.service.js';
import { BullJobQueue, startWorker } from '../jobs/bullmq-queue.js';
import type { JobQueue } from '../jobs/jobs.js';
import { JobProcessors } from '../jobs/processors.js';
import { ChildBlockService } from '../pages/child-blocks.js';
import { ProjectionService } from '../projection/projection.service.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { Store } from '../store/store.js';
import type { SyncEventBus } from '../sync/pokes.js';
import { CONFIG, JOB_QUEUE, STORE, SYNC_BUS } from '../tokens.js';

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

/**
 * BullMQ job processors. Content edits (`page.childBlock`) go through the collab
 * module's Hocuspocus: with role=all it is the one serving editors; with role=worker it
 * is a headless instance (never attached to a socket) that reaches the collab nodes
 * through Valkey (ADR 0011).
 */
@Module({
  imports: [CollabModule],
  providers: [
    {
      provide: JobProcessors,
      inject: [
        STORE,
        InstanceSettingsService,
        SYNC_BUS,
        ProjectionService,
        FileService,
        CollabServer,
      ],
      useFactory: (
        store: Store,
        settings: InstanceSettingsService,
        bus: SyncEventBus,
        projection: ProjectionService,
        files: FileService,
        collab: CollabServer,
      ) =>
        new JobProcessors(store, settings, bus, systemClock, new Logger('jobs'), {
          projection,
          files,
          childBlocks: new ChildBlockService(store, new HocuspocusContentEditor(collab.hocuspocus)),
        }),
    },
    JobWorker,
  ],
})
export class WorkerModule {}
