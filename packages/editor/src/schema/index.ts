// SPDX-License-Identifier: AGPL-3.0-only
import { getSchema, type AnyExtension } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { BlockAttributes } from './block-attributes.js';
import { blockNodes } from './blocks.js';
import { inlineNodes, marks } from './inline.js';
import { PluginMark, pluginNodes } from './plugin.js';

export * from './attributes.js';
export * from './names.js';
export * from './blocks.js';
export * from './inline.js';
export * from './plugin.js';
export { BlockAttributes } from './block-attributes.js';
export { findBlocksToRename, UniqueBlockIds, uniqueBlockIdsKey } from './unique-block-ids.js';

/**
 * Extensions that define the persisted schema, with no behavior and no DOM dependency,
 * so the server can decode documents (projection, export, history).
 */
export const schemaExtensions: readonly AnyExtension[] = [
  ...blockNodes,
  ...inlineNodes,
  ...pluginNodes,
  ...marks,
  PluginMark,
  BlockAttributes,
];

let cached: Schema | undefined;

/** The core document schema (ADR 0009 §1). */
export function getEditorSchema(): Schema {
  cached ??= getSchema([...schemaExtensions]);
  return cached;
}
