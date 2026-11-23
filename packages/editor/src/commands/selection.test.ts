// SPDX-License-Identifier: AGPL-3.0-only
/** Deleting or typing over selections that cross block structure keeps the document valid. */
import { deleteSelection } from '@tiptap/pm/commands';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { sketch, stateOf } from '../__fixtures__/sketch.js';
import { createTable } from '../registry/core.js';
import { getEditorSchema } from '../schema/index.js';

function find(state: EditorState, text: string): number {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
  });
  return at;
}

function selectBetween(state: EditorState, a: string, b: string): EditorState {
  const from = find(state, a);
  const to = find(state, b) + b.length;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

const cases: [string, string, string, string][] = [
  ['siblings', 'paragraph one\nparagraph two\nparagraph three', 'ne', 'tw'],
  ['into children', 'paragraph one\n  paragraph child\nparagraph three', 'ne', 'ch'],
  ['out of children', 'paragraph one\n  paragraph child\nparagraph three', 'il', 'th'],
  ['across a code block', 'paragraph one\ncodeBlock let x\nparagraph three', 'ne', 'th'],
  [
    'into a column',
    'paragraph one\ncolumns\n  column\n    paragraph left\n  column\n    paragraph right',
    'ne',
    'le',
  ],
  [
    'across columns',
    'columns\n  column\n    paragraph left\n  column\n    paragraph right\nparagraph after',
    'ef',
    'af',
  ],
];

describe('cross-block selections', () => {
  for (const [name, source, a, b] of cases) {
    it(`deletes ${name} and stays valid`, () => {
      const state = selectBetween(stateOf(source), a, b);
      let next = state;
      deleteSelection(state, (tr) => (next = state.apply(tr)));
      expect(() => next.doc.check()).not.toThrow();
      expect(sketch(next).length).toBeGreaterThan(0);
    });

    it(`types over ${name} and stays valid`, () => {
      const state = selectBetween(stateOf(source), a, b);
      const next = state.apply(state.tr.insertText('X'));
      expect(() => next.doc.check()).not.toThrow();
    });
  }
});

describe('selections into a table', () => {
  it('deletes and types over a selection from a paragraph into a cell', () => {
    const schema = getEditorSchema();
    const table = createTable(schema, 2, 2);
    const cell = schema.nodes['tableCell']!.create(null, schema.text('cell'));
    const row = table.child(0).copy(table.child(0).content.replaceChild(0, cell));
    const filled = table.copy(table.content.replaceChild(0, row));
    const paragraph = schema.nodes['paragraph']!.create(
      null,
      schema.nodes['blockText']!.create(null, schema.text('one')),
    );
    const base = stateOf('paragraph x');
    const state = base.apply(base.tr.replaceWith(0, base.doc.content.size, [paragraph, filled]));
    const selected = selectBetween(state, 'ne', 'ce');
    let next = selected;
    deleteSelection(selected, (tr) => (next = selected.apply(tr)));
    expect(() => next.doc.check()).not.toThrow();
    expect(() => selected.apply(selected.tr.insertText('X')).doc.check()).not.toThrow();
  });
});
