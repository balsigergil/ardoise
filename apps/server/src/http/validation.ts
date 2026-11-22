// SPDX-License-Identifier: AGPL-3.0-only
import { DomainError } from '@ardoise/shared';
import type { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

export class ValidationError extends DomainError {
  constructor(readonly issues: { path: string; message: string }[]) {
    super('validation_failed');
  }
}

export function validationErrorFrom(error: z.ZodError): ValidationError {
  return new ValidationError(
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

/** Validates a body or query with a shared zod schema (CLAUDE.md §2: contracts in shared). */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) throw validationErrorFrom(result.error);
    return result.data;
  }
}

/** Malformed ids are reported as `not_found`, like ids the caller cannot see. */
export class IdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !z.uuid().safeParse(value).success)
      throw new DomainError('not_found');
    return value;
  }
}
