// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side content edits (ADR 0011) through a Hocuspocus direct connection: the edit
 * is applied to the document held in memory (shared with open editors on this node),
 * reaches other nodes through the Valkey extension, and is stored by the usual
 * `onStoreDocument` hook when the connection closes.
 */
import { collabDocumentName } from '@ardoise/shared';
import type { Hocuspocus } from '@hocuspocus/server';
import type * as Y from 'yjs';
import type { ContentEditor } from '../pages/child-blocks.js';

export class HocuspocusContentEditor implements ContentEditor {
  constructor(private readonly hocuspocus: Pick<Hocuspocus, 'openDirectConnection'>) {}

  async edit(workspaceId: string, pageId: string, edit: (doc: Y.Doc) => void): Promise<void> {
    const connection = await this.hocuspocus.openDirectConnection(
      collabDocumentName(workspaceId, pageId),
    );
    try {
      await connection.transact((doc) => edit(doc));
    } finally {
      await connection.disconnect();
    }
  }
}
