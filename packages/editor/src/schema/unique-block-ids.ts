// SPDX-License-Identifier: AGPL-3.0-only
import { newId } from '@ardoise/shared';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from '@tiptap/pm/transform';
import { ySyncPluginKey } from 'y-prosemirror';

export const uniqueBlockIdsKey = new PluginKey('uniqueBlockIds');

type Range = [from: number, to: number];

/** True when a step may add block nodes or change a block's attributes. */
function mayTouchBlocks(step: Step): boolean {
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    let found = false;
    step.slice.content.descendants((node) => {
      if (found) return false;
      if (node.type.spec.group?.split(' ').includes('block')) found = true;
      return !found;
    });
    return found;
  }
  // Attribute and mark steps: attribute steps may copy or clear a blockId.
  return !(step instanceof AddMarkStep || step instanceof RemoveMarkStep);
}

/** Ranges of the final document touched by the transaction. */
function changedRanges(trs: readonly Transaction[]): Range[] {
  const ranges: Range[] = [];
  for (const tr of trs) {
    for (let i = 0; i < ranges.length; i++) {
      const [from, to] = ranges[i]!;
      ranges[i] = [tr.mapping.map(from, -1), tr.mapping.map(to, 1)];
    }
    tr.steps.forEach((step, index) => {
      const after = tr.mapping.slice(index + 1);
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        ranges.push([after.map(newStart, -1), after.map(newEnd, 1)]);
      });
    });
  }
  return ranges;
}

function inRanges(pos: number, size: number, ranges: Range[]): boolean {
  return ranges.some(([from, to]) => pos < to && pos + size > from);
}

/**
 * Returns the positions of blocks whose `blockId` is missing or duplicated, and must get
 * a fresh id. For duplicates, the occurrence outside the changed ranges keeps its id (a
 * pasted copy is renamed, not the original); otherwise the first one in document order.
 */
export function findBlocksToRename(doc: PMNode, changed: Range[] = []): number[] {
  const byId = new Map<string, { pos: number; changed: boolean }[]>();
  const missing: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.type.spec.group?.split(' ').includes('block')) return true;
    const id = node.attrs['blockId'] as string | null;
    if (!id) missing.push(pos);
    else {
      const list = byId.get(id) ?? [];
      list.push({ pos, changed: inRanges(pos, node.nodeSize, changed) });
      byId.set(id, list);
    }
    return true;
  });
  const rename = [...missing];
  for (const list of byId.values()) {
    if (list.length < 2) continue;
    const keeper = list.find((entry) => !entry.changed) ?? list[0]!;
    for (const entry of list) if (entry !== keeper) rename.push(entry.pos);
  }
  return rename.sort((a, b) => a - b);
}

/**
 * Gives every block a unique `blockId` after local transactions that may add or copy
 * blocks (split, paste, duplicate). Remote (Yjs) transactions are left alone: each
 * client repairs its own edits, which avoids feedback loops.
 */
export const UniqueBlockIds = Extension.create({
  name: 'uniqueBlockIds',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: uniqueBlockIdsKey,
      appendTransaction(trs, _old, state) {
        const local = trs.filter(
          (tr) => tr.docChanged && !tr.getMeta(ySyncPluginKey) && !tr.getMeta(uniqueBlockIdsKey),
        );
        if (local.length === 0 || !local.some((tr) => tr.steps.some(mayTouchBlocks))) return null;
        const positions = findBlocksToRename(state.doc, changedRanges(trs));
        if (positions.length === 0) return null;
        const tr = state.tr;
        for (const pos of positions) tr.setNodeAttribute(pos, 'blockId', newId());
        return tr.setMeta(uniqueBlockIdsKey, true).setMeta('addToHistory', false);
      },
    }),
  ],
});
