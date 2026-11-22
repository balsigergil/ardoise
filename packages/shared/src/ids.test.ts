// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isUuidV7, newId } from './ids.js';

describe('newId', () => {
  it('returns distinct UUIDv7 values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isUuidV7(id)).toBe(true);
  });

  it('is time-ordered', () => {
    const a = newId();
    const b = newId();
    expect(a < b).toBe(true);
  });
});

describe('isUuidV7', () => {
  it.each([
    ['0190f3c4-7a1b-7c3d-8e4f-0123456789ab', true],
    ['550e8400-e29b-41d4-a716-446655440000', false], // v4
    ['not-a-uuid', false],
    [42, false],
    [null, false],
  ])('%s → %s', (value, expected) => {
    expect(isUuidV7(value)).toBe(expected);
  });
});
