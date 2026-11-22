// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { flattenKeys, interpolate, lookup, placeholders } from './keys.js';

const tree = { a: { b: 'x', c: { d: 'y {{count}}' } }, e: 'z' };

describe('flattenKeys', () => {
  it('flattens nested keys, sorted', () => {
    expect(flattenKeys(tree)).toEqual(['a.b', 'a.c.d', 'e']);
  });
});

describe('lookup', () => {
  it('resolves dotted keys', () => {
    expect(lookup(tree, 'a.c.d')).toBe('y {{count}}');
    expect(lookup(tree, 'a')).toBeUndefined();
    expect(lookup(tree, 'a.b.c')).toBeUndefined();
    expect(lookup(tree, 'missing.key')).toBeUndefined();
  });
});

describe('placeholders', () => {
  it('lists interpolation variables', () => {
    expect(placeholders('{{ b }} and {{a}}')).toEqual(['a', 'b']);
    expect(placeholders('none')).toEqual([]);
  });
});

describe('interpolate', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(interpolate('Hi {{ name }}, {{other}}', { name: 'Ana' })).toBe('Hi Ana, {{other}}');
  });
  it('does not re-interpolate inserted values', () => {
    expect(interpolate('{{a}}', { a: '{{b}}', b: 'x' })).toBe('{{b}}');
  });
});
