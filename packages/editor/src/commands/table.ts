// SPDX-License-Identifier: AGPL-3.0-only
/** Simple-table commands (PRODUCT §6.2: rows, columns, header row and column). */
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection, type Command } from '@tiptap/pm/state';

interface CellRef {
  tablePos: number;
  table: PMNode;
  row: number;
  col: number;
}

/** The table cell holding `$pos`, with its row and column indexes. */
export function cellAt($pos: ResolvedPos): CellRef | null {
  for (let depth = $pos.depth; depth >= 2; depth--) {
    if ($pos.node(depth).type.name !== 'tableCell') continue;
    return {
      tablePos: $pos.before(depth - 2),
      table: $pos.node(depth - 2),
      row: $pos.index(depth - 2),
      col: $pos.index(depth - 1),
    };
  }
  return null;
}

function rebuild(table: PMNode, rows: PMNode[][]): PMNode {
  const schema = table.type.schema;
  return table.type.create(
    table.attrs,
    rows.map((cells) => schema.nodes['tableRow']!.create(null, cells)),
  );
}

function grid(table: PMNode): PMNode[][] {
  const rows: PMNode[][] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => cells.push(cell));
    rows.push(cells);
  });
  return rows;
}

/** Position of the start of cell (row, col) inside the table at `tablePos`. */
export function cellPos(table: PMNode, tablePos: number, row: number, col: number): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  const cells = table.child(row);
  for (let c = 0; c < col; c++) pos += cells.child(c).nodeSize;
  return pos + 1;
}

function replaceTable(ref: CellRef, rows: PMNode[][], focus: [number, number]): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const next = rebuild(ref.table, rows);
    const tr = state.tr.replaceWith(ref.tablePos, ref.tablePos + ref.table.nodeSize, next);
    const [row, col] = focus;
    tr.setSelection(TextSelection.create(tr.doc, cellPos(next, ref.tablePos, row, col)));
    dispatch(tr);
    return true;
  };
}

export function addRow(where: 'before' | 'after'): Command {
  return (state, dispatch, view) => {
    const ref = cellAt(state.selection.$from);
    if (!ref) return false;
    const rows = grid(ref.table);
    const width = rows[0]?.length ?? 1;
    const at = where === 'before' ? ref.row : ref.row + 1;
    const empty = Array.from({ length: width }, () => state.schema.nodes['tableCell']!.create());
    rows.splice(at, 0, empty);
    return replaceTable(ref, rows, [at, ref.col])(state, dispatch, view);
  };
}

export function addColumn(where: 'before' | 'after'): Command {
  return (state, dispatch, view) => {
    const ref = cellAt(state.selection.$from);
    if (!ref) return false;
    const at = where === 'before' ? ref.col : ref.col + 1;
    const rows = grid(ref.table).map((cells) => {
      const copy = [...cells];
      copy.splice(at, 0, state.schema.nodes['tableCell']!.create());
      return copy;
    });
    return replaceTable(ref, rows, [ref.row, at])(state, dispatch, view);
  };
}

/** Deletes the current row; the last row deletes nothing (delete the block instead). */
export const deleteRow: Command = (state, dispatch, view) => {
  const ref = cellAt(state.selection.$from);
  if (!ref || ref.table.childCount <= 1) return false;
  const rows = grid(ref.table);
  rows.splice(ref.row, 1);
  return replaceTable(ref, rows, [Math.min(ref.row, rows.length - 1), ref.col])(
    state,
    dispatch,
    view,
  );
};

export const deleteColumn: Command = (state, dispatch, view) => {
  const ref = cellAt(state.selection.$from);
  if (!ref || ref.table.child(0).childCount <= 1) return false;
  const rows = grid(ref.table).map((cells) => cells.filter((_c, i) => i !== ref.col));
  return replaceTable(ref, rows, [ref.row, Math.min(ref.col, rows[0]!.length - 1)])(
    state,
    dispatch,
    view,
  );
};

export function toggleHeader(kind: 'headerRow' | 'headerColumn'): Command {
  return (state, dispatch) => {
    const ref = cellAt(state.selection.$from);
    if (!ref) return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(ref.tablePos, kind, !ref.table.attrs[kind]));
    return true;
  };
}
