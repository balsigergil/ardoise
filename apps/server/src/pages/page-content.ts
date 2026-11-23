// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page content helpers that work on stored Yjs states: duplication and server-side
 * reads. Duplication edits the Yjs tree directly, so node types the server does not
 * know (plugins, later milestones) are copied untouched.
 */
import { CONTENT_FRAGMENT, projectState, stateToJSON, type DocJSON } from '@ardoise/editor';
import { newId } from '@ardoise/shared';
import * as Y from 'yjs';
import type { Store } from '../store/store.js';

function rewrite(node: Y.XmlFragment | Y.XmlElement, pageIds: ReadonlyMap<string, string>): void {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.getAttribute('blockId') !== undefined) child.setAttribute('blockId', newId());
    if (child.nodeName === 'childPage') {
      const target = child.getAttribute('pageId');
      const copied = typeof target === 'string' ? pageIds.get(target) : undefined;
      if (copied) child.setAttribute('pageId', copied);
    }
    rewrite(child, pageIds);
  }
}

/**
 * A copy of a stored document with fresh block ids; child page blocks point to the
 * copies of their pages when `pageIds` maps them.
 */
export function duplicateState(
  state: Uint8Array,
  pageIds: ReadonlyMap<string, string>,
): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    doc.transact(() => rewrite(doc.getXmlFragment(CONTENT_FRAGMENT), pageIds));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Copies the bodies of `pairs` (source → copy) and projects them, so the copies are
 * searchable at once; pages without content are skipped.
 */
export async function copyDocuments(
  store: Store,
  workspaceId: string,
  pairs: readonly (readonly [string, string, string])[],
  pageIds: ReadonlyMap<string, string>,
  now: Date,
): Promise<number> {
  let copied = 0;
  for (const [sourceId, copyId, title] of pairs) {
    const row = await store.documents.find(workspaceId, `page:${sourceId}`);
    if (!row) continue;
    const state = duplicateState(row.state, pageIds);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    await store.documents.upsert({
      workspaceId,
      docName: `page:${copyId}`,
      pageId: copyId,
      state,
      stateVector: Y.encodeStateVector(doc),
      size: state.byteLength,
      updatedAt: now,
    });
    doc.destroy();
    const projection = projectState(state);
    await store.projection.upsertContent(workspaceId, copyId, title, projection.plainText);
    await store.projection.replaceLinks(
      workspaceId,
      copyId,
      projection.links.filter((l) => l.pageId !== copyId),
    );
    await store.projection.replaceUserMentions(workspaceId, copyId, projection.userMentions);
    copied++;
  }
  return copied;
}

/** The stored body of a page as editor JSON (empty when it has no content yet). */
export async function storedContent(
  store: Store,
  workspaceId: string,
  pageId: string,
): Promise<DocJSON> {
  const row = await store.documents.find(workspaceId, `page:${pageId}`);
  return row ? stateToJSON(row.state) : { type: 'doc', content: [] };
}
