// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { sketch } from '../__fixtures__/sketch.js';
import { createCoreRegistry } from '../registry/core.js';
import type { DocJSON } from '../yjs.js';
import { looksLikeMarkdown } from './paste.js';

globalThis.ClipboardEvent ??= class extends Event {
  readonly clipboardData = null;
} as unknown as typeof ClipboardEvent;

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function makeEditor(content: DocJSON, parseMarkdown?: (md: string) => DocJSON): Editor {
  const registry = createCoreRegistry(parseMarkdown ? { parseMarkdown } : {});
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: registry.extensions(),
    content: content as JSONContent,
  });
  editors.push(editor);
  return editor;
}

const para = (text = '') => ({
  type: 'paragraph',
  attrs: { blockId: '0190a000-0000-7000-8000-000000000001' },
  content: [{ type: 'blockText', ...(text && { content: [{ type: 'text', text }] }) }],
});
const doc = (...content: unknown[]): DocJSON => ({ type: 'doc', content });

/** Types `text` one character at a time, through input rules like a user would. */
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

const view = (editor: Editor) => sketch(editor.state, { attrs: ['level', 'checked'] });

describe('Markdown block shortcuts', () => {
  const cases: [string, string][] = [
    ['# ', 'heading:level=1 |'],
    ['## ', 'heading:level=2 |'],
    ['### ', 'heading:level=3 |'],
    ['- ', 'bulletedItem |'],
    ['* ', 'bulletedItem |'],
    ['1. ', 'numberedItem |'],
    ['[] ', 'todo:checked=false |'],
    ['[x] ', 'todo:checked=true |'],
    ['> ', 'quote |'],
    ['```', 'codeBlock |'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" at the start of a paragraph`, () => {
      const editor = makeEditor(doc(para()));
      editor.commands.setTextSelection(2);
      type(editor, input);
      expect(view(editor)).toBe(expected);
    });
  }

  it('keeps the id when converting', () => {
    const editor = makeEditor(doc(para()));
    editor.commands.setTextSelection(2);
    type(editor, '# ');
    expect(editor.state.doc.firstChild!.attrs['blockId']).toBe(
      '0190a000-0000-7000-8000-000000000001',
    );
  });

  it('"---" makes a divider followed by a paragraph', () => {
    const editor = makeEditor(doc(para()));
    editor.commands.setTextSelection(2);
    type(editor, '---');
    expect(view(editor)).toBe('divider\nparagraph |');
  });

  it('does nothing in the middle of text or outside paragraphs', () => {
    const editor = makeEditor(doc(para('ab')));
    editor.commands.setTextSelection(3);
    type(editor, '# ');
    expect(view(editor)).toBe('paragraph a# |b');
  });
});

describe('Markdown mark shortcuts', () => {
  const marksOf = (editor: Editor) => {
    const names: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText) names.push(...n.marks.map((m) => `${m.type.name}:${n.text}`));
    });
    return names;
  };
  it.each([
    ['**bold** ', 'bold:bold'],
    ['*it* ', 'italic:it'],
    ['_it_ ', 'italic:it'],
    ['`c` ', 'code:c'],
    ['~~s~~ ', 'strike:s'],
  ])('%s', (input, expected) => {
    const editor = makeEditor(doc(para()));
    editor.commands.setTextSelection(2);
    type(editor, input);
    expect(marksOf(editor)).toEqual([expected]);
  });
});

describe('block keymap', () => {
  it('Enter splits, Tab indents, Shift+Tab outdents, Backspace turns into a paragraph', () => {
    const editor = makeEditor(doc(para('one')));
    editor.commands.setTextSelection(5);
    press(editor, 'Enter');
    type(editor, '- two');
    expect(view(editor)).toBe('paragraph one\nbulletedItem two|');
    press(editor, 'Tab');
    expect(view(editor)).toBe('paragraph one\n  bulletedItem two|');
    press(editor, 'Tab', { shiftKey: true });
    expect(view(editor)).toBe('paragraph one\nbulletedItem two|');
    editor.commands.setTextSelection(editor.state.selection.from - 3);
    press(editor, 'Backspace');
    expect(view(editor)).toBe('paragraph one\nparagraph |two');
    press(editor, 'Backspace');
    expect(view(editor)).toBe('paragraph one|two');
  });

  it('Shift+Enter inserts a line break', () => {
    const editor = makeEditor(doc(para('ab')));
    editor.commands.setTextSelection(3);
    press(editor, 'Enter', { shiftKey: true });
    expect(editor.state.doc.firstChild!.firstChild!.child(1).type.name).toBe('hardBreak');
  });

  it('gives each new block a unique id', () => {
    const editor = makeEditor(doc(para('abc')));
    editor.commands.setTextSelection(3);
    press(editor, 'Enter');
    press(editor, 'Enter');
    const ids = new Set<string>();
    editor.state.doc.forEach((n) => ids.add(n.attrs['blockId'] as string));
    expect(ids.size).toBe(3);
  });
});

describe('paste conversion', () => {
  it('detects Markdown', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true);
    expect(looksLikeMarkdown('- a\n- b')).toBe(true);
    expect(looksLikeMarkdown('see **this**')).toBe(true);
    expect(looksLikeMarkdown('[x](https://a.b)')).toBe(true);
    expect(looksLikeMarkdown('just some text.')).toBe(false);
  });

  it('converts pasted Markdown with the injected parser', () => {
    const parsed: string[] = [];
    const editor = makeEditor(doc(para()), (md) => {
      parsed.push(md);
      return doc(
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'blockText', content: [{ type: 'text', text: 'T' }] }],
        },
        para('x'),
      );
    });
    editor.commands.setTextSelection(2);
    editor.view.pasteText('# T\n\nx');
    expect(parsed).toEqual(['# T\n\nx']);
    expect(editor.state.doc.firstChild!.type.name).toBe('heading');
  });

  it('splits plain text into one paragraph per line', () => {
    const editor = makeEditor(doc(para()));
    editor.commands.setTextSelection(2);
    editor.view.pasteText('one\ntwo\nthree');
    expect(sketch(editor.state).replace(/\|/g, '')).toBe(
      'paragraph one\nparagraph two\nparagraph three',
    );
  });

  it('maps foreign HTML onto blocks', () => {
    const editor = makeEditor(doc(para()));
    editor.commands.setTextSelection(2);
    editor.view.pasteHTML(
      '<h2>Title</h2><p>Some <b>bold</b> <a href="javascript:x">bad</a></p><ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul><pre><code class="language-ts">let a = 1;</code></pre><blockquote>q</blockquote><hr><script>alert(1)</script>',
    );
    expect(sketch(editor.state, { attrs: ['level', 'language'] }).replace(/\|/g, '')).toBe(
      [
        'heading:level=2 Title',
        'paragraph Some bold bad',
        'bulletedItem a',
        '  bulletedItem nested',
        'bulletedItem b',
        'codeBlock:language=ts let a = 1;',
        'quote q',
        'divider',
      ].join('\n'),
    );
    let links = 0;
    editor.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === 'link')) links++;
    });
    expect(links).toBe(0);
  });
});
