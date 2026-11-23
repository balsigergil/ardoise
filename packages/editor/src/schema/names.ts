// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Node and mark names of the persisted document schema (ADR 0009 §1). These names are
 * stored in every Yjs document: renaming one requires a document migration.
 */

/** Yjs `XmlFragment` that holds a page body. */
export const CONTENT_FRAGMENT = 'content';

/** Text blocks: content `blockText children?`, "turn into" one another with setNodeMarkup. */
export const TEXT_BLOCKS = [
  'paragraph',
  'heading',
  'bulletedItem',
  'numberedItem',
  'todo',
  'toggle',
  'quote',
  'callout',
  'pluginText',
] as const;

/** Blocks without a text part: content `children?`. */
export const LEAF_BLOCKS = [
  'divider',
  'image',
  'file',
  'equation',
  'pageLink',
  'childPage',
  'tableOfContents',
  'bookmark',
  'pluginBlock',
] as const;

/** Blocks with their own structure (no `children`). */
export const STRUCTURED_BLOCKS = ['codeBlock', 'table', 'columns', 'pluginContainer'] as const;

export type TextBlockName = (typeof TEXT_BLOCKS)[number];
export type LeafBlockName = (typeof LEAF_BLOCKS)[number];
export type BlockName = TextBlockName | LeafBlockName | (typeof STRUCTURED_BLOCKS)[number];

/** Every node of the `block` group: they all carry `blockId` and `ext`. */
export const BLOCK_NODES: readonly BlockName[] = [
  ...TEXT_BLOCKS,
  ...LEAF_BLOCKS,
  ...STRUCTURED_BLOCKS,
];

/** Structural nodes, never blocks themselves. */
export const STRUCTURAL_NODES = [
  'doc',
  'text',
  'blockText',
  'codeText',
  'children',
  'tableRow',
  'tableCell',
  'column',
] as const;

export const INLINE_NODES = ['mention', 'inlineEquation', 'hardBreak', 'pluginInline'] as const;

export const MARKS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'textColor',
  'backgroundColor',
  'pluginMark',
] as const;

/** Reserved plugin types (PLUGINS.md §6.2). */
export const PLUGIN_NODES = [
  'pluginBlock',
  'pluginContainer',
  'pluginText',
  'pluginInline',
] as const;

export function isBlockName(name: string): name is BlockName {
  return (BLOCK_NODES as readonly string[]).includes(name);
}

export function isTextBlockName(name: string): name is TextBlockName {
  return (TEXT_BLOCKS as readonly string[]).includes(name);
}
