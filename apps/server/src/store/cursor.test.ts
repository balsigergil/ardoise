// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, likeContains, toPage } from './cursor.js';

describe('cursors', () => {
  it('round-trip sort keys', () => {
    expect(decodeCursor(encodeCursor(['a', 'b']), 2)).toEqual(['a', 'b']);
  });
  it('treat malformed cursors as the first page', () => {
    expect(decodeCursor(undefined, 1)).toBeUndefined();
    expect(decodeCursor('%%%', 1)).toBeUndefined();
    expect(decodeCursor(encodeCursor(['a']), 2)).toBeUndefined();
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'), 1)).toBeUndefined();
  });
  it('split limit+1 rows into a page', () => {
    expect(toPage([1, 2, 3], 2, (n) => [String(n)])).toEqual({
      items: [1, 2],
      nextCursor: encodeCursor(['2']),
    });
    expect(toPage([1, 2], 2, (n) => [String(n)])).toEqual({ items: [1, 2], nextCursor: null });
  });
  it('escape LIKE wildcards', () => {
    expect(likeContains('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});
