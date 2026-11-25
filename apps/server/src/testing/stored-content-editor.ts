// SPDX-License-Identifier: AGPL-3.0-only
/** A `ContentEditor` over the stored documents, without Hocuspocus (unit tests). */
import { docToJSON, type DocJSON } from '@ardoise/editor';
import * as Y from 'yjs';
import type { Clock } from '../common/clock.js';
import type { ContentEditor } from '../pages/child-blocks.js';
import type { Store } from '../store/store.js';

export class StoredContentEditor implements ContentEditor {
  edits = 0;

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async edit(workspaceId: string, pageId: string, edit: (doc: Y.Doc) => void): Promise<void> {
    const docName = `page:${pageId}`;
    const doc = new Y.Doc();
    try {
      const row = await this.store.documents.find(workspaceId, docName);
      if (row) Y.applyUpdate(doc, row.state);
      edit(doc);
      const state = Y.encodeStateAsUpdate(doc);
      await this.store.documents.upsert({
        workspaceId,
        docName,
        pageId,
        state,
        stateVector: Y.encodeStateVector(doc),
        size: state.byteLength,
        updatedAt: this.clock.now(),
      });
      this.edits++;
    } finally {
      doc.destroy();
    }
  }

  /** The stored body of a page as editor JSON. */
  async read(workspaceId: string, pageId: string): Promise<DocJSON> {
    const row = await this.store.documents.find(workspaceId, `page:${pageId}`);
    if (!row) return { type: 'doc', content: [] };
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    const json = docToJSON(doc);
    doc.destroy();
    return json;
  }
}
