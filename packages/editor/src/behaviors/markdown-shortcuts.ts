// SPDX-License-Identifier: AGPL-3.0-only
import { newId } from '@ardoise/shared';
import { Extension, InputRule, markInputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { blockAt, createTextBlock, turnBlockInto } from '../commands/blocks.js';

/**
 * Markdown shortcuts typed at the start of a paragraph (PRODUCT §6.1). Each rule turns
 * the paragraph into another block, keeping its id, text after the cursor and children.
 */
interface BlockShortcut {
  find: RegExp;
  block: string;
  attrs?: Record<string, unknown>;
}

export const BLOCK_SHORTCUTS: readonly BlockShortcut[] = [
  { find: /^#\s$/, block: 'heading', attrs: { level: 1 } },
  { find: /^##\s$/, block: 'heading', attrs: { level: 2 } },
  { find: /^###\s$/, block: 'heading', attrs: { level: 3 } },
  { find: /^[-*+]\s$/, block: 'bulletedItem' },
  { find: /^1[.)]\s$/, block: 'numberedItem' },
  { find: /^\[ ?\]\s$/, block: 'todo', attrs: { checked: false } },
  { find: /^\[x\]\s$/i, block: 'todo', attrs: { checked: true } },
  { find: /^>\s$/, block: 'quote' },
  { find: /^```$/, block: 'codeBlock' },
];

/*
 * Tiptap hands input-rule handlers a state bound to the pending transaction
 * (`state.tr`), so the handlers write to it directly.
 */
function blockRule({ find, block, attrs }: BlockShortcut): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range }) => {
      const { $from } = state.selection;
      if ($from.parent.type.name !== 'blockText') return null;
      const current = blockAt($from);
      if (current?.node.type.name !== 'paragraph') return null;
      const type = state.schema.nodes[block];
      if (!type) return null;
      const tr = state.tr;
      tr.delete(range.from, range.to);
      const pos = tr.mapping.map(current.pos);
      turnBlockInto(tr, { node: tr.doc.nodeAt(pos)!, pos, depth: current.depth }, type, attrs);
      tr.setSelection(TextSelection.create(tr.doc, pos + 2));
      return undefined;
    },
  });
}

/** `---` on an empty paragraph: a divider, then a new paragraph for the cursor. */
const dividerRule = new InputRule({
  find: /^---$/,
  handler: ({ state, range }) => {
    const { $from } = state.selection;
    if ($from.parent.type.name !== 'blockText') return null;
    const current = blockAt($from);
    if (current?.node.type.name !== 'paragraph' || current.node.childCount > 1) return null;
    const line = $from.parent.textContent;
    if (line.replace(/-/g, '') !== '' || range.from !== $from.start()) return null;
    const schema = state.schema;
    const divider = schema.nodes['divider']!.create({ blockId: newId() });
    const paragraph = createTextBlock(schema, 'paragraph');
    const tr = state.tr;
    const pos = tr.mapping.map(current.pos);
    const node = tr.doc.nodeAt(pos)!;
    tr.replaceWith(pos, pos + node.nodeSize, [divider, paragraph]);
    tr.setSelection(TextSelection.create(tr.doc, pos + divider.nodeSize + 2));
    return undefined;
  },
});

/** Inline Markdown: `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `~~strike~~`. */
export const MARK_SHORTCUTS = {
  bold: /(?:^|\s)(\*\*(?!\s)([^*]+)(?<!\s)\*\*)$/,
  italic: /(?:^|\s)((?<!\*)\*(?![\s*])([^*]+)(?<![\s*])\*)$/,
  italicUnderscore: /(?:^|\s)(_(?!\s)([^_]+)(?<!\s)_)$/,
  code: /(?:^|\s)(`(?!\s)([^`]+)(?<!\s)`)$/,
  strike: /(?:^|\s)(~~(?!\s)([^~]+)(?<!\s)~~)$/,
} as const;

export const MarkdownShortcuts = Extension.create({
  name: 'markdownShortcuts',
  addInputRules() {
    const marks = this.editor.schema.marks;
    return [
      ...BLOCK_SHORTCUTS.map(blockRule),
      dividerRule,
      markInputRule({ find: MARK_SHORTCUTS.bold, type: marks['bold']! }),
      markInputRule({ find: MARK_SHORTCUTS.italic, type: marks['italic']! }),
      markInputRule({ find: MARK_SHORTCUTS.italicUnderscore, type: marks['italic']! }),
      markInputRule({ find: MARK_SHORTCUTS.code, type: marks['code']! }),
      markInputRule({ find: MARK_SHORTCUTS.strike, type: marks['strike']! }),
    ];
  },
});
