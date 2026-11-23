// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
import { Editor, Extension, type JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import type { Plugin } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { ySyncPlugin } from 'y-prosemirror';
import * as Y from 'yjs';
import { kitchenSink } from '../__fixtures__/documents.js';
import { docFromJSON, docToJSON, nodeFromJSON, type DocJSON } from '../yjs.js';
import { CONTENT_FRAGMENT, schemaExtensions, UniqueBlockIds } from './index.js';

// jsdom has no ClipboardEvent; ProseMirror's pasteHTML only needs the constructor.
globalThis.ClipboardEvent ??= class extends Event {
  readonly clipboardData = null;
} as unknown as typeof ClipboardEvent;

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function makeEditor(content?: DocJSON, extra: Extension[] = []): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...schemaExtensions, UniqueBlockIds, ...extra],
    ...(content && { content: content as JSONContent }),
  });
  editors.push(editor);
  return editor;
}

function blockIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.isInGroup('block')) ids.push(node.attrs['blockId'] as string);
  });
  return ids;
}

const para = (id: string, text: string, ext: unknown = null) => ({
  type: 'paragraph',
  attrs: { blockId: id, ext },
  content: [{ type: 'blockText', content: [{ type: 'text', text }] }],
});

describe('copy and paste', () => {
  it('keeps ext and attributes, and gives the pasted copy fresh block ids', () => {
    const original = '0190a000-0000-7000-8000-00000000aaaa';
    const editor = makeEditor({
      type: 'doc',
      content: [para(original, 'hello', { acme: { p: 2 } })],
    });
    const { doc } = editor.state;
    const slice = new Slice(doc.content, 0, 0);
    const { dom } = editor.view.serializeForClipboard(slice);
    editor.commands.setTextSelection(doc.content.size);
    editor.view.pasteHTML(dom.innerHTML);

    const ids = blockIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(original);
    expect(ids[1]).not.toBe(original);
    const pasted = editor.state.doc.lastChild!;
    expect(pasted.attrs['ext']).toEqual({ acme: { p: 2 } });
    expect(pasted.textContent).toBe('hello');
  });

  it('round-trips the whole kitchen-sink document through the clipboard', () => {
    const json = kitchenSink();
    const editor = makeEditor(json);
    const { dom } = editor.view.serializeForClipboard(new Slice(editor.state.doc.content, 0, 0));
    const target = makeEditor();
    target.view.pasteHTML(dom.innerHTML);
    const strip = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(strip);
      if (node && typeof node === 'object') {
        const { blockId: _b, ...rest } = node as Record<string, unknown>;
        return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, strip(v)]));
      }
      return node;
    };
    expect(strip(target.state.doc.toJSON())).toEqual(strip(nodeFromJSON(json).toJSON()));
  });
});

describe('UniqueBlockIds', () => {
  it('assigns an id to a block inserted without one', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [para('0190a000-0000-7000-8000-000000000001', 'a')],
    });
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'blockText', content: [{ type: 'text', text: 'b' }] }],
    });
    const ids = blockIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(2);
  });

  it('leaves text-only edits alone', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [para('0190a000-0000-7000-8000-000000000001', 'a')],
    });
    const before = editor.state.doc;
    editor.commands.insertContentAt(2, 'xyz');
    expect(blockIds(editor)).toEqual(['0190a000-0000-7000-8000-000000000001']);
    expect(editor.state.doc.textContent).toBe('xyza');
    expect(before).not.toBe(editor.state.doc);
  });
});

/** Two Yjs documents kept in sync while `connected`, each bound to an editor. */
function collabPair() {
  const docs = [new Y.Doc(), new Y.Doc()] as const;
  let connected = true;
  const queues: Uint8Array[][] = [[], []];
  docs.forEach((doc, i) => {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      const other = docs[1 - i]!;
      if (connected) Y.applyUpdate(other, update, 'remote');
      else queues[1 - i]!.push(update);
    });
  });
  const editors = docs.map((doc) =>
    makeEditor(undefined, [
      Extension.create({
        name: 'collab',
        addProseMirrorPlugins: () => [ySyncPlugin(doc.getXmlFragment(CONTENT_FRAGMENT)) as Plugin],
      }),
    ]),
  );
  return {
    docs,
    editors: editors as [Editor, Editor],
    disconnect: () => (connected = false),
    reconnect: () => {
      connected = true;
      queues.forEach((queue, i) => {
        for (const update of queue.splice(0)) Y.applyUpdate(docs[i]!, update, 'remote');
      });
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function pluginMarksAt(editor: Editor, pos: number) {
  return editor.state.doc
    .nodeAt(pos)!
    .marks.filter((m) => m.type.name === 'pluginMark')
    .map((m) => m.attrs['data'] as { id: number })
    .map((d) => d.id)
    .sort();
}

describe('overlapping pluginMark through y-prosemirror (PLUGINS §6.4)', () => {
  it('keeps two overlapping plugin marks with different attributes, across a concurrent edit', async () => {
    const {
      editors: [a, b],
      docs,
      disconnect,
      reconnect,
    } = collabPair();
    await tick();
    a.commands.setContent({
      type: 'doc',
      content: [para('0190a000-0000-7000-8000-000000000001', 'hello world')],
    });
    await tick();
    const mark = (id: number) =>
      a.schema.marks['pluginMark']!.create({
        plugin: 'acme',
        type: 'note',
        version: 1,
        data: { id },
      });
    // Text starts at 2 (doc > paragraph > blockText). "hello world" spans 2..13.
    a.view.dispatch(a.state.tr.addMark(2, 9, mark(1)).addMark(5, 13, mark(2)));
    await tick();
    expect(pluginMarksAt(b, 7)).toEqual([1, 2]);

    disconnect();
    a.commands.insertContentAt(7, 'XX'); // inside the overlap
    b.view.dispatch(
      b.state.tr.addMark(
        3,
        6,
        b.schema.marks['pluginMark']!.create({
          plugin: 'acme',
          type: 'note',
          version: 1,
          data: { id: 3 },
        }),
      ),
    );
    reconnect();
    await tick();

    expect(docToJSON(docs[0])).toEqual(docToJSON(docs[1]));
    expect(a.state.doc.toJSON()).toEqual(b.state.doc.toJSON());
    expect(b.state.doc.textContent).toBe('helloXX world');
    // "helloXX world": h=2 e=3 l=4 l=5 o=6 X=7 X=8 ' '=9 w=10 o=11 r=12.
    expect(pluginMarksAt(b, 4)).toEqual([1, 3]);
    expect(pluginMarksAt(b, 5)).toEqual([1, 2, 3]);
    expect(pluginMarksAt(b, 7)).toEqual([1, 2]); // inside "XX"
    expect(pluginMarksAt(b, 12)).toEqual([2]);
  });

  it('keeps both marks in a stored state decoded on the server', () => {
    const json: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: '0190a000-0000-7000-8000-000000000001' },
          content: [
            {
              type: 'blockText',
              content: [
                {
                  type: 'text',
                  text: 'ab',
                  marks: [
                    {
                      type: 'pluginMark',
                      attrs: { plugin: 'acme', type: 'n', version: 1, data: { id: 1 } },
                    },
                    {
                      type: 'pluginMark',
                      attrs: { plugin: 'acme', type: 'n', version: 1, data: { id: 2 } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const ydoc = docFromJSON(json);
    const restored = nodeFromJSON(docToJSON(ydoc));
    expect(restored.eq(nodeFromJSON(json))).toBe(true);
  });
});
