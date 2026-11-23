// SPDX-License-Identifier: AGPL-3.0-only
/**
 * View decorations of text blocks: numbers of numbered items, to-do checkboxes, toggle
 * chevrons (with the per-user open/closed state, ADR 0009 §3), callout icons, and the
 * highlight of a multi-block selection. Text blocks keep plain DOM (no React per block),
 * so long pages stay light.
 */
import { listNumbers, selectedBlocks, toggleTodo } from '@ardoise/editor';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export const collapsedKey = new PluginKey<ReadonlySet<string>>('collapsedBlocks');

/** Per-user, per-device open/closed state of toggles (local storage). */
export interface CollapsedStorage {
  load(): Set<string>;
  save(ids: ReadonlySet<string>): void;
}

export function localCollapsedStorage(pageId: string): CollapsedStorage {
  const key = `ardoise:collapsed:${pageId}`;
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        return new Set();
      }
    },
    save(ids) {
      try {
        if (ids.size) localStorage.setItem(key, JSON.stringify([...ids].slice(-2000)));
        else localStorage.removeItem(key);
      } catch {
        // storage full or blocked: the state stays in memory
      }
    },
  };
}

/** Toggles are collapsible: toggle lists and toggle headings. */
export function isCollapsible(node: PMNode): boolean {
  return node.type.name === 'toggle' || (node.type.name === 'heading' && !!node.attrs['toggle']);
}

export interface DecorationLabels {
  checkbox: string;
  expand: string;
  collapse: string;
  changeIcon: string;
}

export interface BlockDecorationsOptions {
  storage: CollapsedStorage | null;
  labels: DecorationLabels;
  /** Opens the icon picker of a callout at `pos`. */
  onCalloutIcon?: (pos: number, anchor: HTMLElement) => void;
}

function button(
  className: string,
  label: string,
  onPress: (event: MouseEvent) => void,
  content = '',
) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.contentEditable = 'false';
  el.setAttribute('aria-label', label);
  el.textContent = content;
  el.addEventListener('mousedown', (event) => {
    event.preventDefault();
    onPress(event);
  });
  return el;
}

function build(
  state: EditorState,
  collapsed: ReadonlySet<string>,
  view: () => EditorView | null,
  options: BlockDecorationsOptions,
) {
  const decorations: Decoration[] = [];
  const numbers = listNumbers(state.doc);
  const editable = () => view()?.editable ?? false;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (!node.type.isInGroup('block')) return true;
    const id = node.attrs['blockId'] as string | null;
    const textPos = pos + 1; // start of the text part
    if (node.type.name === 'numberedItem') {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { 'data-number': `${numbers.get(pos) ?? 1}.` }),
      );
    }
    if (node.type.name === 'todo') {
      const checked = !!node.attrs['checked'];
      decorations.push(
        Decoration.widget(
          textPos + 1,
          () => {
            const el = button('ardoise-todo-box', options.labels.checkbox, () => {
              const v = view();
              if (v && v.editable) toggleTodo(pos)(v.state, v.dispatch);
            });
            el.setAttribute('role', 'checkbox');
            el.setAttribute('aria-checked', String(checked));
            el.dataset['checked'] = String(checked);
            el.disabled = !editable();
            return el;
          },
          { side: -1, key: `todo-${id}-${checked}-${editable()}`, ignoreSelection: true },
        ),
      );
    }
    if (isCollapsible(node) && id) {
      const closed = collapsed.has(id);
      decorations.push(
        Decoration.widget(
          textPos + 1,
          () =>
            button(
              'ardoise-toggle-chevron',
              closed ? options.labels.expand : options.labels.collapse,
              () => {
                const v = view();
                if (v) v.dispatch(v.state.tr.setMeta(collapsedKey, { toggle: id }));
              },
            ),
          { side: -1, key: `toggle-${id}-${closed}`, ignoreSelection: true },
        ),
      );
      if (closed)
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-collapsed' }));
    }
    if (node.type.name === 'callout') {
      const icon = (node.attrs['icon'] as string | null) ?? '💡';
      decorations.push(
        Decoration.widget(
          textPos + 1,
          () => {
            const el = button(
              'ardoise-callout-icon',
              options.labels.changeIcon,
              (event) => {
                if (editable()) options.onCalloutIcon?.(pos, event.currentTarget as HTMLElement);
              },
              icon,
            );
            return el;
          },
          { side: -1, key: `callout-${id}-${icon}`, ignoreSelection: true },
        ),
      );
    }
    return true;
  });
  return DecorationSet.create(state.doc, decorations);
}

/** Highlight of the blocks covered by a selection spanning several blocks. */
function selectionDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const blocks = selectedBlocks(state);
  if (!(selection instanceof NodeSelection) && blocks.length < 2) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    blocks.map((b) =>
      Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: 'is-block-selected' }),
    ),
  );
}

export const BlockDecorations = Extension.create<BlockDecorationsOptions>({
  name: 'blockDecorations',
  addOptions: () => ({
    storage: null,
    labels: { checkbox: 'To-do', expand: 'Expand', collapse: 'Collapse', changeIcon: 'Icon' },
  }),
  addProseMirrorPlugins() {
    const options = this.options;
    let currentView: EditorView | null = null;
    const viewRef = () => currentView;
    const decorationsKey = new PluginKey<DecorationSet>('blockDecorationsSet');
    return [
      new Plugin<ReadonlySet<string>>({
        key: collapsedKey,
        state: {
          init: () => options.storage?.load() ?? new Set<string>(),
          apply(tr, value) {
            const meta = tr.getMeta(collapsedKey) as { toggle: string } | undefined;
            if (!meta) return value;
            const next = new Set(value);
            if (next.has(meta.toggle)) next.delete(meta.toggle);
            else next.add(meta.toggle);
            options.storage?.save(next);
            return next;
          },
        },
      }),
      new Plugin<DecorationSet>({
        key: decorationsKey,
        view(view) {
          currentView = view;
          return { destroy: () => (currentView = null) };
        },
        state: {
          init: (_config, state) =>
            build(state, collapsedKey.getState(state) ?? new Set(), viewRef, options),
          apply(tr, set, _old, state) {
            if (tr.docChanged || tr.getMeta(collapsedKey) || tr.getMeta('editableChanged')) {
              return build(state, collapsedKey.getState(state) ?? new Set(), viewRef, options);
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            const blocks = decorationsKey.getState(state) ?? DecorationSet.empty;
            const selection = selectionDecorations(state);
            return selection === DecorationSet.empty
              ? blocks
              : blocks.add(state.doc, selection.find());
          },
        },
      }),
    ];
  },
});
