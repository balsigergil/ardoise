// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { kitchenSink } from '../__fixtures__/documents.js';
import { docFromJSON, nodeFromJSON, stateToJSON, type DocJSON } from '../yjs.js';
import {
  BLOCK_NODES,
  INLINE_NODES,
  MARKS,
  STRUCTURAL_NODES,
  TEXT_BLOCKS,
  getEditorSchema,
  isValidExt,
  isValidPluginData,
  isSafeHref,
  findBlocksToRename,
} from './index.js';

const schema = getEditorSchema();
const bt = (s?: string) => ({
  type: 'blockText',
  ...(s && { content: [{ type: 'text', text: s }] }),
});
const p = (s?: string, extra: unknown[] = []) => ({
  type: 'paragraph',
  content: [bt(s), ...extra],
});
const doc = (...content: unknown[]): DocJSON => ({ type: 'doc', content });

function valid(json: DocJSON): boolean {
  try {
    nodeFromJSON(json);
    return true;
  } catch {
    return false;
  }
}

describe('schema', () => {
  it('declares exactly the persisted node and mark names', () => {
    const nodes = Object.keys(schema.nodes).sort();
    expect(nodes).toEqual([...BLOCK_NODES, ...STRUCTURAL_NODES, ...INLINE_NODES].sort());
    expect(Object.keys(schema.marks).sort()).toEqual([...MARKS].sort());
  });

  it('gives every block node blockId and ext', () => {
    for (const name of BLOCK_NODES) {
      const attrs = schema.nodes[name]!.spec.attrs ?? {};
      expect(attrs, name).toHaveProperty('blockId');
      expect(attrs, name).toHaveProperty('ext');
      expect(schema.nodes[name]!.isInGroup('block'), name).toBe(true);
    }
  });

  it('accepts an empty document and nested children on any block', () => {
    expect(valid(doc())).toBe(true);
    expect(valid(doc(p('a', [{ type: 'children', content: [p('b')] }])))).toBe(true);
    expect(
      valid(doc({ type: 'divider', content: [{ type: 'children', content: [p('under')] }] })),
    ).toBe(true);
  });

  it('rejects malformed structures', () => {
    expect(valid(doc({ type: 'paragraph' }))).toBe(false); // missing text part
    expect(valid(doc(p('a', [{ type: 'children', content: [] }])))).toBe(false);
    const column = { type: 'column', content: [p('x')] };
    expect(valid(doc({ type: 'columns', content: [column] }))).toBe(false); // < 2
    expect(valid(doc({ type: 'columns', content: Array(6).fill(column) }))).toBe(false); // > 5
    const nested = { type: 'columns', content: [column, column] };
    expect(
      valid(doc({ type: 'columns', content: [{ type: 'column', content: [nested] }, column] })),
    ).toBe(false);
    expect(
      valid(
        doc({
          type: 'codeBlock',
          content: [
            { type: 'codeText', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      valid(
        doc({
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('x')] }] }],
        }),
      ),
    ).toBe(false);
  });

  it('lets every text block turn into any other one, keeping its content', () => {
    const source = schema.nodeFromJSON(p('hello', [{ type: 'children', content: [p('child')] }]));
    for (const name of TEXT_BLOCKS) {
      expect(schema.nodes[name]!.validContent(source.content), name).toBe(true);
    }
    expect(schema.nodes['codeBlock']!.validContent(source.content)).toBe(false);
  });

  it('accepts the kitchen-sink document', () => {
    expect(() => nodeFromJSON(kitchenSink())).not.toThrow();
  });
});

describe('Yjs round trip', () => {
  it('keeps every node, mark and attribute through an encoded state', () => {
    const json = kitchenSink();
    const original = nodeFromJSON(json);
    const ydoc = docFromJSON(json);
    const decoded = stateToJSON(Y.encodeStateAsUpdate(ydoc));
    const restored = nodeFromJSON(decoded);
    expect(restored.eq(original)).toBe(true);
    expect(restored.toJSON()).toEqual(original.toJSON());
  });

  it('decodes a document with no body as an empty doc', () => {
    expect(stateToJSON(Y.encodeStateAsUpdate(new Y.Doc()))).toEqual({ type: 'doc', content: [] });
  });
});

describe('ext and plugin data caps', () => {
  it('validates ext shape and size', () => {
    expect(isValidExt(null)).toBe(true);
    expect(isValidExt({ acme: { a: 1 } })).toBe(true);
    expect(isValidExt({ acme: 1 })).toBe(false);
    expect(isValidExt([])).toBe(false);
    expect(isValidExt({ acme: { s: 'x'.repeat(5000) } })).toBe(false);
    const big = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`p${i}`, { s: 'x'.repeat(3900) }]),
    );
    expect(isValidExt(big)).toBe(false);
  });

  it('validates plugin data', () => {
    expect(isValidPluginData({ a: 1 })).toBe(true);
    expect(isValidPluginData('x')).toBe(false);
    expect(isValidPluginData({ s: 'x'.repeat(17_000) })).toBe(false);
    expect(isValidPluginData({ s: 'x'.repeat(5000) }, 4096)).toBe(false);
  });
});

describe('links', () => {
  it('keeps only safe hrefs', () => {
    expect(isSafeHref('https://a.b/c')).toBe(true);
    expect(isSafeHref('mailto:a@b.c')).toBe(true);
    expect(isSafeHref('/w/1/p/2')).toBe(true);
    expect(isSafeHref('#block-1')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('data:text/html,x')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });
});

describe('findBlocksToRename', () => {
  const withId = (id: string | null, s: string) => ({
    type: 'paragraph',
    attrs: { blockId: id },
    content: [bt(s)],
  });

  it('renames missing ids', () => {
    const node = schema.nodeFromJSON(doc(withId('a', 'x'), withId(null, 'y')));
    expect(findBlocksToRename(node)).toEqual([node.child(0).nodeSize]);
  });

  it('renames the copy inside the changed range, not the original', () => {
    const node = schema.nodeFromJSON(doc(withId('a', 'copy'), withId('a', 'original')));
    const first = node.child(0).nodeSize;
    expect(findBlocksToRename(node, [[0, first]])).toEqual([0]);
    expect(findBlocksToRename(node)).toEqual([first]);
  });

  it('looks into children and columns', () => {
    const node = schema.nodeFromJSON(
      doc({
        type: 'paragraph',
        attrs: { blockId: 'a' },
        content: [bt('x'), { type: 'children', content: [withId('a', 'child')] }],
      }),
    );
    expect(findBlocksToRename(node)).toHaveLength(1);
  });
});
