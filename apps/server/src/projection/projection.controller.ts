// SPDX-License-Identifier: AGPL-3.0-only
import { backlinksQuerySchema, type BacklinksDto, type BacklinksQuery } from '@ardoise/shared';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.service.js';
import { Auth } from '../http/request.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { ProjectionService } from './projection.service.js';

/** Reads over the projection (ARCHITECTURE §11). */
@Controller('api/workspaces/:ws')
export class ProjectionController {
  constructor(@Inject(ProjectionService) private readonly projection: ProjectionService) {}

  @Get('pages/:page/backlinks')
  backlinks(
    @Auth() a: AuthContext,
    @Param('ws', new IdPipe()) ws: string,
    @Param('page', new IdPipe()) page: string,
    @Query(new ZodPipe(backlinksQuerySchema)) query: BacklinksQuery,
  ): Promise<BacklinksDto> {
    return this.projection.backlinks(a.user, ws, page, query);
  }
}
