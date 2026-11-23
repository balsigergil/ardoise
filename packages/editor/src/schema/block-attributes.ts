// SPDX-License-Identifier: AGPL-3.0-only
import { Extension } from '@tiptap/core';
import { parseJson } from './attributes.js';
import { BLOCK_NODES } from './names.js';
import { isValidExt } from './plugin.js';

/**
 * Global attributes of every block node (ADR 0009 §1, PLUGINS.md §6.5):
 * - `blockId`: stable UUIDv7, unique within its document (see `UniqueBlockIds`);
 * - `ext`: plugin data on core blocks, `{ [pluginId]: object }`, kept when invalid
 *   values are rejected on parse.
 */
export const BlockAttributes = Extension.create({
  name: 'blockAttributes',
  addGlobalAttributes: () => [
    {
      types: [...BLOCK_NODES],
      attributes: {
        blockId: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute('data-block-id'),
          renderHTML: (attrs) =>
            attrs['blockId'] ? { 'data-block-id': String(attrs['blockId']) } : {},
        },
        ext: {
          default: null,
          parseHTML: (el) => {
            const value = parseJson(el.getAttribute('data-ext'), null);
            return isValidExt(value) ? value : null;
          },
          renderHTML: (attrs) =>
            attrs['ext'] == null ? {} : { 'data-ext': JSON.stringify(attrs['ext']) },
        },
      },
    },
  ],
});
