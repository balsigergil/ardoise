// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Persistence of collaborative documents (ARCHITECTURE §5): `page_documents` holds the
 * full encoded Yjs state. Stores are capped by the admin limit and enqueue the
 * projection job, debounced per document.
 */
import type { CollabDocRef, Limits } from '@ardoise/shared';
import type { Logger } from '@nestjs/common';
import * as Y from 'yjs';
import type { Clock } from '../common/clock.js';
import type { JobQueue } from '../jobs/jobs.js';
import type { Store } from '../store/store.js';

/** Delay before projecting a stored document (plan: 5 s). */
export const PROJECTION_DELAY_MS = 5_000;

export type StoreResult = 'stored' | 'too_large' | 'page_gone';

export class CollabPersistence {
  constructor(
    private readonly store: Store,
    private readonly limits: () => Promise<Limits>,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
  ) {}

  /** Applies the stored state to `doc`; a page without a stored state stays empty. */
  async load(ref: CollabDocRef, doc: Y.Doc): Promise<void> {
    const row = await this.store.documents.find(ref.workspaceId, ref.docName);
    if (row) Y.applyUpdate(doc, row.state);
  }

  async save(ref: CollabDocRef, pageId: string, doc: Y.Doc): Promise<StoreResult> {
    const state = Y.encodeStateAsUpdate(doc);
    const { maxDocumentSizeMb } = await this.limits();
    if (state.byteLength > maxDocumentSizeMb * 1024 * 1024) {
      this.logger.warn(
        { workspaceId: ref.workspaceId, docName: ref.docName, size: state.byteLength },
        'document over the size limit, not stored',
      );
      return 'too_large';
    }
    if (!(await this.store.pages.findById(ref.workspaceId, pageId))) return 'page_gone';
    await this.store.documents.upsert({
      workspaceId: ref.workspaceId,
      docName: ref.docName,
      pageId,
      state,
      stateVector: Y.encodeStateVector(doc),
      size: state.byteLength,
      updatedAt: this.clock.now(),
    });
    await this.jobs
      .enqueue(
        'projection.document',
        { workspaceId: ref.workspaceId, pageId, docName: ref.docName },
        {
          debounce: {
            id: `projection:${ref.workspaceId}:${ref.docName}`,
            delayMs: PROJECTION_DELAY_MS,
          },
        },
      )
      .catch((error: unknown) => this.logger.error({ err: error }, 'projection enqueue failed'));
    return 'stored';
  }
}
