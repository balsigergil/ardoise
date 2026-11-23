// SPDX-License-Identifier: AGPL-3.0-only
import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection, type Command } from '@tiptap/pm/state';
import {
  blockAt,
  createTextBlock,
  deleteBlocks,
  duplicateBlocks,
  indentBlocks,
  isBlock,
  joinBackward,
  joinForward,
  moveBlocks,
  outdentBlocks,
  splitBlock,
  toggleTodo,
  turnInto,
} from '../commands/blocks.js';

function run(editor: Editor, command: Command): boolean {
  return command(editor.state, editor.view.dispatch, editor.view);
}

function inParent(editor: Editor, name: string): boolean {
  return editor.state.selection.$from.parent.type.name === name;
}

function blockSelected(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && isBlock(selection.node);
}

/** Moves the cursor to the next (or previous) table cell. */
function moveToCell(editor: Editor, direction: 1 | -1): boolean {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== 'tableCell') return false;
  const { doc } = editor.state;
  const cellStart = $from.before();
  const search = direction > 0 ? $from.after() : cellStart;
  const found =
    direction > 0
      ? Selection.findFrom(doc.resolve(search), 1, true)
      : Selection.findFrom(doc.resolve(search), -1, true);
  if (!found || found.$from.parent.type.name !== 'tableCell') return true;
  editor.view.dispatch(editor.state.tr.setSelection(found));
  return true;
}

/** Mod-Enter in a code block: leave it, with a paragraph after the block. */
const exitCode: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'codeText') return false;
  const block = blockAt($from);
  if (!block) return false;
  if (dispatch) {
    const at = block.pos + block.node.nodeSize;
    const tr = state.tr.insert(at, createTextBlock(state.schema, 'paragraph'));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
  }
  return true;
};

/**
 * Block keymap: Enter, Backspace, Delete, Tab, Shift+Tab, moving and duplicating
 * blocks, turning blocks into headings. Registered as the `blockKeymap` behavior.
 */
export const BlockKeymap = Extension.create({
  name: 'blockKeymap',
  priority: 200,
  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      Enter: () => run(editor, splitBlock),
      'Shift-Enter': () => {
        if (!inParent(editor, 'blockText') && !inParent(editor, 'tableCell')) return false;
        return editor.commands.insertContent({ type: 'hardBreak' });
      },
      'Mod-Enter': () => {
        if (run(editor, exitCode)) return true;
        const block = blockAt(editor.state.selection.$from);
        return !!block && run(editor, toggleTodo(block.pos));
      },
      Backspace: () =>
        blockSelected(editor) ? run(editor, deleteBlocks()) : run(editor, joinBackward),
      Delete: () =>
        blockSelected(editor) ? run(editor, deleteBlocks()) : run(editor, joinForward),
      Tab: () => {
        if (inParent(editor, 'codeText')) return editor.commands.insertContent('  ');
        if (moveToCell(editor, 1)) return true;
        run(editor, indentBlocks);
        return true; // never move the focus out of the editor
      },
      'Shift-Tab': () => {
        if (inParent(editor, 'codeText')) return true;
        if (moveToCell(editor, -1)) return true;
        run(editor, outdentBlocks);
        return true;
      },
      'Mod-Shift-ArrowUp': () => run(editor, moveBlocks(-1)),
      'Mod-Shift-ArrowDown': () => run(editor, moveBlocks(1)),
      'Mod-d': () => run(editor, duplicateBlocks()),
      'Mod-Alt-0': () => run(editor, turnInto('paragraph')),
      'Mod-Alt-1': () => run(editor, turnInto('heading', { level: 1 })),
      'Mod-Alt-2': () => run(editor, turnInto('heading', { level: 2 })),
      'Mod-Alt-3': () => run(editor, turnInto('heading', { level: 3 })),
      Escape: () => {
        // Select the block holding the cursor (block selection mode).
        const block = blockAt(editor.state.selection.$from);
        if (!block || blockSelected(editor)) return false;
        editor.view.dispatch(
          editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)),
        );
        return true;
      },
    };
  },
});

/** Inline formatting shortcuts. Links (Mod-K) open the host's link editor. */
export const MarkKeymap = Extension.create({
  name: 'markKeymap',
  addKeyboardShortcuts() {
    const editor = this.editor;
    const toggle = (mark: string) => () => {
      if (inParent(editor, 'codeText')) return true;
      return editor.commands.toggleMark(mark);
    };
    return {
      'Mod-b': toggle('bold'),
      'Mod-i': toggle('italic'),
      'Mod-u': toggle('underline'),
      'Mod-Shift-s': toggle('strike'),
      'Mod-e': toggle('code'),
    };
  },
});
