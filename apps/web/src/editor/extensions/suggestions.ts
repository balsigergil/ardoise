// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The slash menu (`/`) and mentions (`@`), built on `@tiptap/suggestion`. Items come
 * from the editor registry (slash) or from the host (people, pages, dates); the React
 * popups render the stores.
 */
import {
  filterSlashItems,
  slashCommand,
  type EditorRegistry,
  type SlashItem,
} from '@ardoise/editor';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import {
  closedSuggestion,
  createStore,
  handleSuggestionKey,
  type Store,
  type SuggestionState,
} from './menu-store';

/** What the page editor does for slash items that need the UI. */
export type SlashActionHandler = (action: string, item: SlashItem, editor: Editor) => void;

export const slashKey = new PluginKey('slashMenu');
export const mentionKey = new PluginKey('mentionMenu');

/** Allowed in body text only (not in code, not in table cells). */
function inBlockText(editor: Editor): boolean {
  return editor.state.selection.$from.parent.type.name === 'blockText';
}

function render<T>(
  store: Store<SuggestionState<T>>,
  select: (props: SuggestionProps<T>) => (item: T) => void,
) {
  return () => ({
    onStart: (props: SuggestionProps<T>) =>
      store.set({
        open: true,
        items: props.items,
        index: 0,
        query: props.query,
        rect: props.clientRect?.() ?? null,
        select: select(props),
      }),
    onUpdate: (props: SuggestionProps<T>) =>
      store.set((prev) => ({
        ...prev,
        open: true,
        items: props.items,
        index: Math.min(prev.index, Math.max(0, props.items.length - 1)),
        query: props.query,
        rect: props.clientRect?.() ?? null,
        select: select(props),
      })),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => handleSuggestionKey(store, event),
    onExit: () => store.set(closedSuggestion()),
  });
}

export interface SlashMenuOptions {
  registry: EditorRegistry | null;
  store: Store<SuggestionState<SlashItem>> | null;
  translate: (key: string) => string;
  onAction: SlashActionHandler;
}

export function runSlashItem(
  editor: Editor,
  range: Range,
  item: SlashItem,
  onAction: SlashActionHandler,
) {
  editor.chain().focus().deleteRange(range).run();
  if (item.action) {
    onAction(item.action, item, editor);
    return;
  }
  slashCommand(item)(editor.state, editor.view.dispatch, editor.view);
}

export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: 'slashMenu',
  addOptions: () => ({
    registry: null,
    store: null,
    translate: (k) => k,
    onAction: () => undefined,
  }),
  addProseMirrorPlugins() {
    const { registry, store, translate, onAction } = this.options;
    if (!registry || !store) return [];
    const editor = this.editor;
    return [
      Suggestion<SlashItem>({
        editor,
        pluginKey: slashKey,
        char: '/',
        allowSpaces: false,
        allow: () => inBlockText(editor),
        items: ({ query }) =>
          filterSlashItems(registry.slashItems(), query, translate).slice(0, 40),
        command: ({
          editor: e,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashItem;
        }) => runSlashItem(e, range, props, onAction),
        render: render(store, (props) => (item: SlashItem) => props.command(item)),
      }),
    ];
  },
});

/** An `@` mention candidate. */
export interface MentionItem {
  kind: 'user' | 'page' | 'date';
  id: string | null;
  date: string | null;
  label: string;
  detail?: string;
}

export interface MentionMenuOptions {
  store: Store<SuggestionState<MentionItem>> | null;
  search: ((query: string) => Promise<MentionItem[]>) | null;
}

export function insertMention(editor: Editor, range: Range, item: MentionItem) {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'mention', attrs: { kind: item.kind, id: item.id, date: item.date } },
      { type: 'text', text: ' ' },
    ])
    .run();
}

export const MentionMenu = Extension.create<MentionMenuOptions>({
  name: 'mentionMenu',
  addOptions: () => ({ store: null, search: null }),
  addProseMirrorPlugins() {
    const { store, search } = this.options;
    if (!store || !search) return [];
    const editor = this.editor;
    return [
      Suggestion<MentionItem>({
        editor,
        pluginKey: mentionKey,
        char: '@',
        allowSpaces: true,
        allow: () => inBlockText(editor),
        items: ({ query }) => search(query),
        command: ({
          editor: e,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: MentionItem;
        }) => insertMention(e, range, props),
        render: render(store, (props) => (item: MentionItem) => props.command(item)),
      }),
    ];
  },
});

export { createStore };
