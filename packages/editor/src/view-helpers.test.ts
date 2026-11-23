// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { stateOf } from './__fixtures__/sketch.js';
import { findBlock, listNumbers, outlineOf } from './view-helpers.js';

describe('listNumbers', () => {
  it('counts consecutive numbered items per level and restarts after other blocks', () => {
    const { doc } = stateOf(`
      numberedItem a
      numberedItem b
        numberedItem b1
        numberedItem b2
      paragraph break
      numberedItem c
    `);
    expect([...listNumbers(doc).values()]).toEqual([1, 2, 1, 2, 1]);
  });
});

describe('outlineOf and findBlock', () => {
  it('lists headings in order, nested ones included', () => {
    const { doc } = stateOf(`
      heading:level=1:id=h1 Title
      toggle t
        heading:level=2:id=h2 Inner
    `);
    expect(outlineOf(doc).map((e) => [e.level, e.text, e.blockId])).toEqual([
      [1, 'Title', 'h1'],
      [2, 'Inner', 'h2'],
    ]);
    expect(doc.nodeAt(findBlock(doc, 'h2'))!.type.name).toBe('heading');
    expect(findBlock(doc, 'missing')).toBe(-1);
  });
});
