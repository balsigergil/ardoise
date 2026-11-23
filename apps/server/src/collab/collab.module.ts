// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { systemClock } from '../common/clock.js';
import type { Config } from '../config/config.js';
import type { JobQueue } from '../jobs/jobs.js';
import { PermissionService } from '../permissions/permission.service.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';
import type { Store } from '../store/store.js';
import type { SyncEventBus } from '../sync/pokes.js';
import { CONFIG, JOB_QUEUE, STORE, SYNC_BUS } from '../tokens.js';
import { CollabAccess } from './collab-access.js';
import { CollabPersistence } from './collab-persistence.js';
import { CollabServer } from './collab.server.js';

class CollabLifecycle implements OnApplicationShutdown {
  constructor(@Inject(CollabServer) private readonly server: CollabServer) {}
  async onApplicationShutdown(): Promise<void> {
    await this.server.close();
  }
}

/** Hocuspocus at /collab (ARCHITECTURE §5); attached to the HTTP server at bootstrap. */
@Module({
  providers: [
    {
      provide: CollabServer,
      inject: [
        STORE,
        PermissionService,
        AuthService,
        InstanceSettingsService,
        JOB_QUEUE,
        SYNC_BUS,
        CONFIG,
      ],
      useFactory: (
        store: Store,
        permissions: PermissionService,
        auth: AuthService,
        settings: InstanceSettingsService,
        jobs: JobQueue,
        bus: SyncEventBus,
        config: Config,
      ) => {
        const logger = new Logger('collab');
        return new CollabServer(
          new CollabAccess(store, permissions, (token) => auth.authenticate(token)),
          new CollabPersistence(store, () => settings.limits(), jobs, systemClock, logger),
          bus,
          { publicUrl: config.publicUrl, valkeyUrl: config.valkeyUrl },
          logger,
        );
      },
    },
    CollabLifecycle,
  ],
  exports: [CollabServer],
})
export class CollabModule {}
