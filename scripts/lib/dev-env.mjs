// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment for `pnpm dev` (ROADMAP M0). Development-only credentials: the
 * dependencies are bound to 127.0.0.1 by docker/docker-compose.dev.yml.
 * Ports avoid the usual defaults so Ardoise can run next to other local stacks.
 */
export const DEV_DEFAULTS = {
  ARDOISE_DEV_SERVER_PORT: '3100',
  ARDOISE_DEV_WEB_PORT: '5173',
  ARDOISE_DEV_POSTGRES_PORT: '15432',
  ARDOISE_DEV_VALKEY_PORT: '16379',
  ARDOISE_DEV_S3_PORT: '19000',
};

const DEV_POSTGRES_PASSWORD = 'ardoise-dev';
const DEV_S3_ACCESS_KEY = 'ardoise';
const DEV_S3_SECRET_KEY = 'ardoise-dev-secret';
const DEV_SECRET_KEY = 'ardoise-dev-secret-key-not-for-production-use';

/** @param {Record<string, string | undefined>} env the current process environment */
export function devEnvironment(env) {
  const port = (name) => env[name] || DEV_DEFAULTS[name];
  const serverPort = port('ARDOISE_DEV_SERVER_PORT');
  const webPort = port('ARDOISE_DEV_WEB_PORT');
  return {
    // Docker Compose interpolation (see docker/docker-compose.yml).
    compose: {
      ARDOISE_SECRET_KEY: DEV_SECRET_KEY,
      POSTGRES_PASSWORD: DEV_POSTGRES_PASSWORD,
      S3_ACCESS_KEY: DEV_S3_ACCESS_KEY,
      S3_SECRET_KEY: DEV_S3_SECRET_KEY,
      ARDOISE_DEV_POSTGRES_PORT: port('ARDOISE_DEV_POSTGRES_PORT'),
      ARDOISE_DEV_VALKEY_PORT: port('ARDOISE_DEV_VALKEY_PORT'),
      ARDOISE_DEV_S3_PORT: port('ARDOISE_DEV_S3_PORT'),
    },
    // Server (role=all) and Vite dev server.
    apps: {
      ARDOISE_ROLE: 'all',
      PORT: serverPort,
      HOST: '127.0.0.1',
      ARDOISE_PUBLIC_URL: `http://localhost:${webPort}`,
      ARDOISE_SECRET_KEY: DEV_SECRET_KEY,
      DATABASE_URL: `postgres://ardoise:${DEV_POSTGRES_PASSWORD}@127.0.0.1:${port('ARDOISE_DEV_POSTGRES_PORT')}/ardoise`,
      VALKEY_URL: `redis://127.0.0.1:${port('ARDOISE_DEV_VALKEY_PORT')}`,
      S3_ENDPOINT: `http://127.0.0.1:${port('ARDOISE_DEV_S3_PORT')}`,
      S3_BUCKET: 'ardoise',
      S3_ACCESS_KEY: DEV_S3_ACCESS_KEY,
      S3_SECRET_KEY: DEV_S3_SECRET_KEY,
      S3_FORCE_PATH_STYLE: 'true',
      LOG_LEVEL: env.LOG_LEVEL || 'debug',
      LOG_PRETTY: 'true',
      ARDOISE_DEV_SERVER_URL: `http://127.0.0.1:${serverPort}`,
      ARDOISE_DEV_WEB_PORT: webPort,
    },
  };
}

/** Arguments for `docker compose` targeting the isolated dev project. */
export function composeArgs(...command) {
  return [
    'compose',
    '--project-name',
    'ardoise-dev',
    '-f',
    'docker/docker-compose.yml',
    '-f',
    'docker/docker-compose.dev.yml',
    ...command,
  ];
}
