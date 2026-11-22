// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

class CollabPlaceholder implements OnApplicationBootstrap {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    this.logger.setContext('collab');
  }
  onApplicationBootstrap(): void {
    this.logger.info('collab role enabled (Hocuspocus is wired in M3)');
  }
}

/** Hocuspocus server at /collab. Placeholder until M3. */
@Module({ providers: [CollabPlaceholder] })
export class CollabModule {}
