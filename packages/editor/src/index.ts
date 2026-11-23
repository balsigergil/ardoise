// SPDX-License-Identifier: AGPL-3.0-only
/** Editor schema, registries, block commands and behaviors (ADR 0009). */
export * from './schema/index.js';
export * from './yjs.js';
export * from './commands/blocks.js';
export * from './registry/index.js';
export * from './projection/projection.js';
export { BlockKeymap, MarkKeymap } from './behaviors/keymap.js';
export {
  BLOCK_SHORTCUTS,
  MARK_SHORTCUTS,
  MarkdownShortcuts,
} from './behaviors/markdown-shortcuts.js';
export {
  createPasteConversion,
  looksLikeMarkdown,
  sliceFromJSON,
  type MarkdownParser,
} from './behaviors/paste.js';
