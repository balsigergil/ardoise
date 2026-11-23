// SPDX-License-Identifier: AGPL-3.0-only
/** Row, column and header controls shown above a table when the cursor is in it. */
import { addColumn, addRow, cellAt, deleteColumn, deleteRow, toggleHeader } from '@ardoise/editor';
import type { Editor } from '@tiptap/core';
import type { Command } from '@tiptap/pm/state';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns2,
  Rows2,
  Trash2,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export function TableToolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const tablePos = useSyncExternalStore(
    (listener) => {
      editor.on('transaction', listener);
      return () => void editor.off('transaction', listener);
    },
    () => (editor.isEditable ? (cellAt(editor.state.selection.$from)?.tablePos ?? -1) : -1),
  );
  if (tablePos < 0) return null;
  const dom = editor.view.nodeDOM(tablePos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  const run = (command: Command) => {
    command(editor.state, editor.view.dispatch);
    editor.view.focus();
  };
  const table = editor.state.doc.nodeAt(tablePos);
  const buttons: [string, React.ReactNode, Command, boolean?][] = [
    [t('editor.table.rowAbove'), <ArrowUpToLine key="ra" className="size-3.5" />, addRow('before')],
    [
      t('editor.table.rowBelow'),
      <ArrowDownToLine key="rb" className="size-3.5" />,
      addRow('after'),
    ],
    [
      t('editor.table.colLeft'),
      <ArrowLeftToLine key="cl" className="size-3.5" />,
      addColumn('before'),
    ],
    [
      t('editor.table.colRight'),
      <ArrowRightToLine key="cr" className="size-3.5" />,
      addColumn('after'),
    ],
    [t('editor.table.deleteRow'), <Rows2 key="dr" className="size-3.5" />, deleteRow, true],
    [t('editor.table.deleteCol'), <Columns2 key="dc" className="size-3.5" />, deleteColumn, true],
  ];
  return createPortal(
    <div
      role="toolbar"
      aria-label={t('editor.blocks.table')}
      className="fixed z-30 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm"
      style={{ left: rect.left, top: Math.max(4, rect.top - 34) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map(([label, icon, command, danger]) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => run(command)}
          className="flex size-7 items-center justify-center rounded hover:bg-accent"
        >
          {danger ? <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
          {icon}
        </button>
      ))}
      <label className="flex items-center gap-1 px-1 text-xs">
        <input
          type="checkbox"
          checked={!!table?.attrs['headerRow']}
          onChange={() => run(toggleHeader('headerRow'))}
        />
        {t('editor.table.headerRow')}
      </label>
      <label className="flex items-center gap-1 px-1 text-xs">
        <input
          type="checkbox"
          checked={!!table?.attrs['headerColumn']}
          onChange={() => run(toggleHeader('headerColumn'))}
        />
        {t('editor.table.headerColumn')}
      </label>
    </div>,
    document.body,
  );
}
