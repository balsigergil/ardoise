// SPDX-License-Identifier: AGPL-3.0-only
/** Helpers of the page editor, kept apart from components (tested without React). */
import { createCoreRegistry, docFromJSON, normalize } from '@ardoise/editor';
import { markdownToDoc } from '@ardoise/markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import type * as Y from 'yjs';
import type { MentionItem } from './extensions/suggestions';

/** The core registry, with Markdown paste conversion (one per tab). */
export const registry = createCoreRegistry({ parseMarkdown: markdownToDoc });

/** Local dates offered by `@` mentions. */
export function dateItems(
  query: string,
  t: (k: string) => string,
  now = new Date(),
): MentionItem[] {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const items: MentionItem[] = [
    { kind: 'date', id: null, date: iso(day(0)), label: t('editor.mention.today') },
    { kind: 'date', id: null, date: iso(day(1)), label: t('editor.mention.tomorrow') },
    { kind: 'date', id: null, date: iso(day(-1)), label: t('editor.mention.yesterday') },
  ];
  const q = normalize(query.trim());
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(query.trim())
    ? [{ kind: 'date' as const, id: null, date: query.trim(), label: query.trim() }]
    : [];
  return [...exact, ...items.filter((i) => !q || normalize(i.label).includes(q))];
}

/** Clones blocks into another Yjs document (move to another page). */
export function appendBlocks(target: Y.Doc, blocks: PMNode[]) {
  const source = docFromJSON({ type: 'doc', content: blocks.map((b) => b.toJSON() as unknown) });
  const clones = source
    .getXmlFragment('content')
    .toArray()
    .map((item) => (item as Y.XmlElement).clone());
  target.getXmlFragment('content').push(clones);
  source.destroy();
}

/** Page ids of the child page blocks of a document. */
export function childPageIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'childPage' && typeof node.attrs['pageId'] === 'string')
      ids.add(node.attrs['pageId']);
    return !node.isTextblock;
  });
  return ids;
}
