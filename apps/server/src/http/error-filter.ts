// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError, httpStatusFor, type ApiErrorBody, type ErrorCode } from '@ardoise/shared';
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { validationErrorFrom, ValidationError } from './validation.js';

function codeForHttpStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'validation_failed';
  return 'internal_error';
}

/** Maps every error to `ApiErrorBody`; never leaks stack traces (CLAUDE.md §4). */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let error = exception;
    if (error instanceof z.ZodError) error = validationErrorFrom(error);

    let status: number;
    let body: ApiErrorBody;
    if (error instanceof DomainError) {
      status = httpStatusFor(error.code);
      body = {
        error: {
          code: error.code,
          ...(error instanceof ValidationError && { issues: error.issues }),
        },
      };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      body = { error: { code: codeForHttpStatus(status) } };
    } else {
      status = 500;
      body = { error: { code: 'internal_error' } };
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    if (status === 429) res.setHeader('Retry-After', '900');
    res.status(status).json(body);
  }
}
