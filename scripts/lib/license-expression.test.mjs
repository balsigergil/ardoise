// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canonicalId, isExpressionAllowed, parseExpression } from './license-expression.mjs';

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0-only']);
const isAllowed = (id) => allowed.has(id);

describe('parseExpression', () => {
  it('parses a single id', () => {
    expect(parseExpression('MIT')).toEqual({ kind: 'id', id: 'MIT' });
  });

  it('gives AND precedence over OR', () => {
    expect(parseExpression('MIT OR Apache-2.0 AND Zlib')).toEqual({
      kind: 'or',
      items: [
        { kind: 'id', id: 'MIT' },
        {
          kind: 'and',
          items: [
            { kind: 'id', id: 'Apache-2.0' },
            { kind: 'id', id: 'Zlib' },
          ],
        },
      ],
    });
  });

  it('handles parentheses and WITH exceptions', () => {
    expect(parseExpression('(GPL-3.0-only WITH Classpath-exception-2.0)')).toEqual({
      kind: 'id',
      id: 'GPL-3.0-only',
    });
  });

  it.each(['', '(MIT', 'MIT OR', 'AND MIT', 'MIT )'])('rejects malformed "%s"', (expr) => {
    expect(() => parseExpression(expr)).toThrow();
  });
});

describe('isExpressionAllowed', () => {
  it.each([
    ['MIT', true],
    ['SSPL-1.0', false],
    ['MIT OR SSPL-1.0', true],
    ['SSPL-1.0 OR BUSL-1.1', false],
    ['MIT AND BSD-3-Clause', true],
    ['MIT AND SSPL-1.0', false],
    ['(MIT OR SSPL-1.0) AND Apache-2.0', true],
    ['GPL-3.0', true],
    ['UNLICENSED', false],
    ['', false],
    ['(MIT', false],
  ])('%s → %s', (expr, expected) => {
    expect(isExpressionAllowed(expr, isAllowed)).toBe(expected);
  });
});

describe('canonicalId', () => {
  it('maps deprecated ids', () => {
    expect(canonicalId('LGPL-3.0')).toBe('LGPL-3.0-only');
    expect(canonicalId(' MIT ')).toBe('MIT');
  });
});
