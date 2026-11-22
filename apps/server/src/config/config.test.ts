// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET = 'x'.repeat(40);

const valid = {
  ARDOISE_PUBLIC_URL: 'https://ardoise.example.org/',
  ARDOISE_SECRET_KEY: SECRET,
  DATABASE_URL: 'postgres://ardoise:pw@db:5432/ardoise',
  VALKEY_URL: 'redis://valkey:6379',
  S3_ENDPOINT: 'http://rustfs:9000',
  S3_BUCKET: 'ardoise',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret-value',
};

function issuesOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);
    expect(config.role).toBe('all');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.migrateOnBoot).toBe(true);
    expect(config.s3.region).toBe('us-east-1');
    expect(config.s3.forcePathStyle).toBe(false);
    expect(config.smtp).toBeUndefined();
    expect(config.bootstrapAdmin).toBeUndefined();
    expect(config.log).toEqual({ level: 'info', pretty: false });
  });

  it('normalizes values', () => {
    const config = loadConfig({
      ...valid,
      PORT: '8080',
      ARDOISE_ROLE: 'collab',
      S3_FORCE_PATH_STYLE: 'true',
      ARDOISE_MIGRATE_ON_BOOT: '0',
      VALKEY_URL: 'valkeys://cache:6380',
    });
    expect(config.port).toBe(8080);
    expect(config.role).toBe('collab');
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.migrateOnBoot).toBe(false);
    expect(config.publicUrl).toBe('https://ardoise.example.org');
    expect(config.valkeyUrl).toBe('rediss://cache:6380');
  });

  it('reports every missing required variable', () => {
    const issues = issuesOf({});
    for (const name of [
      'ARDOISE_PUBLIC_URL',
      'ARDOISE_SECRET_KEY',
      'DATABASE_URL',
      'VALKEY_URL',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
    ]) {
      expect(issues).toContain(`${name}: is required`);
    }
  });

  it.each([
    ['ARDOISE_ROLE', 'web'],
    ['PORT', '70000'],
    ['ARDOISE_SECRET_KEY', 'short'],
    ['DATABASE_URL', 'mysql://db/ardoise'],
    ['VALKEY_URL', 'http://valkey'],
    ['ARDOISE_PUBLIC_URL', 'not a url'],
    ['S3_FORCE_PATH_STYLE', 'maybe'],
    ['LOG_LEVEL', 'verbose'],
  ])('rejects invalid %s', (name, value) => {
    const issues = issuesOf({ ...valid, [name]: value });
    expect(issues.some((i) => i.startsWith(`${name}:`))).toBe(true);
  });

  it('never includes secret values in errors', () => {
    try {
      loadConfig({
        ...valid,
        ARDOISE_SECRET_KEY: 'tooshort-but-secret',
        DATABASE_URL: 'mysql://u:hunter2@x/db',
      });
      expect.unreachable();
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain('tooshort-but-secret');
      expect(text).not.toContain('hunter2');
    }
  });

  it('requires admin bootstrap variables together', () => {
    expect(issuesOf({ ...valid, ARDOISE_ADMIN_EMAIL: 'admin@example.org' })).toEqual([
      'ARDOISE_ADMIN_PASSWORD: ARDOISE_ADMIN_EMAIL and ARDOISE_ADMIN_PASSWORD must be set together',
    ]);
    const config = loadConfig({
      ...valid,
      ARDOISE_ADMIN_EMAIL: 'admin@example.org',
      ARDOISE_ADMIN_PASSWORD: 'correct horse battery',
    });
    expect(config.bootstrapAdmin?.email).toBe('admin@example.org');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({
      ...valid,
      ARDOISE_ADMIN_EMAIL: '',
      ARDOISE_ADMIN_PASSWORD: '',
      PORT: '',
    });
    expect(config.bootstrapAdmin).toBeUndefined();
    expect(config.port).toBe(3000);
    expect(issuesOf({ ...valid, DATABASE_URL: '' })).toEqual(['DATABASE_URL: is required']);
  });

  it('builds SMTP settings only when a host is set', () => {
    expect(loadConfig({ ...valid, SMTP_HOST: '' }).smtp).toBeUndefined();
    expect(loadConfig({ ...valid, SMTP_HOST: 'mail', SMTP_SECURE: 'true' }).smtp).toMatchObject({
      host: 'mail',
      port: 465,
      secure: true,
    });
    expect(loadConfig({ ...valid, SMTP_HOST: 'mail' }).smtp?.port).toBe(587);
  });
});
