// SPDX-License-Identifier: AGPL-3.0-only
/** Pure helpers used by the editor views (numbering, outline), tested without a DOM. */
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Numbers of numbered list items, keyed by position: consecutive `numberedItem`
 * siblings count from 1, and any other block restarts the count (ADR 0009 §1).
 */
export function listNumbers(doc: PMNode): Map<number, number> {
  const numbers = new Map<number, number>();
  const walk = (node: PMNode, start: number) => {
    let count = 0;
    node.forEach((child, offset) => {
      const pos = start + offset;
      if (child.type.name === 'numberedItem') numbers.set(pos, ++count);
      else count = 0;
      if (!child.isTextblock && !child.isLeaf) walk(child, pos + 1);
    });
  };
  walk(doc, 0);
  return numbers;
}

export interface OutlineEntry {
  pos: number;
  blockId: string | null;
  level: number;
  text: string;
}

/** Headings in document order (table of contents). */
export function outlineOf(doc: PMNode): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      entries.push({
        pos,
        blockId: (node.attrs['blockId'] as string | null) ?? null,
        level: node.attrs['level'] as number,
        text: node.firstChild?.textContent ?? '',
      });
      return true;
    }
    return !node.isTextblock;
  });
  return entries;
}

/** The position of the block with `blockId`, or -1. */
export function findBlock(doc: PMNode, blockId: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.attrs['blockId'] === blockId) {
      found = pos;
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}
