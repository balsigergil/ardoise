// SPDX-License-Identifier: AGPL-3.0-only
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DomainError, type FileDto } from '@ardoise/shared';
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import busboy from 'busboy';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/auth.service.js';
import { Auth } from '../http/request.js';
import { IdPipe } from '../http/validation.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';
import { FileService, type DownloadResult } from './file.service.js';

const id = () => new IdPipe();
/** Multipart framing around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** Sends a download: a redirect, or the stream with its headers. */
export async function sendDownload(res: Response, result: DownloadResult): Promise<void> {
  if (result.kind === 'redirect') {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, result.url);
    return;
  }
  res.status(result.status);
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  await pipeline(result.body, res).catch(() => res.destroy());
}

/** Uploads and downloads (ARCHITECTURE §4.7). */
@Controller()
export class FilesController {
  constructor(
    @Inject(FileService) private readonly files: FileService,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
  ) {}

  /** `multipart/form-data` with one `file` field, streamed to S3 (Can edit on the page). */
  @Post('api/workspaces/:ws/pages/:page/files')
  @HttpCode(201)
  async upload(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('page', id()) page: string,
    @Req() req: Request,
  ): Promise<FileDto> {
    await this.files.authorizeUpload(a.user, ws, page);
    const { maxUploadSizeMb } = await this.settings.limits();
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxUploadSizeMb * 1024 * 1024 + MULTIPART_OVERHEAD) {
      throw new DomainError('file_too_large');
    }
    if (!/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) {
      throw new DomainError('validation_failed');
    }
    return new Promise<FileDto>((resolve, reject) => {
      let started = false;
      const parser = busboy({
        headers: req.headers,
        limits: { files: 1, fields: 0, parts: 2, fieldSize: 0 },
      });
      parser.on(
        'file',
        (field: string, stream: Readable, info: { filename: string; mimeType: string }) => {
          if (field !== 'file' || started) {
            stream.resume();
            return;
          }
          started = true;
          this.files
            .upload(a.user, ws, page, {
              name: info.filename,
              declaredMime: info.mimeType,
              body: stream,
            })
            .then(resolve, reject);
        },
      );
      parser.on('error', () => reject(new DomainError('validation_failed')));
      parser.on('close', () => {
        if (!started) reject(new DomainError('validation_failed'));
      });
      req.pipe(parser);
    });
  }

  @Get('api/workspaces/:ws/files/:file')
  metadata(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('file', id()) file: string,
  ): Promise<FileDto> {
    return this.files.metadata(a.user, ws, file);
  }

  /** `GET /files/:ws/:id` (`?thumb=1` for the thumbnail), with range requests. */
  @Get('files/:ws/:file')
  async download(
    @Auth() a: AuthContext,
    @Param('ws', id()) ws: string,
    @Param('file', id()) file: string,
    @Query('thumb') thumb: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.files.download(a.user, ws, file, {
      thumb: thumb === '1',
      ...(range && { range }),
    });
    await sendDownload(res, result);
  }
}
