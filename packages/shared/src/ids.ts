// SPDX-License-Identifier: AGPL-3.0-only
import { v7 as uuidv7, validate, version } from 'uuid';

/** Generates a UUIDv7 (CLAUDE.md §4). Safe to call on the client for offline creation. */
export function newId(): string {
  return uuidv7();
}

/** True when `value` is a syntactically valid UUID of version 7. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && validate(value) && version(value) === 7;
}
