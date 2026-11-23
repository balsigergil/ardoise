// SPDX-License-Identifier: AGPL-3.0-only
import { blockStartingAt, selectedBlocks, type BlockRef } from '@ardoise/editor';
import type { Editor } from '@tiptap/core';

/** The blocks an action applies to: the selection when it covers `pos`, else that block. */
export function targetBlocks(editor: Editor, pos: number): BlockRef[] {
  const selected = selectedBlocks(editor.state);
  if (selected.length > 1 && selected.some((b) => b.pos === pos)) return selected;
  const block = blockStartingAt(editor.state.doc, pos);
  return block ? [block] : [];
}

/** CSS class of a color swatch in menus. */
export const swatchClass = (color: string) => `ardoise-swatch-${color}`;
