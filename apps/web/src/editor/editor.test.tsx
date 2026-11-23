// SPDX-License-Identifier: AGPL-3.0-only
import type { SlashItem } from '@ardoise/editor';
import { Editor, type JSONContent } from '@tiptap/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createI18n } from '@/i18n/i18n';
import { collabUrl } from './collab';
import { appendBlocks, childPageIds, dateItems, registry } from './editor-utils';
import { createExtensions } from './extensions';
import { tokenRanges } from './extensions/code-highlight';
import { collapsedKey, localCollapsedStorage } from './extensions/decorations';
import { emptyHandleState, placementAt, type HandleState } from './extensions/drag-handle';
import {
  closedSuggestion,
  createStore,
  handleSuggestionKey,
  type SuggestionState,
} from './extensions/menu-store';
import type { MentionItem } from './extensions/suggestions';
import { formatSize } from './files';
import { flexFor, resizePair } from './nodes/column-view';
import { formatMentionDate } from './nodes/format';
import { renderMath } from './nodes/math';
import { presentUsers } from './ui/presence-model';
import { SlashPopup } from './ui/popups';

// jsdom has no layout: ProseMirror's mousedown handler asks for the element at a point.
if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { value: () => null, configurable: true });
}

globalThis.ClipboardEvent ??= class extends Event {
  readonly clipboardData = null;
} as unknown as typeof ClipboardEvent;

const t = (key: string) => key;
const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function makeEditor(content: JSONContent, pageId = 'page-1') {
  const stores = {
    slash: createStore<SuggestionState<SlashItem>>(closedSuggestion()),
    mention: createStore<SuggestionState<MentionItem>>(closedSuggestion()),
    handle: createStore<HandleState>(emptyHandleState),
  };
  const mentions: string[] = [];
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions({
      registry,
      session: null,
      user: null,
      translate: t,
      placeholder: 'Type',
      decorationLabels: {
        checkbox: 'Done',
        expand: 'Expand',
        collapse: 'Collapse',
        changeIcon: 'Icon',
      },
      collapsedStorage: localCollapsedStorage(pageId),
      stores,
      onSlashAction: () => undefined,
      mentionSearch: (q) => {
        mentions.push(q);
        return Promise.resolve([{ kind: 'date', id: null, date: '2026-11-23', label: 'Today' }]);
      },
    }),
    content,
  });
  document.body.append(editor.view.dom);
  editors.push(editor);
  return { editor, stores, mentions };
}

const bt = (text: string) => ({
  type: 'blockText',
  ...(text && { content: [{ type: 'text', text }] }),
});
const block = (
  type: string,
  text: string,
  attrs: Record<string, unknown> = {},
  children?: JSONContent[],
) => ({
  type,
  attrs: {
    blockId: `0190a000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`,
    ...attrs,
  },
  content: [bt(text), ...(children ? [{ type: 'children', content: children }] : [])],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

describe('editor decorations', () => {
  it('numbers consecutive numbered items', () => {
    const { editor } = makeEditor(
      doc(
        block('numberedItem', 'a'),
        block('numberedItem', 'b'),
        block('paragraph', 'x'),
        block('numberedItem', 'c'),
      ),
    );
    const numbers = [...editor.view.dom.querySelectorAll('[data-type="numberedItem"]')].map((el) =>
      el.getAttribute('data-number'),
    );
    expect(numbers).toEqual(['1.', '2.', '1.']);
  });

  it('toggles a to-do from its checkbox when editable', () => {
    const { editor } = makeEditor(doc(block('todo', 'task')));
    const box = editor.view.dom.querySelector<HTMLButtonElement>('.ardoise-todo-box')!;
    expect(box.getAttribute('aria-checked')).toBe('false');
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(editor.state.doc.firstChild!.attrs['checked']).toBe(true);
    editor.setEditable(false);
    editor.view.dispatch(editor.state.tr.setMeta('editableChanged', true));
    editor.view.dom
      .querySelector<HTMLButtonElement>('.ardoise-todo-box')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(editor.state.doc.firstChild!.attrs['checked']).toBe(true);
  });

  it('collapses toggles per user and remembers it per page', () => {
    const content = doc(
      block('toggle', 'title', { blockId: '0190a000-0000-7000-8000-00000000000a' }, [
        block('paragraph', 'inside'),
      ]),
    );
    const { editor } = makeEditor(content, 'page-x');
    const chevron = () =>
      editor.view.dom.querySelector<HTMLButtonElement>('.ardoise-toggle-chevron')!;
    expect(editor.view.dom.querySelector('.is-collapsed')).toBeNull();
    chevron().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(
      editor.view.dom.querySelector('[data-type="toggle"]')!.classList.contains('is-collapsed'),
    ).toBe(true);
    expect(collapsedKey.getState(editor.state)!.has('0190a000-0000-7000-8000-00000000000a')).toBe(
      true,
    );
    // The document did not change: the state is local.
    expect(editor.state.doc.eq(editor.schema.nodeFromJSON(content))).toBe(true);
    const again = makeEditor(content, 'page-x').editor;
    expect(
      again.view.dom.querySelector('[data-type="toggle"]')!.classList.contains('is-collapsed'),
    ).toBe(true);
  });
});

describe('slash menu and mentions', () => {
  it('opens on "/", filters, and runs the chosen item', async () => {
    const { editor, stores } = makeEditor(doc(block('paragraph', '')));
    editor.commands.setTextSelection(2);
    type(editor, '/head');
    await act(() => Promise.resolve());
    const state = stores.slash.get();
    expect(state.open).toBe(true);
    expect(state.items[0]!.id).toBe('heading1');
    handleSuggestionKey(stores.slash, new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(stores.slash.get().items[stores.slash.get().index]!.id).toBe('heading2');
    handleSuggestionKey(stores.slash, new KeyboardEvent('keydown', { key: 'Enter' }));
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe('heading');
    expect(first.attrs['level']).toBe(2);
    expect(first.textContent).toBe('');
  });

  it('closes with Escape and stays closed in code blocks', async () => {
    const { editor, stores } = makeEditor(
      doc({ type: 'codeBlock', content: [{ type: 'codeText' }] }),
    );
    editor.commands.setTextSelection(2);
    type(editor, '/');
    await act(() => Promise.resolve());
    expect(stores.slash.get().open).toBe(false);
    expect(handleSuggestionKey(stores.slash, new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(
      false,
    );
  });

  it('queries mentions after "@" and inserts the chosen one', async () => {
    const { editor, stores, mentions } = makeEditor(doc(block('paragraph', '')));
    editor.commands.setTextSelection(2);
    type(editor, '@to');
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(mentions.at(-1)).toBe('to');
    expect(stores.mention.get().open).toBe(true);
    handleSuggestionKey(stores.mention, new KeyboardEvent('keydown', { key: 'Enter' }));
    const inline = editor.state.doc.firstChild!.firstChild!;
    expect(inline.firstChild!.type.name).toBe('mention');
    expect(inline.firstChild!.attrs).toMatchObject({ kind: 'date', date: '2026-11-23' });
  });

  it('renders the slash popup grouped and localized', async () => {
    const i18n = createI18n('en');
    const store = createStore<SuggestionState<SlashItem>>({
      ...closedSuggestion(),
      open: true,
      rect: new DOMRect(10, 10, 0, 10),
      items: registry.slashItems().filter((i) => ['text', 'image'].includes(i.id)),
    });
    const { I18nextProvider } = await import('react-i18next');
    render(
      <I18nextProvider i18n={i18n}>
        <SlashPopup store={store} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('option', { name: /Text/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Media')).toBeTruthy();
  });
});

describe('helpers', () => {
  it('offers relative dates and exact ISO dates', () => {
    const now = new Date(2026, 10, 23, 15);
    expect(dateItems('', t, now).map((d) => d.date)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-22',
    ]);
    expect(dateItems('2027-01-02', t, now)[0]).toMatchObject({ date: '2027-01-02' });
    expect(formatMentionDate('2026-11-24', 'en', now)).toEqual({
      label: 'tomorrow',
      relative: true,
    });
    expect(formatMentionDate('2026-12-25', 'fr', now).relative).toBe(false);
  });

  it('lists each present user once, the current one first', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: 'b', name: 'Bob', color: '#111' } }],
      [2, { user: { id: 'a', name: 'Ann', color: '#222' } }],
      [3, { user: { id: 'b', name: 'Bob', color: '#111' } }],
      [4, {}],
    ]);
    expect(presentUsers(states, 3).map((u) => [u.id, u.self])).toEqual([
      ['b', true],
      ['a', false],
    ]);
  });

  it('highlights code by language, memoized', () => {
    const ranges = tokenRanges('const a = "x";', 'javascript');
    expect(ranges.some(([, , cls]) => cls.includes('hljs-keyword'))).toBe(true);
    expect(tokenRanges('const a', 'plain')).toEqual([]);
    expect(tokenRanges('x', 'no-such-language')).toEqual([]);
    expect(tokenRanges('const a = "x";', 'javascript')).toBe(ranges);
  });

  it('places drops before, after, as a child or beside', () => {
    const rect = { left: 0, right: 400, top: 0, bottom: 40 };
    const opts = { columns: true, children: true };
    expect(placementAt(rect, 200, 10, opts)).toBe('before');
    expect(placementAt(rect, 20, 30, opts)).toBe('left');
    expect(placementAt(rect, 390, 30, opts)).toBe('right');
    expect(placementAt(rect, 30, 30, { columns: false, children: true })).toBe('after');
    expect(placementAt(rect, 200, 30, opts)).toBe('child');
    expect(placementAt(rect, 200, 30, { columns: true, children: false })).toBe('after');
  });

  it('resizes neighbouring columns within bounds', () => {
    expect(resizePair(0.5, 0.5, 0.1)).toEqual([0.6, 0.4]);
    expect(resizePair(0.5, 0.5, 0.9)).toEqual([0.9, 0.1]);
    expect(flexFor(null)).toBe('1 1 0%');
    expect(flexFor(0.3)).toBe('0.3 1 0%');
  });

  it('finds child page blocks and moves blocks between documents', () => {
    const { editor } = makeEditor(
      doc(block('paragraph', 'a'), {
        type: 'childPage',
        attrs: { blockId: '0190a000-0000-7000-8000-0000000000c1', pageId: 'p1' },
      }),
    );
    expect([...childPageIds(editor.state.doc)]).toEqual(['p1']);
    const target = new Y.Doc();
    appendBlocks(target, [editor.state.doc.firstChild!]);
    expect(JSON.stringify(target.getXmlFragment('content').toJSON())).toContain('a');
  });

  it('renders math and reports invalid LaTeX', () => {
    expect(renderMath('x^2', false)).toMatchObject({ error: false });
    expect(renderMath('\\frac{', true)).toEqual({ html: '', error: true });
  });

  it('formats sizes and the collab URL', () => {
    expect(formatSize(512, 'en')).toBe('512 B');
    expect(formatSize(1536, 'en')).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024, 'fr')).toBe('5 MB');
    expect(collabUrl({ protocol: 'https:', host: 'ardoise.example' })).toBe(
      'wss://ardoise.example/collab',
    );
    expect(collabUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/collab',
    );
  });
});
