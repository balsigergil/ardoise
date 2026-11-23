// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's extension list: the registry's (schema, behaviors), with the web's node
 * views attached, plus collaboration, presence and the UI plugins (ARCHITECTURE §15:
 * the list is assembled from the registry, not hard-coded in the component).
 */
import { createTextBlock, type EditorRegistry, type SlashItem } from '@ardoise/editor';
import type { CollabUser } from '@ardoise/shared';
import { Extension, type AnyExtension, type NodeViewRenderer } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { ComponentType } from 'react';
import type { DocSession } from '../collab';
import {
  BookmarkView,
  ChildPageView,
  CodeBlockView,
  EquationView,
  FileView,
  ImageView,
  PageLinkView,
  PluginBlockView,
  PluginContainerView,
  TableOfContentsView,
} from '../nodes/block-views';
import { ColumnView } from '../nodes/column-view';
import { InlineEquationView, MentionView } from '../nodes/inline-views';
import { BlockDecorations, type CollapsedStorage, type DecorationLabels } from './decorations';
import { CodeHighlight } from './code-highlight';
import { DragHandle, type HandleState } from './drag-handle';
import { FileDrop, type FileInsertHandler } from './file-drop';
import type { Store, SuggestionState } from './menu-store';
import { MentionMenu, SlashMenu, type MentionItem, type SlashActionHandler } from './suggestions';

type View = ComponentType<ReactNodeViewProps<HTMLElement>>;

/** React node views by node type; other nodes render through their schema `renderHTML`. */
const REACT_VIEWS: Record<string, { view: View; inline?: boolean }> = {
  codeBlock: { view: CodeBlockView },
  image: { view: ImageView },
  file: { view: FileView },
  equation: { view: EquationView },
  pageLink: { view: PageLinkView },
  childPage: { view: ChildPageView },
  tableOfContents: { view: TableOfContentsView },
  bookmark: { view: BookmarkView },
  pluginBlock: { view: PluginBlockView },
  pluginContainer: { view: PluginContainerView },
  mention: { view: MentionView, inline: true },
  inlineEquation: { view: InlineEquationView, inline: true },
};

const columnView: NodeViewRenderer = ({ node, view, getPos }) => new ColumnView(node, view, getPos);

function withViews(extensions: AnyExtension[]): AnyExtension[] {
  return extensions.map((extension) => {
    const react = REACT_VIEWS[extension.name];
    if (react) {
      return extension.extend({
        addNodeView: () =>
          ReactNodeViewRenderer(react.view, {
            as: react.inline ? 'span' : 'div',
            ...(react.inline ? {} : { contentDOMElementTag: 'div' }),
          }),
      });
    }
    if (extension.name === 'column') return extension.extend({ addNodeView: () => columnView });
    return extension;
  });
}

const ensureBlockKey = new PluginKey('ensureBlock');

/**
 * An empty page holds no block (ADR 0009 §1). A click on it, or below the last block,
 * creates a paragraph to type in, so nothing is written until the user acts.
 */
export const EnsureBlock = Extension.create({
  name: 'ensureBlock',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: ensureBlockKey,
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!view.editable || event.target !== view.dom) return false;
            const { doc, schema } = view.state;
            const last = doc.lastChild;
            const lastIsEmptyParagraph =
              last?.type.name === 'paragraph' && last.childCount === 1 && last.textContent === '';
            const box = view.dom.getBoundingClientRect();
            const lastDom = last ? view.nodeDOM(doc.content.size - last.nodeSize) : null;
            const below =
              !(lastDom instanceof HTMLElement) ||
              event.clientY > lastDom.getBoundingClientRect().bottom;
            if (!below || event.clientY > box.bottom) return false;
            event.preventDefault();
            const tr = view.state.tr;
            if (lastIsEmptyParagraph) {
              tr.setSelection(TextSelection.create(doc, doc.content.size - 2));
            } else {
              tr.insert(doc.content.size, createTextBlock(schema, 'paragraph'));
              tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 2));
            }
            view.dispatch(tr.scrollIntoView());
            view.focus();
            return true;
          },
        },
      },
    }),
  ],
});

export interface EditorSetup {
  registry: EditorRegistry;
  /** Collaborative session; null for static content (public pages). */
  session: DocSession | null;
  user: CollabUser | null;
  translate: (key: string) => string;
  placeholder: string;
  decorationLabels: DecorationLabels;
  collapsedStorage: CollapsedStorage | null;
  stores?: {
    slash: Store<SuggestionState<SlashItem>>;
    mention: Store<SuggestionState<MentionItem>>;
    handle: Store<HandleState>;
  };
  onSlashAction?: SlashActionHandler;
  mentionSearch?: (query: string) => Promise<MentionItem[]>;
  onFiles?: FileInsertHandler;
  onCalloutIcon?: (pos: number, anchor: HTMLElement) => void;
}

export function createExtensions(setup: EditorSetup): AnyExtension[] {
  const list: AnyExtension[] = [
    ...withViews(setup.registry.extensions()),
    BlockDecorations.configure({
      storage: setup.collapsedStorage,
      labels: setup.decorationLabels,
      ...(setup.onCalloutIcon && { onCalloutIcon: setup.onCalloutIcon }),
    }),
    CodeHighlight,
    Placeholder.configure({
      placeholder: setup.placeholder,
      showOnlyCurrent: true,
      includeChildren: true,
    }),
  ];
  if (setup.session) {
    list.push(Collaboration.configure({ document: setup.session.doc, field: 'content' }));
    if (setup.user) {
      list.push(
        CollaborationCaret.configure({
          provider: setup.session.provider,
          user: { name: setup.user.name, color: setup.user.color, id: setup.user.id },
        }),
      );
    }
  }
  if (setup.stores) {
    list.push(
      SlashMenu.configure({
        registry: setup.registry,
        store: setup.stores.slash,
        translate: setup.translate,
        onAction: setup.onSlashAction ?? (() => undefined),
      }),
      MentionMenu.configure({ store: setup.stores.mention, search: setup.mentionSearch ?? null }),
      DragHandle.configure({ store: setup.stores.handle }),
      EnsureBlock,
    );
  }
  if (setup.onFiles) list.push(FileDrop.configure({ onFiles: setup.onFiles }));
  return list;
}
