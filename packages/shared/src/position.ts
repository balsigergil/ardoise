// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fractional positions for siblings (CLAUDE.md §4: never integer positions). Keys are
 * base-62 strings compared byte-wise (the database column uses the "C" collation).
 * Siblings sort by `(position, id)`, so equal keys from concurrent inserts stay
 * deterministic.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';

export const MAX_POSITION_LENGTH = 256;

const BASE62 = /^[0-9A-Za-z]+$/;

export function isValidPosition(key: string): boolean {
  if (key.length === 0 || key.length > MAX_POSITION_LENGTH || !BASE62.test(key)) return false;
  try {
    // The library validates its first argument.
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

export const positionSchema = z
  .string()
  .min(1)
  .max(MAX_POSITION_LENGTH)
  .refine(isValidPosition, { message: 'invalid position' });

/** Byte-wise comparison, the order used by the database ("C" collation). */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface Positioned {
  id: string;
  position: string;
}

/** Sibling order: position, then id. */
export function compareSiblings(a: Positioned, b: Positioned): number {
  return comparePositions(a.position, b.position) || comparePositions(a.id, b.id);
}

/**
 * A key strictly between `before` and `after` (either may be null for the ends). When
 * both are equal (concurrent inserts), the key goes just after them.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && comparePositions(before, after) >= 0) {
    return generateKeyBetween(before, null);
  }
  return generateKeyBetween(before, after);
}

export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (before !== null && after !== null && comparePositions(before, after) >= 0) {
    return generateNKeysBetween(before, null, count);
  }
  return generateNKeysBetween(before, after, count);
}

/**
 * The key for inserting at `index` in an ordered sibling list (0 = first,
 * `siblings.length` = last). `siblings` must not contain the moved item.
 */
export function positionAt(siblings: readonly Positioned[], index: number): string {
  const i = Math.max(0, Math.min(index, siblings.length));
  const before = i > 0 ? siblings[i - 1]!.position : null;
  const after = i < siblings.length ? siblings[i]!.position : null;
  return positionBetween(before, after);
}
