// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal SPDX license expression evaluation (ADR 0001).
 * Grammar: expr := term (OR term)*, term := factor (AND factor)*,
 * factor := '(' expr ')' | id [WITH exception].
 */

/** Deprecated or common non-canonical ids mapped to canonical SPDX ids. */
const ALIASES = new Map([
  ['GPL-3.0', 'GPL-3.0-only'],
  ['GPL-3.0+', 'GPL-3.0-or-later'],
  ['GPL-2.0+', 'GPL-2.0-or-later'],
  ['LGPL-2.1', 'LGPL-2.1-only'],
  ['LGPL-2.1+', 'LGPL-2.1-or-later'],
  ['LGPL-3.0', 'LGPL-3.0-only'],
  ['LGPL-3.0+', 'LGPL-3.0-or-later'],
  ['AGPL-3.0', 'AGPL-3.0-only'],
  ['Apache 2.0', 'Apache-2.0'],
  ['Apache License 2.0', 'Apache-2.0'],
  ['BSD', 'BSD-3-Clause'],
  ['MIT/X11', 'MIT'],
]);

export function canonicalId(id) {
  const trimmed = id.trim();
  return ALIASES.get(trimmed) ?? trimmed;
}

function tokenize(expression) {
  const tokens = [];
  const re = /\s*(\(|\)|[^\s()]+)\s*/g;
  let match;
  while ((match = re.exec(expression)) !== null) tokens.push(match[1]);
  return tokens;
}

/**
 * Parses an SPDX expression into a tree of
 * `{ kind: 'id', id }`, `{ kind: 'and' | 'or', items }`.
 * Throws on malformed input.
 */
export function parseExpression(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('empty license expression');
  }
  const tokens = tokenize(expression.trim());
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    const items = [parseAnd()];
    while (peek()?.toUpperCase() === 'OR') {
      next();
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }
  function parseAnd() {
    const items = [parseFactor()];
    while (peek()?.toUpperCase() === 'AND') {
      next();
      items.push(parseFactor());
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }
  function parseFactor() {
    const token = next();
    if (token === undefined) throw new Error(`unexpected end of "${expression}"`);
    if (token === '(') {
      const inner = parseOr();
      if (next() !== ')') throw new Error(`missing ")" in "${expression}"`);
      return inner;
    }
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      throw new Error(`unexpected "${token}" in "${expression}"`);
    }
    if (peek()?.toUpperCase() === 'WITH') {
      next();
      const exception = next();
      if (exception === undefined) throw new Error(`missing exception in "${expression}"`);
    }
    return { kind: 'id', id: canonicalId(token) };
  }

  const tree = parseOr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in "${expression}"`);
  return tree;
}

/**
 * Returns true when the expression is acceptable: an `OR` passes if any branch passes,
 * an `AND` passes if every part passes.
 * @param {string} expression
 * @param {(id: string) => boolean} isAllowed
 */
export function isExpressionAllowed(expression, isAllowed) {
  let tree;
  try {
    tree = parseExpression(expression);
  } catch {
    return false;
  }
  const evaluate = (node) => {
    if (node.kind === 'id') return isAllowed(node.id);
    if (node.kind === 'and') return node.items.every(evaluate);
    return node.items.some(evaluate);
  };
  return evaluate(tree);
}
