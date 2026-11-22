// SPDX-License-Identifier: AGPL-3.0-only
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CollabModule } from './collab/collab.module.js';
import type { Config } from './config/config.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { loggerOptions } from './logger.js';
import { featuresForRole } from './roles/roles.js';
import { WorkerModule } from './worker/worker.module.js';

/** Root module; the role decides which feature modules are loaded (ARCHITECTURE §2). */
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    const features = featuresForRole(config.role);
    const roleModules: Type[] = [];
    if (features.collab) roleModules.push(CollabModule);
    if (features.worker) roleModules.push(WorkerModule);
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot(loggerOptions(config)),
        InfraModule.forRoot(config),
        HealthModule,
        ...roleModules,
      ],
    };
  }
}
