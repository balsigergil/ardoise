// SPDX-License-Identifier: AGPL-3.0-only
import { createDatabase, type DatabaseHandle } from '@ardoise/db';
import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Config } from '../config/config.js';
import type { Probe } from '../health/readiness.js';
import { CONFIG, DATABASE, READINESS_PROBES, S3, VALKEY } from '../tokens.js';
import { createS3Client } from './s3.js';

class InfraLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.s3.destroy();
    this.valkey.disconnect();
    await this.database.close();
  }
}

/** Connections to Postgres, Valkey and S3, shared by every module of the process. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(config: Config) {
    return {
      module: InfraModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DATABASE, useFactory: () => createDatabase(config.databaseUrl) },
        {
          provide: VALKEY,
          useFactory: () =>
            new Redis(config.valkeyUrl, {
              connectionName: `ardoise-${config.role}`,
              maxRetriesPerRequest: 1,
              lazyConnect: false,
            }),
        },
        { provide: S3, useFactory: () => createS3Client(config.s3) },
        {
          provide: READINESS_PROBES,
          inject: [DATABASE, VALKEY, S3],
          useFactory: (database: DatabaseHandle, valkey: Redis, s3: S3Client): Probe[] => [
            {
              name: 'database',
              check: async () => {
                await database.pool.query('SELECT 1');
              },
            },
            {
              name: 'valkey',
              check: async () => {
                if ((await valkey.ping()) !== 'PONG') throw new Error('unexpected PING reply');
              },
            },
            {
              name: 's3',
              check: async (signal) => {
                await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }), {
                  abortSignal: signal,
                });
              },
            },
          ],
        },
        InfraLifecycle,
      ],
      exports: [CONFIG, DATABASE, VALKEY, S3, READINESS_PROBES],
    };
  }
}
