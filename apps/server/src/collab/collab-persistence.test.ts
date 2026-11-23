// SPDX-License-Identifier: AGPL-3.0-only
import { docFromJSON, docToJSON } from '@ardoise/editor';
import { newId, parseCollabDocumentName, collabDocumentName, limitsSchema } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHarness, silentLogger } from '../testing/harness.js';
import { CollabPersistence, PROJECTION_DELAY_MS } from './collab-persistence.js';

const json = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph',
      attrs: { blockId: newId() },
      content: [{ type: 'blockText', content: [{ type: 'text', text: 'hello' }] }],
    },
  ],
};

async function setup(maxDocumentSizeMb = 10) {
  const h = createHarness();
  const owner = await h.createUser();
  const ws = await h.createWorkspace(owner);
  const ts = await h.defaultTeamspace(ws.id);
  const page = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Doc');
  const limits = limitsSchema.parse({ maxDocumentSizeMb });
  const persistence = new CollabPersistence(
    h.store,
    () => Promise.resolve(limits),
    h.jobs,
    h.clock,
    silentLogger,
  );
  const ref = parseCollabDocumentName(collabDocumentName(ws.id, page))!;
  return { h, ws, page, persistence, ref };
}

describe('CollabPersistence', () => {
  it('stores the full state and loads it back', async () => {
    const { h, persistence, ref, page } = await setup();
    expect(await persistence.save(ref, page, docFromJSON(json))).toBe('stored');
    const row = await h.store.documents.find(ref.workspaceId, `page:${page}`);
    expect(row).toMatchObject({ pageId: page, size: row!.state.byteLength });
    const loaded = new Y.Doc();
    await persistence.load(ref, loaded);
    expect(docToJSON(loaded)).toEqual(docToJSON(docFromJSON(json)));
  });

  it('enqueues a debounced projection job', async () => {
    const { h, persistence, ref, page } = await setup();
    await persistence.save(ref, page, docFromJSON(json));
    expect(h.jobs.jobs.at(-1)).toEqual({
      name: 'projection.document',
      data: { workspaceId: ref.workspaceId, pageId: page, docName: `page:${page}` },
      options: {
        debounce: {
          id: `projection:${ref.workspaceId}:page:${page}`,
          delayMs: PROJECTION_DELAY_MS,
        },
      },
    });
  });

  it('refuses documents over the size limit', async () => {
    const { h, persistence, ref, page } = await setup(1);
    const doc = new Y.Doc();
    doc.getXmlFragment('content').insert(0, [new Y.XmlText('x'.repeat(1024 * 1024 + 10))]);
    expect(await persistence.save(ref, page, doc)).toBe('too_large');
    expect(await h.store.documents.find(ref.workspaceId, `page:${page}`)).toBeUndefined();
  });

  it('does not store documents of purged pages', async () => {
    const { persistence, ref } = await setup();
    expect(await persistence.save(ref, newId(), docFromJSON(json))).toBe('page_gone');
  });

  it('leaves a page without stored content empty', async () => {
    const { persistence, ref } = await setup();
    const doc = new Y.Doc();
    await persistence.load(ref, doc);
    expect(docToJSON(doc)).toEqual({ type: 'doc', content: [] });
  });
});
