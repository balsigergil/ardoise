// SPDX-License-Identifier: AGPL-3.0-only
import {
  pullQuerySchema,
  pushRequestSchema,
  type MutationEnvelope,
  type PullQuery,
  type PullResponse,
  type PushResponse,
} from '@ardoise/shared';
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.service.js';
import { Auth } from '../http/request.js';
import { ZodPipe } from '../http/validation.js';
import { MutationService } from './mutation.service.js';
import { PullService } from './pull.service.js';

/** ARCHITECTURE §6–7: push mutations, pull the change log. */
@Controller('sync')
export class SyncController {
  constructor(
    @Inject(MutationService) private readonly mutations: MutationService,
    @Inject(PullService) private readonly pulls: PullService,
  ) {}

  @Post('mutations')
  @HttpCode(200)
  async push(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(pushRequestSchema)) body: { mutations: MutationEnvelope[] },
  ): Promise<PushResponse> {
    return { results: await this.mutations.push(auth.user, body.mutations) };
  }

  @Get('pull')
  pull(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(pullQuerySchema)) query: PullQuery,
  ): Promise<PullResponse> {
    return this.pulls.pull(auth.user, query);
  }
}
