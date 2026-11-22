// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { READINESS_PROBES } from '../tokens.js';
import { checkReadiness, publicReport, type Probe, type ReadinessReport } from './readiness.js';

const PROBE_TIMEOUT_MS = 2000;

@Controller()
export class HealthController {
  constructor(
    @Inject(READINESS_PROBES) private readonly probes: Probe[],
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthController.name);
  }

  /** Liveness: the process is up and serving HTTP. */
  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: Postgres, Valkey and S3 are reachable. */
  @Get('readyz')
  async readyz(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await checkReadiness(this.probes, PROBE_TIMEOUT_MS);
    if (report.status !== 'ok') {
      const failed = Object.entries(report.checks)
        .filter(([, r]) => r.status === 'error')
        .map(([name, r]) => ({ name, error: r.error }));
      this.logger.warn({ failed }, 'readiness check failed');
      res.status(503);
    }
    res.setHeader('Cache-Control', 'no-store');
    return publicReport(report);
  }
}
