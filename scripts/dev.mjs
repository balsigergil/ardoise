#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pnpm dev`: starts Postgres, Valkey and RustFS with Docker Compose, then the server
 * (role=all, hot reload) and the Vite dev server. Works on Windows, macOS and Linux.
 * `pnpm dev:down` stops the dependencies.
 */
import { spawn, spawnSync } from 'node:child_process';
import { composeArgs, devEnvironment } from './lib/dev-env.mjs';

const isWindows = process.platform === 'win32';
const { compose, apps } = devEnvironment(process.env);
const down = process.argv.includes('--down');

const composeResult = spawnSync(
  'docker',
  composeArgs(...(down ? ['down'] : ['up', '--detach', '--wait', 'postgres', 'valkey', 'rustfs'])),
  { stdio: 'inherit', env: { ...process.env, ...compose } },
);
if (composeResult.status !== 0) {
  console.error('\nCould not run Docker Compose. Is Docker running?');
  process.exit(composeResult.status ?? 1);
}
if (down) process.exit(0);

console.log(
  `\nArdoise dev: web http://localhost:${apps.ARDOISE_DEV_WEB_PORT}  server http://127.0.0.1:${apps.PORT}\n`,
);

const child = spawn(
  'pnpm',
  [
    'exec',
    'turbo',
    'run',
    'dev',
    '--filter=@ardoise/server',
    '--filter=@ardoise/web',
    '--ui=stream',
  ],
  { stdio: 'inherit', env: { ...process.env, ...apps }, shell: isWindows },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
