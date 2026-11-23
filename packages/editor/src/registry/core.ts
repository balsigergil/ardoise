// SPDX-License-Identifier: AGPL-3.0-only
import { newId } from '@ardoise/shared';
import type { AnyExtension } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { BlockKeymap, MarkKeymap } from '../behaviors/keymap.js';
import { MarkdownShortcuts } from '../behaviors/markdown-shortcuts.js';
import { createPasteConversion, type MarkdownParser } from '../behaviors/paste.js';
import { BlockAttributes } from '../schema/block-attributes.js';
import * as blocks from '../schema/blocks.js';
import { inlineNodes, marks } from '../schema/inline.js';
import {
  PluginBlock,
  PluginContainer,
  PluginInline,
  PluginMark,
  PluginText,
} from '../schema/plugin.js';
import { UniqueBlockIds } from '../schema/unique-block-ids.js';
import {
  EditorRegistry,
  type BlockAction,
  type BlockDefinition,
  type SlashItem,
  type TurnIntoItem,
} from './registry.js';

const label = (id: string) => `editor.blocks.${id}`;

/** Structural nodes, inline nodes, marks and global attributes (not blocks). */
const BASE: readonly AnyExtension[] = [
  blocks.Doc,
  blocks.Text,
  blocks.BlockText,
  blocks.Children,
  ...inlineNodes,
  PluginInline,
  ...marks,
  PluginMark,
  BlockAttributes,
];

/** Actions of the block menu (PRODUCT §6.1). `comment` arrives with M6. */
export const CORE_ACTIONS: readonly BlockAction[] = [
  { id: 'turnInto', labelKey: 'editor.actions.turnInto', icon: 'repeat', multi: true },
  { id: 'color', labelKey: 'editor.actions.color', icon: 'palette', multi: true },
  {
    id: 'duplicate',
    labelKey: 'editor.actions.duplicate',
    icon: 'copy',
    shortcut: 'Mod-D',
    multi: true,
  },
  { id: 'moveTo', labelKey: 'editor.actions.moveTo', icon: 'corner-up-right', multi: true },
  { id: 'copyLink', labelKey: 'editor.actions.copyLink', icon: 'link', multi: false },
  { id: 'delete', labelKey: 'editor.actions.delete', icon: 'trash', shortcut: 'Del', multi: true },
];

const TEXT_ACTIONS = ['turnInto', 'color', 'duplicate', 'moveTo', 'copyLink', 'delete'];
const OTHER_ACTIONS = ['duplicate', 'moveTo', 'copyLink', 'delete'];

function textBlock(schema: Schema, type: string, attrs: Record<string, unknown> = {}): PMNode {
  return schema.nodes[type]!.create(
    { ...attrs, blockId: newId() },
    schema.nodes['blockText']!.create(),
  );
}

function emptyParagraph(schema: Schema): PMNode {
  return textBlock(schema, 'paragraph');
}

/** A table of `rows` × `cols` empty cells with a header row. */
export function createTable(schema: Schema, rows = 3, cols = 3): PMNode {
  const cell = () => schema.nodes['tableCell']!.create();
  const row = () => schema.nodes['tableRow']!.create(null, Array.from({ length: cols }, cell));
  return schema.nodes['table']!.create(
    { blockId: newId(), headerRow: true },
    Array.from({ length: rows }, row),
  );
}

/** `count` columns, each holding an empty paragraph. */
export function createColumns(schema: Schema, count: number): PMNode {
  const column = () => schema.nodes['column']!.create(null, emptyParagraph(schema));
  return schema.nodes['columns']!.create(
    { blockId: newId() },
    Array.from({ length: count }, column),
  );
}

interface CoreBlock {
  name: string;
  extensions: readonly AnyExtension[];
  slash?: readonly SlashItem[];
  turnInto?: readonly TurnIntoItem[];
  actions?: readonly string[];
}

const item = (
  id: string,
  icon: string,
  group: SlashItem['group'],
  block: string,
  extra: Partial<SlashItem> = {},
): SlashItem => ({ id, labelKey: label(id), icon, keywords: [], group, block, ...extra });

const turn = (
  id: string,
  icon: string,
  block: string,
  attrs?: Record<string, unknown>,
): TurnIntoItem => ({
  id,
  labelKey: label(id),
  icon,
  block,
  ...(attrs && { attrs }),
});

const CORE_BLOCKS: readonly CoreBlock[] = [
  {
    name: 'paragraph',
    extensions: [blocks.Paragraph],
    slash: [item('text', 'type', 'basic', 'paragraph', { keywords: ['paragraph', 'plain'] })],
    turnInto: [turn('text', 'type', 'paragraph')],
  },
  {
    name: 'heading',
    extensions: [blocks.Heading],
    slash: [1, 2, 3].flatMap((level) => [
      item(`heading${level}`, `heading-${level}`, 'basic', 'heading', {
        attrs: { level },
        keywords: ['title', `h${level}`],
        shortcut: '#'.repeat(level),
      }),
      item(`toggleHeading${level}`, `heading-${level}`, 'basic', 'heading', {
        attrs: { level, toggle: true },
        keywords: ['toggle', 'collapse', `h${level}`],
      }),
    ]),
    turnInto: [1, 2, 3].map((level) =>
      turn(`heading${level}`, `heading-${level}`, 'heading', { level, toggle: false }),
    ),
  },
  {
    name: 'bulletedItem',
    extensions: [blocks.BulletedItem],
    slash: [
      item('bulletedList', 'list', 'basic', 'bulletedItem', {
        keywords: ['bullet', 'ul'],
        shortcut: '-',
      }),
    ],
    turnInto: [turn('bulletedList', 'list', 'bulletedItem')],
  },
  {
    name: 'numberedItem',
    extensions: [blocks.NumberedItem],
    slash: [
      item('numberedList', 'list-ordered', 'basic', 'numberedItem', {
        keywords: ['number', 'ol'],
        shortcut: '1.',
      }),
    ],
    turnInto: [turn('numberedList', 'list-ordered', 'numberedItem')],
  },
  {
    name: 'todo',
    extensions: [blocks.Todo],
    slash: [
      item('todo', 'square-check', 'basic', 'todo', {
        keywords: ['checkbox', 'task'],
        shortcut: '[]',
      }),
    ],
    turnInto: [turn('todo', 'square-check', 'todo')],
  },
  {
    name: 'toggle',
    extensions: [blocks.Toggle],
    slash: [
      item('toggle', 'chevron-right', 'basic', 'toggle', { keywords: ['collapse', 'details'] }),
    ],
    turnInto: [turn('toggle', 'chevron-right', 'toggle')],
  },
  {
    name: 'quote',
    extensions: [blocks.Quote],
    slash: [
      item('quote', 'quote', 'basic', 'quote', {
        keywords: ['blockquote', 'citation'],
        shortcut: '>',
      }),
    ],
    turnInto: [turn('quote', 'quote', 'quote')],
  },
  {
    name: 'callout',
    extensions: [blocks.Callout],
    slash: [item('callout', 'info', 'basic', 'callout', { keywords: ['note', 'tip', 'warning'] })],
    turnInto: [turn('callout', 'info', 'callout')],
  },
  {
    name: 'divider',
    extensions: [blocks.Divider],
    slash: [
      item('divider', 'minus', 'basic', 'divider', {
        keywords: ['hr', 'separator', 'line'],
        shortcut: '---',
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'childPage',
    extensions: [blocks.ChildPage],
    slash: [
      item('page', 'file-plus', 'basic', 'childPage', {
        action: 'createPage',
        keywords: ['subpage', 'new'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'pageLink',
    extensions: [blocks.PageLink],
    slash: [
      item('pageLink', 'file-symlink', 'basic', 'pageLink', {
        action: 'pickPage',
        keywords: ['link', 'reference'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'image',
    extensions: [blocks.Image],
    slash: [
      item('image', 'image', 'media', 'image', {
        action: 'uploadImage',
        keywords: ['picture', 'photo'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'file',
    extensions: [blocks.File],
    slash: [
      item('file', 'paperclip', 'media', 'file', {
        action: 'uploadFile',
        keywords: ['attachment', 'upload'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'bookmark',
    extensions: [blocks.Bookmark],
    slash: [
      item('bookmark', 'bookmark', 'media', 'bookmark', {
        action: 'bookmark',
        keywords: ['url', 'web', 'preview'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'codeBlock',
    extensions: [blocks.CodeBlock, blocks.CodeText],
    slash: [
      item('code', 'code', 'media', 'codeBlock', { keywords: ['snippet', 'pre'], shortcut: '```' }),
    ],
    turnInto: [turn('code', 'code', 'codeBlock')],
    actions: ['turnInto', 'duplicate', 'moveTo', 'copyLink', 'delete'],
  },
  {
    name: 'table',
    extensions: [blocks.Table, blocks.TableRow, blocks.TableCell],
    slash: [
      item('table', 'table', 'advanced', 'table', {
        create: (schema) => createTable(schema),
        keywords: ['grid'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'columns',
    extensions: [blocks.Columns, blocks.Column],
    slash: [2, 3, 4, 5].map((count) =>
      item(`columns${count}`, 'columns', 'advanced', 'columns', {
        create: (schema) => createColumns(schema, count),
        keywords: ['layout', 'side'],
      }),
    ),
    actions: ['duplicate', 'moveTo', 'copyLink', 'delete'],
  },
  {
    name: 'equation',
    extensions: [blocks.Equation],
    slash: [
      item('equation', 'sigma', 'advanced', 'equation', { keywords: ['math', 'latex', 'formula'] }),
    ],
    actions: OTHER_ACTIONS,
  },
  {
    name: 'tableOfContents',
    extensions: [blocks.TableOfContents],
    slash: [
      item('tableOfContents', 'list-tree', 'advanced', 'tableOfContents', {
        keywords: ['toc', 'outline'],
      }),
    ],
    actions: OTHER_ACTIONS,
  },
  // Reserved plugin types: rendered by fallbacks without the plugin (PLUGINS.md §6.3).
  { name: 'pluginBlock', extensions: [PluginBlock], actions: OTHER_ACTIONS },
  { name: 'pluginContainer', extensions: [PluginContainer], actions: OTHER_ACTIONS },
  { name: 'pluginText', extensions: [PluginText] },
];

/** Inline insertions offered in the slash menu; the host opens the matching picker. */
const INLINE_ITEMS: readonly SlashItem[] = [
  item('mentionUser', 'at-sign', 'inline', 'mention', {
    action: 'mentionUser',
    keywords: ['person', 'user', '@'],
  }),
  item('mentionPage', 'file-text', 'inline', 'mention', {
    action: 'mentionPage',
    keywords: ['page', 'link', '@'],
  }),
  item('mentionDate', 'calendar', 'inline', 'mention', {
    action: 'mentionDate',
    keywords: ['date', 'today', '@'],
  }),
  item('inlineEquation', 'square-function', 'inline', 'inlineEquation', {
    action: 'inlineEquation',
    keywords: ['math', 'latex'],
  }),
];

export interface CoreRegistryOptions {
  /** Markdown → editor JSON, used by paste conversion. */
  parseMarkdown?: MarkdownParser;
}

/** The registry with every core block, action and behavior. */
export function createCoreRegistry(options: CoreRegistryOptions = {}): EditorRegistry {
  const registry = new EditorRegistry(BASE);
  for (const action of CORE_ACTIONS) registry.registerAction(action);
  for (const block of CORE_BLOCKS) {
    const definition: BlockDefinition = {
      name: block.name,
      source: 'core',
      extensions: block.extensions,
      slash: block.slash ?? [],
      turnInto: block.turnInto ?? [],
      actions: block.actions ?? TEXT_ACTIONS,
    };
    registry.registerBlock(definition);
  }
  registry.registerSlashItems(INLINE_ITEMS);
  registry
    .registerBehavior({ id: 'uniqueBlockIds', source: 'core', extension: UniqueBlockIds })
    .registerBehavior({ id: 'blockKeymap', source: 'core', extension: BlockKeymap })
    .registerBehavior({ id: 'markKeymap', source: 'core', extension: MarkKeymap })
    .registerBehavior({ id: 'markdownShortcuts', source: 'core', extension: MarkdownShortcuts })
    .registerBehavior({
      id: 'pasteConversion',
      source: 'core',
      extension: createPasteConversion(options.parseMarkdown),
    });
  return registry;
}
