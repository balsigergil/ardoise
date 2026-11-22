// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
