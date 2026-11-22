// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { composeArgs, devEnvironment } from './dev-env.mjs';

describe('devEnvironment', () => {
  it('uses non-default ports so it can run next to other stacks', () => {
    const { apps, compose } = devEnvironment({});
    expect(apps.PORT).toBe('3100');
    expect(apps.DATABASE_URL).toBe('postgres://ardoise:ardoise-dev@127.0.0.1:15432/ardoise');
    expect(apps.VALKEY_URL).toBe('redis://127.0.0.1:16379');
    expect(apps.S3_ENDPOINT).toBe('http://127.0.0.1:19000');
    expect(apps.ARDOISE_PUBLIC_URL).toBe('http://localhost:5173');
    expect(compose.ARDOISE_DEV_POSTGRES_PORT).toBe('15432');
  });

  it('lets every port be overridden', () => {
    const { apps, compose } = devEnvironment({
      ARDOISE_DEV_SERVER_PORT: '4000',
      ARDOISE_DEV_POSTGRES_PORT: '5555',
      ARDOISE_DEV_WEB_PORT: '8080',
    });
    expect(apps.PORT).toBe('4000');
    expect(apps.ARDOISE_DEV_SERVER_URL).toBe('http://127.0.0.1:4000');
    expect(apps.DATABASE_URL).toContain(':5555/');
    expect(apps.ARDOISE_PUBLIC_URL).toBe('http://localhost:8080');
    expect(compose.ARDOISE_DEV_POSTGRES_PORT).toBe('5555');
  });

  it('shares credentials between compose and the apps', () => {
    const { apps, compose } = devEnvironment({});
    expect(apps.S3_SECRET_KEY).toBe(compose.S3_SECRET_KEY);
    expect(apps.ARDOISE_SECRET_KEY).toBe(compose.ARDOISE_SECRET_KEY);
    expect(apps.DATABASE_URL).toContain(compose.POSTGRES_PASSWORD);
    expect(apps.ARDOISE_SECRET_KEY.length).toBeGreaterThanOrEqual(32);
  });
});

describe('composeArgs', () => {
  it('targets the isolated dev project with the dev overlay', () => {
    expect(composeArgs('up', '-d')).toEqual([
      'compose',
      '--project-name',
      'ardoise-dev',
      '-f',
      'docker/docker-compose.yml',
      '-f',
      'docker/docker-compose.dev.yml',
      'up',
      '-d',
    ]);
  });
});
