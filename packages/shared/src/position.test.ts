// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  compareSiblings,
  isValidPosition,
  positionAt,
  positionBetween,
  positionSchema,
  positionsBetween,
} from './position.js';

describe('positions', () => {
  it('generates ordered keys between neighbours', () => {
    const a = positionBetween(null, null);
    const b = positionBetween(a, null);
    const mid = positionBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    const first = positionBetween(null, a);
    expect(first < a).toBe(true);
  });

  it('keeps ordering through many inserts at the same spot', () => {
    let low = positionBetween(null, null);
    const high = positionBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const k = positionBetween(low, high);
      expect(low < k && k < high).toBe(true);
      low = k;
    }
  });

  it('inserts after equal keys (concurrent inserts)', () => {
    const a = positionBetween(null, null);
    const k = positionBetween(a, a);
    expect(k > a).toBe(true);
    expect(positionsBetween(a, a, 3).every((x) => x > a)).toBe(true);
  });

  it('generates n sorted keys', () => {
    const keys = positionsBetween(null, null, 5);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(5);
  });

  it('validates keys', () => {
    expect(isValidPosition(positionBetween(null, null))).toBe(true);
    expect(isValidPosition('')).toBe(false);
    expect(isValidPosition('a0 ')).toBe(false);
    expect(isValidPosition('x'.repeat(300))).toBe(false);
    expect(positionSchema.safeParse('a0').success).toBe(true);
    expect(positionSchema.safeParse('!!').success).toBe(false);
  });

  it('sorts siblings by position then id', () => {
    const items = [
      { id: 'b', position: 'a1' },
      { id: 'a', position: 'a1' },
      { id: 'c', position: 'a0' },
    ];
    expect(items.sort(compareSiblings).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('computes the key for an index in a sibling list', () => {
    const keys = positionsBetween(null, null, 3);
    const siblings = keys.map((position, i) => ({ id: String(i), position }));
    const start = positionAt(siblings, 0);
    expect(start < keys[0]!).toBe(true);
    const mid = positionAt(siblings, 1);
    expect(mid > keys[0]! && mid < keys[1]!).toBe(true);
    const end = positionAt(siblings, 3);
    expect(end > keys[2]!).toBe(true);
    expect(positionAt([], 0)).toBe(positionBetween(null, null));
    expect(positionAt(siblings, 99) > keys[2]!).toBe(true);
  });
});
