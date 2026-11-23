// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright global setup. Without E2E_BASE_URL, starts Postgres, Valkey and RustFS
 * with Testcontainers and the built server (role=all) serving the built web app, then
 * reads the first-run setup URL from the server logs (E2E_SETUP_URL).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { images } from '../apps/server/test/images.js';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3210);
const root = fileURLToPath(new URL('..', import.meta.url));

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.E2E_BASE_URL) return () => Promise.resolve();

  const build = spawnSync(
    'pnpm',
    ['exec', 'turbo', 'run', 'build', '--filter=@ardoise/server', '--filter=@ardoise/web'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  if (build.status !== 0) throw new Error('build failed');

  const [postgres, valkey, rustfs] = await Promise.all([
    new PostgreSqlContainer(images.postgres)
      .withDatabase('ardoise')
      .withUsername('ardoise')
      .withPassword('ardoise')
      .start(),
    new GenericContainer(images.valkey)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer(images.rustfs)
      .withEnvironment({ RUSTFS_ACCESS_KEY: 'e2e', RUSTFS_SECRET_KEY: 'e2e-secret' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/health', 9000).forStatusCode(200))
      .start(),
  ]);

  const baseUrl = `http://localhost:${E2E_PORT}`;
  const server: ChildProcess = spawn(process.execPath, ['apps/server/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      ARDOISE_ROLE: 'all',
      HOST: '127.0.0.1',
      PORT: String(E2E_PORT),
      ARDOISE_PUBLIC_URL: baseUrl,
      ARDOISE_SECRET_KEY: 'e2e-secret-key-e2e-secret-key-0123456789',
      ARDOISE_WEB_DIST: `${root}apps/web/dist`,
      DATABASE_URL: postgres.getConnectionUri(),
      VALKEY_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
      S3_ENDPOINT: `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
      S3_BUCKET: 'ardoise-e2e',
      S3_ACCESS_KEY: 'e2e',
      S3_SECRET_KEY: 'e2e-secret',
      S3_FORCE_PATH_STYLE: 'true',
      LOG_LEVEL: 'info',
      LOG_PRETTY: 'false',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let setupUrl: string | undefined;
  server.stdout?.setEncoding('utf8');
  // E2E_SERVER_LOG=<file> keeps the server's logs for debugging.
  const logFile = process.env.E2E_SERVER_LOG;
  server.stdout?.on('data', (chunk: string) => {
    setupUrl ??= /first-run setup: open (\S+)/.exec(chunk)?.[1];
    if (logFile) appendFileSync(logFile, chunk);
  });

  await waitFor(async () => (await fetch(`${baseUrl}/readyz`)).ok, 60_000, 'the server');
  await waitFor(() => Promise.resolve(setupUrl !== undefined), 10_000, 'the setup URL in the logs');
  process.env.E2E_SETUP_URL = setupUrl;

  return async () => {
    server.kill('SIGTERM');
    await Promise.all([postgres.stop(), valkey.stop(), rustfs.stop()]);
  };
}
