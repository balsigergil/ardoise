// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { newId } from './ids.js';
import { idsFromPath, labelToUuid, pathFromIds, uuidToLabel } from './ltree.js';

const ID = '0190F3C4-7A1B-7C3D-8E4F-0123456789AB';

describe('ltree labels', () => {
  it('encodes a UUID as 32 lowercase hex characters', () => {
    expect(uuidToLabel(ID)).toBe('0190f3c47a1b7c3d8e4f0123456789ab');
  });

  it('round-trips', () => {
    const id = newId();
    expect(labelToUuid(uuidToLabel(id))).toBe(id);
  });

  it('rejects invalid input', () => {
    expect(() => uuidToLabel('nope')).toThrow(TypeError);
    expect(() => labelToUuid('0190f3c4-7a1b')).toThrow(TypeError);
    expect(() => labelToUuid('0190F3C47A1B7C3D8E4F0123456789AB')).toThrow(TypeError);
  });
});

describe('paths', () => {
  it('joins ids root first and splits them back', () => {
    const ids = [newId(), newId(), newId()];
    const path = pathFromIds(ids);
    expect(path.split('.')).toHaveLength(3);
    expect(path).not.toContain('-');
    expect(idsFromPath(path)).toEqual(ids);
  });

  it('handles empty input', () => {
    expect(() => pathFromIds([])).toThrow(RangeError);
    expect(idsFromPath('')).toEqual([]);
  });
});
