// SPDX-License-Identifier: AGPL-3.0-only
import { docFromJSON, docToJSON, type DocJSON } from '@ardoise/editor';
import { newId } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHarness } from '../testing/harness.js';
import { duplicateState } from './page-content.js';

const bt = (text: string) => ({ type: 'blockText', content: [{ type: 'text', text }] });

describe('duplicateState', () => {
  it('gives every block a fresh id and remaps copied child pages', () => {
    const kept = newId();
    const moved = newId();
    const copy = newId();
    const json: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'a' },
          content: [
            bt('one'),
            {
              type: 'children',
              content: [{ type: 'paragraph', attrs: { blockId: 'b' }, content: [bt('two')] }],
            },
          ],
        },
        { type: 'childPage', attrs: { blockId: 'c', pageId: moved } },
        { type: 'childPage', attrs: { blockId: 'd', pageId: kept } },
      ],
    };
    const out = docToJSON(
      (() => {
        const d = new Y.Doc();
        Y.applyUpdate(
          d,
          duplicateState(Y.encodeStateAsUpdate(docFromJSON(json)), new Map([[moved, copy]])),
        );
        return d;
      })(),
    );
    const ids: string[] = [];
    const walk = (n: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (typeof n.attrs?.['blockId'] === 'string') ids.push(n.attrs['blockId']);
      (n.content as (typeof n)[] | undefined)?.forEach(walk);
    };
    walk(out);
    expect(ids).toHaveLength(4);
    expect(ids.some((id) => ['a', 'b', 'c', 'd'].includes(id))).toBe(false);
    const pages = (out.content as { attrs?: { pageId?: string } }[]).map((n) => n.attrs?.pageId);
    expect(pages).toEqual([undefined, copy, kept]);
  });

  it('keeps node types the server does not know', () => {
    const doc = new Y.Doc();
    const el = new Y.XmlElement('futureBlock');
    el.setAttribute('blockId', 'x');
    el.setAttribute('payload', 'kept');
    doc.getXmlFragment('content').insert(0, [el]);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, duplicateState(Y.encodeStateAsUpdate(doc), new Map()));
    const out = copy.getXmlFragment('content').get(0) as Y.XmlElement;
    expect(out.nodeName).toBe('futureBlock');
    expect(out.getAttribute('payload')).toBe('kept');
    expect(out.getAttribute('blockId')).not.toBe('x');
  });
});

describe('page.duplicate copies content', () => {
  it('copies the bodies of the page and its subpages, searchable at once', async () => {
    const h = createHarness();
    const owner = await h.createUser();
    const ws = await h.createWorkspace(owner);
    const ts = await h.defaultTeamspace(ws.id);
    const root = await h.createPage(owner, ws.id, { kind: 'teamspace', id: ts }, 'Root');
    const sub = await h.createPage(owner, ws.id, { kind: 'page', id: root }, 'Sub');
    const store = async (pageId: string, content: unknown[]) => {
      const state = Y.encodeStateAsUpdate(docFromJSON({ type: 'doc', content }));
      await h.store.documents.upsert({
        workspaceId: ws.id,
        docName: `page:${pageId}`,
        pageId,
        state,
        stateVector: new Uint8Array(),
        size: state.length,
        updatedAt: h.clock.now(),
      });
    };
    await store(root, [
      { type: 'paragraph', attrs: { blockId: newId() }, content: [bt('root body')] },
      { type: 'childPage', attrs: { blockId: newId(), pageId: sub } },
    ]);
    await store(sub, [
      { type: 'paragraph', attrs: { blockId: newId() }, content: [bt('sub body')] },
    ]);
    const copyId = newId();
    await h.mutate(owner, ws.id, 'page.duplicate', { id: root, newId: copyId, position: 'a1' });
    const copied = [...h.store.content.documents.values()].filter(
      (d) => d.pageId !== root && d.pageId !== sub,
    );
    expect(copied).toHaveLength(2);
    const rootCopy = docToJSON(
      (() => {
        const d = new Y.Doc();
        Y.applyUpdate(d, copied.find((c) => c.pageId === copyId)!.state);
        return d;
      })(),
    );
    const childRef = (rootCopy.content as { type: string; attrs: { pageId: string } }[]).find(
      (n) => n.type === 'childPage',
    )!;
    expect(childRef.attrs.pageId).not.toBe(sub);
    expect(copied.map((c) => c.pageId)).toContain(childRef.attrs.pageId);
    expect(h.store.content.search.get(`${ws.id}/${copyId}`)?.plainText).toBe('root body');
  });
});
