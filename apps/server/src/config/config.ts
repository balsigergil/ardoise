// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import { roles } from '../roles/roles.js';

const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes');

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const url = (protocols: readonly string[]) =>
  z.url().refine((value) => URL.canParse(value) && protocols.includes(new URL(value).protocol), {
    message: `must use one of: ${protocols.join(', ')}`,
  });

/** Environment variables (ARCHITECTURE §2). Values are never echoed in errors. */
const envSchema = z
  .object({
    ARDOISE_ROLE: z.enum(roles).default('all'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    ARDOISE_PUBLIC_URL: url(['http:', 'https:']),
    ARDOISE_SECRET_KEY: z.string().min(32, 'must be at least 32 characters'),
    ARDOISE_MIGRATE_ON_BOOT: bool(true),
    ARDOISE_ADMIN_EMAIL: z.email().optional(),
    ARDOISE_ADMIN_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
    DATABASE_URL: url(['postgres:', 'postgresql:']),
    VALKEY_URL: url(['redis:', 'rediss:', 'valkey:', 'valkeys:']),
    S3_ENDPOINT: url(['http:', 'https:']).optional(),
    S3_PUBLIC_URL: url(['http:', 'https:']).optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool(false),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: bool(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalString,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: bool(false),
  })
  .refine(
    (env) => (env.ARDOISE_ADMIN_EMAIL === undefined) === (env.ARDOISE_ADMIN_PASSWORD === undefined),
    {
      message: 'ARDOISE_ADMIN_EMAIL and ARDOISE_ADMIN_PASSWORD must be set together',
      path: ['ARDOISE_ADMIN_PASSWORD'],
    },
  );

export type Env = z.input<typeof envSchema>;

export function toConfig(env: z.output<typeof envSchema>) {
  return {
    role: env.ARDOISE_ROLE,
    host: env.HOST,
    port: env.PORT,
    publicUrl: env.ARDOISE_PUBLIC_URL.replace(/\/+$/, ''),
    secretKey: env.ARDOISE_SECRET_KEY,
    migrateOnBoot: env.ARDOISE_MIGRATE_ON_BOOT,
    bootstrapAdmin:
      env.ARDOISE_ADMIN_EMAIL && env.ARDOISE_ADMIN_PASSWORD
        ? { email: env.ARDOISE_ADMIN_EMAIL, password: env.ARDOISE_ADMIN_PASSWORD }
        : undefined,
    databaseUrl: env.DATABASE_URL,
    // ioredis only understands redis:// and rediss://.
    valkeyUrl: env.VALKEY_URL.replace(/^valkey(s?):/, 'redis$1:'),
    s3: {
      endpoint: env.S3_ENDPOINT,
      publicUrl: env.S3_PUBLIC_URL,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.SMTP_FROM,
        }
      : undefined,
    log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
  };
}

export type Config = ReturnType<typeof toConfig>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Validates the environment. Error messages name variables, never their values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.join('.') || '(environment)';
        const message =
          issue.code === 'invalid_type' && issue.input === undefined
            ? 'is required'
            : issue.message;
        return `${name}: ${message}`;
      }),
    );
  }
  return toConfig(result.data);
}
