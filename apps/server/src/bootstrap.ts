// SPDX-License-Identifier: AGPL-3.0-only
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@ardoise/db';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Config } from './config/config.js';
import { createS3Client, ensureBucket } from './infra/s3.js';
import { featuresForRole } from './roles/roles.js';
import { cacheControlFor, isSpaRoute } from './spa/spa.js';

/** Built SPA location: `ARDOISE_WEB_DIST`, or `web/` next to the server's `dist/`. */
export function defaultWebDist(): string {
  return (
    process.env.ARDOISE_WEB_DIST ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../web')
  );
}

export interface CreateAppOptions {
  webDist?: string;
}

/** Builds the Nest application for the configured role, ready to `listen`. */
export async function createApp(
  config: Config,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  if (config.migrateOnBoot) {
    await runMigrations({ connectionString: config.databaseUrl });
    logger.log('database migrations are up to date', 'bootstrap');
  }

  const features = featuresForRole(config.role);
  if (features.api) {
    await bootstrapBucket(config, logger);
    serveSpa(app, options.webDist ?? defaultWebDist(), logger);
  }
  return app;
}

async function bootstrapBucket(config: Config, logger: Logger): Promise<void> {
  const client = createS3Client(config.s3);
  try {
    if (await ensureBucket(client, config.s3.bucket))
      logger.log(`created bucket ${config.s3.bucket}`, 'bootstrap');
  } catch (error) {
    // Not fatal: /readyz reports S3 as unavailable until it is reachable.
    logger.warn(
      `could not verify bucket: ${error instanceof Error ? error.message : String(error)}`,
      'bootstrap',
    );
  } finally {
    client.destroy();
  }
}

function serveSpa(app: NestExpressApplication, webDist: string, logger: Logger): void {
  const indexHtml = join(webDist, 'index.html');
  if (!existsSync(indexHtml)) {
    logger.log(`no built web app at ${webDist}; SPA not served by this process`, 'bootstrap');
    return;
  }
  app.useStaticAssets(webDist, {
    index: false,
    setHeaders: (res: Response, filePath: string) => {
      const relative = filePath.slice(webDist.length).replaceAll('\\', '/');
      res.setHeader('Cache-Control', cacheControlFor(relative));
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && isSpaRoute(req.path)) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
      return;
    }
    next();
  });
  logger.log(`serving web app from ${webDist}`, 'bootstrap');
}
