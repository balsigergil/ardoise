// SPDX-License-Identifier: AGPL-3.0-only
import type { Params } from 'nestjs-pino';
import type { Config } from './config/config.js';

/** Paths that must never reach the logs (ARCHITECTURE §13). */
export const redactedPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

const quietPaths = new Set(['/healthz', '/readyz']);

/** Structured JSON logs via pino (ARCHITECTURE §2). */
export function loggerOptions(config: Config): Params {
  return {
    pinoHttp: {
      level: config.log.level,
      base: { role: config.role },
      redact: { paths: redactedPaths, censor: '[redacted]' },
      autoLogging: { ignore: (req) => quietPaths.has((req.url ?? '').split('?')[0] ?? '') },
      ...(config.log.pretty
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  };
}
