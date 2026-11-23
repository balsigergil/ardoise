// SPDX-License-Identifier: AGPL-3.0-only
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createTable } from '../registry/core.js';
import { getEditorSchema } from '../schema/index.js';
import {
  addColumn,
  addRow,
  cellAt,
  cellPos,
  deleteColumn,
  deleteRow,
  toggleHeader,
} from './table.js';

const schema = getEditorSchema();

function state(rows = 2, cols = 2, at: [number, number] = [0, 0]) {
  const table = createTable(schema, rows, cols);
  const doc = schema.nodes['doc']!.create(null, table);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, cellPos(table, 0, ...at)),
  });
}

function apply(s: EditorState, command: Command): EditorState {
  let next = s;
  expect(command(s, (tr) => (next = s.apply(tr)))).toBe(true);
  next.doc.check();
  return next;
}

const shape = (s: EditorState) => {
  const table = s.doc.firstChild!;
  const rows: number[] = [];
  table.forEach((row) => rows.push(row.childCount));
  return rows;
};

describe('table commands', () => {
  it('adds rows and columns next to the cursor and moves into the new cell', () => {
    let s = apply(state(), addRow('after'));
    expect(shape(s)).toEqual([2, 2, 2]);
    expect(cellAt(s.selection.$from)).toMatchObject({ row: 1, col: 0 });
    s = apply(s, addColumn('before'));
    expect(shape(s)).toEqual([3, 3, 3]);
    expect(cellAt(s.selection.$from)).toMatchObject({ row: 1, col: 0 });
  });

  it('deletes rows and columns but never the last one', () => {
    let s = apply(state(2, 2, [1, 1]), deleteRow);
    expect(shape(s)).toEqual([2]);
    expect(deleteRow(s)).toBe(false);
    s = apply(s, deleteColumn);
    expect(shape(s)).toEqual([1]);
    expect(deleteColumn(s)).toBe(false);
  });

  it('toggles header row and column', () => {
    let s = apply(state(), toggleHeader('headerRow'));
    expect(s.doc.firstChild!.attrs['headerRow']).toBe(false);
    s = apply(s, toggleHeader('headerColumn'));
    expect(s.doc.firstChild!.attrs['headerColumn']).toBe(true);
  });

  it('does nothing outside tables', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'blockText' }] }],
    });
    const s = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(addRow('after')(s)).toBe(false);
  });
});
