// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { loadConfig, type Config } from '../src/config/config.js';
import { images } from './images.js';

export interface TestStack {
  postgres: StartedPostgreSqlContainer;
  valkey: StartedTestContainer;
  rustfs: StartedTestContainer;
  /** Base env for `loadConfig`, pointing at the containers. */
  env: Record<string, string>;
  config(overrides?: Record<string, string>): Config;
  stop(): Promise<void>;
}

const S3_ACCESS_KEY = 'ardoise-test';
const S3_SECRET_KEY = 'ardoise-test-secret';

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(images.postgres)
    .withDatabase('ardoise')
    .withUsername('ardoise')
    .withPassword('ardoise')
    .start();
}

export async function startValkey(): Promise<StartedTestContainer> {
  return new GenericContainer(images.valkey)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
}

export async function startRustfs(): Promise<StartedTestContainer> {
  return new GenericContainer(images.rustfs)
    .withEnvironment({ RUSTFS_ACCESS_KEY: S3_ACCESS_KEY, RUSTFS_SECRET_KEY: S3_SECRET_KEY })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000).forStatusCode(200))
    .start();
}

/** Starts Postgres, Valkey and RustFS in parallel (CLAUDE.md §5). */
export async function startStack(): Promise<TestStack> {
  const [postgres, valkey, rustfs] = await Promise.all([
    startPostgres(),
    startValkey(),
    startRustfs(),
  ]);
  const env = {
    ARDOISE_PUBLIC_URL: 'http://localhost:3000',
    ARDOISE_SECRET_KEY: 'test-secret-key-test-secret-key-0123456789',
    DATABASE_URL: postgres.getConnectionUri(),
    VALKEY_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
    S3_ENDPOINT: `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
    S3_BUCKET: 'ardoise-test',
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_FORCE_PATH_STYLE: 'true',
    LOG_LEVEL: 'warn',
  };
  return {
    postgres,
    valkey,
    rustfs,
    env,
    config: (overrides = {}) => loadConfig({ ...env, ...overrides }),
    stop: async () => {
      await Promise.all([postgres.stop(), valkey.stop(), rustfs.stop()]);
    },
  };
}
