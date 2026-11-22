// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

class WorkerPlaceholder implements OnApplicationBootstrap {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    this.logger.setContext('worker');
  }
  onApplicationBootstrap(): void {
    this.logger.info('worker role enabled (job processors arrive with their features)');
  }
}

/** BullMQ job processors. Placeholder until the first jobs land. */
@Module({ providers: [WorkerPlaceholder] })
export class WorkerModule {}
