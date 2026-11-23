// SPDX-License-Identifier: AGPL-3.0-only
import { newId } from '@ardoise/shared';
import type { Command } from '@tiptap/pm/state';
import {
  canTurnInto,
  createTextBlock,
  insertBlocksAfter,
  selectedBlocks,
  turnInto,
} from '../commands/blocks.js';
import type { SlashItem } from './registry.js';

/** Lowercase, without diacritics, for matching ("Titre" matches "titre", "é" matches "e"). */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const char of text) if (char === query[i]) i++;
  return i === query.length;
}

/** Score of a term against the query: 3 word prefix, 2 substring, 1 subsequence, 0 none. */
function score(query: string, term: string): number {
  const text = normalize(term);
  if (text.split(/[\s-]+/).some((word) => word.startsWith(query))) return 3;
  if (text.includes(query)) return 2;
  return isSubsequence(query, text.replace(/\s+/g, '')) ? 1 : 0;
}

/**
 * Filters slash items with a fuzzy match on the localized label, the keywords and the
 * id; best matches first, registry order otherwise.
 */
export function filterSlashItems(
  items: readonly SlashItem[],
  query: string,
  translate: (key: string) => string,
): SlashItem[] {
  const q = normalize(query.trim());
  if (!q) return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(
        ...[translate(item.labelKey), item.id, ...item.keywords].map((t) => score(q, t)),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Runs a slash item that needs no host action: a text type turns the current empty
 * paragraph into it (keeping its id), anything else is inserted after the current
 * block, replacing it when it is an empty paragraph. Returns false for host actions.
 */
export function slashCommand(item: SlashItem): Command {
  return (state, dispatch, view) => {
    if (item.action) return false;
    const schema = state.schema;
    const type = schema.nodes[item.block];
    if (!type) return false;
    const current = selectedBlocks(state).at(-1);
    const isEmptyParagraph =
      current?.node.type.name === 'paragraph' &&
      current.node.textContent === '' &&
      current.node.childCount === 1;
    if (!item.create && isEmptyParagraph && canTurnInto(current.node, type)) {
      return turnInto(item.block, { ...item.attrs }, [current])(state, dispatch, view);
    }
    const node = item.create
      ? item.create(schema)
      : /\bblockText\b/.test(type.spec.content ?? '')
        ? createTextBlock(schema, item.block, { ...item.attrs })
        : type.create({ ...item.attrs, blockId: newId() });
    return insertBlocksAfter([node])(state, dispatch, view);
  };
}
