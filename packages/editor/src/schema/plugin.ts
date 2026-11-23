// SPDX-License-Identifier: AGPL-3.0-only
import { Mark, mergeAttributes, Node, type Attribute } from '@tiptap/core';
import { blockColorAttr, intAttr, jsonAttr, stringAttr } from './attributes.js';

/**
 * Reserved plugin types (PLUGINS.md §6.2, ADR 0008/0009). They are part of the core
 * schema so a document never depends on which plugins are installed: without the plugin,
 * the node and its attributes are kept untouched and rendered by a fallback.
 */

/** Size caps (bytes of the JSON encoding). */
export const PLUGIN_NODE_DATA_MAX = 16 * 1024;
export const PLUGIN_MARK_DATA_MAX = 4 * 1024;
export const EXT_PER_PLUGIN_MAX = 4 * 1024;
export const EXT_TOTAL_MAX = 16 * 1024;

const encoder = new TextEncoder();

export function jsonByteSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value ?? null)).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks a plugin node's or mark's `data` against its cap. */
export function isValidPluginData(data: unknown, max = PLUGIN_NODE_DATA_MAX): boolean {
  return isPlainObject(data) && jsonByteSize(data) <= max;
}

/** Checks an `ext` value: `{ [pluginId]: object }` within the per-plugin and total caps. */
export function isValidExt(ext: unknown): boolean {
  if (ext === null) return true;
  if (!isPlainObject(ext)) return false;
  for (const value of Object.values(ext)) {
    if (!isPlainObject(value) || jsonByteSize(value) > EXT_PER_PLUGIN_MAX) return false;
  }
  return jsonByteSize(ext) <= EXT_TOTAL_MAX;
}

function pluginAttrs(): Record<string, Attribute> {
  return {
    plugin: stringAttr('plugin', '', 'data-plugin'),
    // `data-type` is the node's own tag, hence the prefixed names.
    type: stringAttr('type', '', 'data-plugin-type'),
    version: intAttr('version', 1, 1, 1_000_000),
    data: jsonAttr('data', {}, 'data-plugin-data'),
    text: stringAttr('text', '', 'data-plugin-text'),
  };
}

function render(name: string) {
  return ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
    ['div', mergeAttributes({ 'data-type': name }, HTMLAttributes), 0] as const;
}

export const PluginBlock = Node.create({
  name: 'pluginBlock',
  group: 'block flowBlock',
  content: 'children?',
  selectable: true,
  draggable: true,
  addAttributes: pluginAttrs,
  parseHTML: () => [{ tag: 'div[data-type="pluginBlock"]', priority: 100 }],
  renderHTML: render('pluginBlock'),
});

export const PluginContainer = Node.create({
  name: 'pluginContainer',
  group: 'block flowBlock',
  content: 'block+',
  addAttributes: pluginAttrs,
  parseHTML: () => [{ tag: 'div[data-type="pluginContainer"]', priority: 100 }],
  renderHTML: render('pluginContainer'),
});

export const PluginText = Node.create({
  name: 'pluginText',
  group: 'block flowBlock',
  content: 'blockText children?',
  defining: true,
  addAttributes: () => ({ color: blockColorAttr, ...pluginAttrs() }),
  parseHTML: () => [{ tag: 'div[data-type="pluginText"]', priority: 100 }],
  renderHTML: render('pluginText'),
});

export const PluginInline = Node.create({
  name: 'pluginInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: pluginAttrs,
  parseHTML: () => [{ tag: 'span[data-type="pluginInline"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'span',
    mergeAttributes({ 'data-type': 'pluginInline' }, HTMLAttributes),
    String(node.attrs['text']),
  ],
});

/** `excludes: ""` lets several plugin marks with different attributes overlap (§6.4). */
export const PluginMark = Mark.create({
  name: 'pluginMark',
  excludes: '',
  inclusive: false,
  addAttributes: () => {
    const { text: _text, ...attrs } = pluginAttrs();
    return attrs;
  },
  parseHTML: () => [{ tag: 'span[data-type="pluginMark"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes({ 'data-type': 'pluginMark' }, HTMLAttributes),
    0,
  ],
});

export const pluginNodes = [PluginBlock, PluginContainer, PluginText, PluginInline];
