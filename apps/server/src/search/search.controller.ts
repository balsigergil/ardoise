// SPDX-License-Identifier: AGPL-3.0-only
import {
  linkPreviewSchema,
  quickFindQuerySchema,
  searchQuerySchema,
  type LinkPreviewDto,
  type LinkPreviewInput,
  type QuickFindDto,
  type QuickFindQuery,
  type SearchQuery,
  type SearchResultsDto,
} from '@ardoise/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.service.js';
import { Auth } from '../http/request.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { LinkPreviewService } from '../links/link-preview.service.js';
import { SearchService } from './search.service.js';

/** Quick find, full search (PRODUCT §14) and bookmark previews. */
@Controller('api/workspaces/:ws')
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(LinkPreviewService) private readonly previews: LinkPreviewService,
  ) {}

  @Get('search/quick')
  quickFind(
    @Auth() a: AuthContext,
    @Param('ws', new IdPipe()) ws: string,
    @Query(new ZodPipe(quickFindQuerySchema)) query: QuickFindQuery,
  ): Promise<QuickFindDto> {
    return this.search.quickFind(a.user, ws, query.q, query.limit);
  }

  @Get('search')
  fullSearch(
    @Auth() a: AuthContext,
    @Param('ws', new IdPipe()) ws: string,
    @Query(new ZodPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<SearchResultsDto> {
    return this.search.search(a.user, ws, query);
  }

  @Post('link-preview')
  @HttpCode(200)
  linkPreview(
    @Auth() a: AuthContext,
    @Param('ws', new IdPipe()) ws: string,
    @Body(new ZodPipe(linkPreviewSchema)) body: LinkPreviewInput,
  ): Promise<LinkPreviewDto> {
    return this.previews.preview(a.user, ws, body.url);
  }
}
