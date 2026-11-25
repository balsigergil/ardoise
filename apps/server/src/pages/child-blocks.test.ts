// SPDX-License-Identifier: AGPL-3.0-only
import { docFromJSON, docToJSON, nodeFromJSON, type DocJSON } from '@ardoise/editor';
import { newId, positionBetween } from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHarness } from '../testing/harness.js';
import { ensureChildPageBlock, hasChildPageBlock, removeChildPageBlocks } from './child-blocks.js';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190a000-0000-7000-8000-00000000000b';
const C = '0190a000-0000-7000-8000-00000000000c';

const paragraph = (text: string) => ({
  type: 'paragraph',
  attrs: { blockId: `0190a000-0000-7000-8000-0000000001${text.padStart(2, '0')}` },
  content: [{ type: 'blockText', content: [{ type: 'text', text }] }],
});
const childPage = (pageId: string, n: number) => ({
  type: 'childPage',
  attrs: { blockId: `0190a000-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`, pageId },
});

/** Top-level block summaries: `p:<text>` or `page:<page id>`. */
function outline(json: DocJSON): string[] {
  return (json.content ?? []).map((node) => {
    const n = node as { type: string; attrs?: { pageId?: string }; content?: unknown[] };
    if (n.type === 'childPage') return `page:${n.attrs!.pageId!}`;
    const text = JSON.stringify(n.content ?? []).match(/"text":"([^"]*)"/)?.[1] ?? '';
    return `${n.type === 'paragraph' ? 'p' : n.type}:${text}`;
  });
}

describe('child page block helpers', () => {
  it('appends a block once, and the result is valid editor content', () => {
    const doc = docFromJSON({ type: 'doc', content: [paragraph('1')] });
    expect(ensureChildPageBlock(doc, A)).toBe(true);
    expect(ensureChildPageBlock(doc, A)).toBe(false);
    expect(outline(docToJSON(doc))).toEqual(['p:1', `page:${A}`]);
    expect(() => nodeFromJSON(docToJSON(doc))).not.toThrow();
    expect(hasChildPageBlock(doc, A)).toBe(true);
    expect(hasChildPageBlock(doc, B)).toBe(false);
  });

  it('works on a page without content yet', () => {
    const doc = new Y.Doc();
    ensureChildPageBlock(doc, A);
    expect(outline(docToJSON(doc))).toEqual([`page:${A}`]);
    expect(() => nodeFromJSON(docToJSON(doc))).not.toThrow();
  });

  it('places the block after another page block, nested ones included', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [
        childPage(A, 1),
        paragraph('1'),
        {
          ...paragraph('2'),
          content: [
            paragraph('2').content[0],
            { type: 'children', content: [childPage(B, 2), paragraph('3')] },
          ],
        },
      ],
    });
    ensureChildPageBlock(doc, C, { afterPageId: A });
    expect(outline(docToJSON(doc))).toEqual([`page:${A}`, `page:${C}`, 'p:1', 'p:2']);
    const nested = new Y.Doc();
    Y.applyUpdate(nested, Y.encodeStateAsUpdate(doc));
    removeChildPageBlocks(nested, C);
    ensureChildPageBlock(nested, C, { afterPageId: B });
    const json = JSON.stringify(docToJSON(nested));
    expect(json.indexOf(C)).toBeGreaterThan(json.indexOf(B));
    expect(json.indexOf(C)).toBeLessThan(json.indexOf('"text":"3"'));
    // Unknown anchor: at the end.
    const D = '0190a000-0000-7000-8000-00000000000d';
    ensureChildPageBlock(doc, D, { afterPageId: '0190a000-0000-7000-8000-0000000000ff' });
    expect(outline(docToJSON(doc)).at(-1)).toBe(`page:${D}`);
  });

  it('removes every block of a page, at any depth, and keeps the rest', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [
        childPage(A, 1),
        {
          ...paragraph('1'),
          content: [paragraph('1').content[0], { type: 'children', content: [childPage(A, 2)] }],
        },
        childPage(B, 3),
      ],
    });
    expect(removeChildPageBlocks(doc, A)).toBe(2);
    expect(removeChildPageBlocks(doc, A)).toBe(0);
    expect(outline(docToJSON(doc))).toEqual(['p:1', `page:${B}`]);
    expect(JSON.stringify(docToJSON(doc))).not.toContain(A);
  });
});

async function setup() {
  const h = createHarness();
  const owner = await h.createUser();
  const ws = (await h.createWorkspace(owner)).id;
  const ts = await h.defaultTeamspace(ws);
  const parent = await h.createPage(owner, ws, { kind: 'teamspace', id: ts }, 'Parent');
  const other = await h.createPage(owner, ws, { kind: 'teamspace', id: ts }, 'Other');
  await h.runJobs('page.childBlock');
  const blocks = async (pageId: string) => outline(await h.content.read(ws, pageId));
  return { h, owner, ws, ts, parent, other, blocks };
}

describe('page.childBlock', () => {
  it('appends a block for a page created under a page, unless the editor inserts it', async () => {
    const { h, owner, ws, parent, blocks } = await setup();
    const sidebar = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'Sidebar');
    await h.mutate(owner, ws, 'page.create', {
      id: newId(),
      parent: { kind: 'page', id: parent },
      position: positionBetween(null, null),
      appendBlock: false,
    });
    expect(h.jobs.jobs.filter((j) => j.name === 'page.childBlock')).toEqual([
      { name: 'page.childBlock', data: { workspaceId: ws, pageId: sidebar, to: parent } },
    ]);
    await h.runJobs('page.childBlock');
    await h.runJobs('page.childBlock');
    expect(await blocks(parent)).toEqual([`page:${sidebar}`]);
  });

  it('moves the block with the page, and leaves reorders alone', async () => {
    const { h, owner, ws, parent, other, blocks } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'Moved');
    await h.runJobs('page.childBlock');
    await h.mutate(owner, ws, 'page.move', {
      id: page,
      parent: { kind: 'page', id: parent },
      position: positionBetween(null, null),
    });
    expect(h.jobs.jobs.some((j) => j.name === 'page.childBlock')).toBe(false);

    await h.mutate(owner, ws, 'page.move', {
      id: page,
      parent: { kind: 'page', id: other },
      position: positionBetween(null, null),
    });
    await h.runJobs('page.childBlock');
    expect(await blocks(parent)).toEqual([]);
    expect(await blocks(other)).toEqual([`page:${page}`]);

    // Out to a section root: only the removal.
    await h.mutate(owner, ws, 'page.move', {
      id: page,
      parent: { kind: 'private', id: owner.id },
      position: positionBetween(null, null),
    });
    await h.runJobs('page.childBlock');
    expect(await blocks(other)).toEqual([]);
  });

  it('reconciles from the current tree when jobs run late', async () => {
    const { h, owner, ws, parent, other, blocks } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'Quick');
    await h.mutate(owner, ws, 'page.move', {
      id: page,
      parent: { kind: 'page', id: other },
      position: positionBetween(null, null),
    });
    // Both jobs run after the move: the create's job adds nothing to the old parent.
    await h.runJobs('page.childBlock');
    expect(await blocks(parent)).toEqual([]);
    expect(await blocks(other)).toEqual([`page:${page}`]);
  });

  it('keeps the block of a trashed page and does not add another on restore', async () => {
    const { h, owner, ws, parent, blocks } = await setup();
    const page = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'Trashed');
    await h.runJobs('page.childBlock');
    await h.mutate(owner, ws, 'page.trash', { id: page });
    expect(h.jobs.jobs.some((j) => j.name === 'page.childBlock')).toBe(false);
    await h.mutate(owner, ws, 'page.restore', { id: page });
    await h.runJobs('page.childBlock');
    expect(await blocks(parent)).toEqual([`page:${page}`]);

    // A job for a page that is in the trash again adds nothing.
    await h.mutate(owner, ws, 'page.trash', { id: page });
    await h.content.edit(ws, parent, (doc) => void removeChildPageBlocks(doc, page));
    await h.processors.run('page.childBlock', { workspaceId: ws, pageId: page, to: parent });
    expect(await blocks(parent)).toEqual([]);
  });

  it('places a duplicate right after its source', async () => {
    const { h, owner, ws, parent, blocks } = await setup();
    const first = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'First');
    const second = await h.createPage(owner, ws, { kind: 'page', id: parent }, 'Second');
    await h.runJobs('page.childBlock');
    const copy = newId();
    await h.mutate(owner, ws, 'page.duplicate', {
      id: first,
      newId: copy,
      position: positionBetween(null, null),
    });
    await h.runJobs('page.childBlock');
    expect(await blocks(parent)).toEqual([first, copy, second].map((id) => `page:${id}`));
  });
});
