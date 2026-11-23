// SPDX-License-Identifier: AGPL-3.0-only
import {
  pageListQuerySchema,
  trashQuerySchema,
  type PageDetailDto,
  type PageListDto,
  type PageListQuery,
  type PublicChildrenDto,
  type PublicContentDto,
  type PublicPageDto,
  type RecentDto,
  type SharingDto,
  type TrashQuery,
} from '@ardoise/shared';
import { Controller, Get, Headers, HttpCode, Inject, Param, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthContext } from '../auth/auth.service.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Auth, ClientIp, Public } from '../http/request.js';
import { IdPipe, ZodPipe } from '../http/validation.js';
import { FileService } from '../files/file.service.js';
import { sendDownload } from '../files/files.controller.js';
import { PageService } from './page.service.js';
import { PublicPageService } from './public.service.js';

const id = () => new IdPipe();
const list = new ZodPipe(pageListQuerySchema);

/** Scoped reads of the page tree (ARCHITECTURE §7); writes are mutations. */
@Controller('api/workspaces/:ws')
export class PagesController {
  constructor(@Inject(PageService) private readonly pages: PageService) {}

  @Get('pages/:page')
  page(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('page', id()) page: string,
  ): Promise<PageDetailDto> {
    return this.pages.page(a.user, ws, page);
  }

  @Get('pages/:page/children')
  children(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('page', id()) page: string,
    @Query(list) query: PageListQuery,
  ): Promise<PageListDto> {
    return this.pages.children(a.user, ws, page, query);
  }

  @Get('pages/:page/sharing')
  sharing(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('page', id()) page: string,
  ): Promise<SharingDto> {
    return this.pages.sharing(a.user, ws, page);
  }

  @Get('teamspaces/:ts/pages')
  teamspaceRoots(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('ts', id()) ts: string,
    @Query(list) query: PageListQuery,
  ): Promise<PageListDto> {
    return this.pages.teamspaceRoots(a.user, ws, ts, query);
  }

  @Get('private/pages')
  privateRoots(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(list) query: PageListQuery,
  ): Promise<PageListDto> {
    return this.pages.privateRoots(a.user, ws, query);
  }

  @Get('shared/pages')
  shared(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(list) query: PageListQuery,
  ): Promise<PageListDto> {
    return this.pages.shared(a.user, ws, query);
  }

  @Get('trash')
  trash(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Query(new ZodPipe(trashQuerySchema)) query: TrashQuery,
  ): Promise<PageListDto> {
    return this.pages.trash(a.user, ws, query);
  }

  @Get('favorites')
  favorites(@Auth() a: AuthContext, @Param('ws', id()) ws: string) {
    return this.pages.favorites(a.user, ws);
  }

  @Get('recents')
  recents(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
  ): Promise<{ seq: number; items: RecentDto[] }> {
    return this.pages.recents(a.user, ws);
  }

  /** Recents bypass the change log (ADR 0003 item 4). */
  @Put('recents/:page')
  @HttpCode(204)
  touchRecent(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('page', id()) page: string,
  ): Promise<void> {
    return this.pages.touchRecent(a.user, ws, page);
  }
}

/** Anonymous reads through a public link (PRODUCT §5); never indexed. */
@Controller('api/public/:token')
export class PublicPagesController {
  constructor(
    @Inject(PublicPageService) private readonly pages: PublicPageService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(FileService) private readonly files: FileService,
  ) {}

  @Public()
  @Get('content')
  async rootContent(
    @Param('token') token: string,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicContentDto> {
    await this.guard(ip, res);
    return this.pages.content(token);
  }

  @Public()
  @Get('pages/:page/content')
  async pageContent(
    @Param('token') token: string,
    @Param('page', id()) page: string,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicContentDto> {
    await this.guard(ip, res);
    return this.pages.content(token, page);
  }

  /** Files embedded in pages the link covers (ADR 0009 §7). */
  @Public()
  @Get('files/:file')
  async file(
    @Param('token') token: string,
    @Param('file', id()) file: string,
    @Query('thumb') thumb: string | undefined,
    @Headers('range') range: string | undefined,
    @ClientIp() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.guard(ip, res);
    const access = await this.pages.access(token);
    const result = await this.files.downloadPublic(access.covers, access.workspaceId, file, {
      thumb: thumb === '1',
      ...(range && { range }),
    });
    await sendDownload(res, result);
  }

  private async guard(ip: string, res: Response): Promise<void> {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    await this.limiter.consume('publicLinkIp', ip);
  }

  @Public()
  @Get()
  async root(
    @Param('token') token: string,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicPageDto> {
    await this.guard(ip, res);
    return this.pages.page(token);
  }

  @Public()
  @Get('pages/:page')
  async page(
    @Param('token') token: string,
    @Param('page', id()) page: string,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicPageDto> {
    await this.guard(ip, res);
    return this.pages.page(token, page);
  }

  @Public()
  @Get('pages/:page/children')
  async children(
    @Param('token') token: string,
    @Param('page', id()) page: string,
    @Query(list) query: PageListQuery,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicChildrenDto> {
    await this.guard(ip, res);
    return this.pages.children(token, page, query);
  }
}
