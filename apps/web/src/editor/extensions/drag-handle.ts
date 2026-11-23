// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drag handles (PRODUCT §6.1): tracks the block under the pointer for the React handle,
 * and drives block drag and drop with our own drop targets (before, after, as a child,
 * or beside a block to make columns), applied with `moveBlocksTo`.
 */
import { blockAt, isBlock, moveBlocksTo, type DropPlacement } from '@ardoise/editor';
import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Store } from './menu-store';

export interface HoveredBlock {
  pos: number;
  /** Rectangle of the block's first line (where the handle goes). */
  rect: DOMRect;
}

export interface DropIndicator {
  rect: DOMRect;
  placement: DropPlacement;
  /** Position of the target block. */
  target: number;
}

export interface HandleState {
  hovered: HoveredBlock | null;
  drop: DropIndicator | null;
  /** Range being dragged, if any. */
  dragging: { from: number; to: number } | null;
}

export const emptyHandleState: HandleState = { hovered: null, drop: null, dragging: null };

export const dragHandleKey = new PluginKey('dragHandle');

/** Indent of a drop "as a child" (px to the right of the block start). */
const CHILD_OFFSET = 48;
/** Share of the width on each side that makes a column. */
const SIDE_ZONE = 0.12;

function lineRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const first = dom.querySelector(':scope > [data-block-text], :scope > pre, :scope > *');
  const rect = (first instanceof HTMLElement ? first : dom).getBoundingClientRect();
  return rect;
}

/** The innermost block at a point, probing a little inside the content when needed. */
export function blockAtPoint(view: EditorView, x: number, y: number): number | null {
  const box = view.dom.getBoundingClientRect();
  const left = Math.min(Math.max(x, box.left + 4), box.right - 4);
  const hit = view.posAtCoords({ left, top: y });
  if (!hit) return null;
  const pos = hit.inside >= 0 ? hit.inside : hit.pos;
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  const node = view.state.doc.nodeAt(pos);
  if (node && isBlock(node)) return pos;
  return blockAt($pos)?.pos ?? null;
}

/** Where a drop at (x, y) over the block at `pos` lands. */
export function placementAt(
  rect: { left: number; right: number; top: number; bottom: number },
  x: number,
  y: number,
  options: { columns: boolean; children: boolean },
): DropPlacement {
  const width = rect.right - rect.left;
  if (options.columns && x < rect.left + width * SIDE_ZONE) return 'left';
  if (options.columns && x > rect.right - width * SIDE_ZONE) return 'right';
  if (y < (rect.top + rect.bottom) / 2) return 'before';
  return options.children && x > rect.left + CHILD_OFFSET ? 'child' : 'after';
}

export interface DragHandleOptions {
  store: Store<HandleState> | null;
}

export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'dragHandle',
  addOptions: () => ({ store: null }),
  addProseMirrorPlugins() {
    const store = this.options.store;
    if (!store) return [];
    const clearDrop = () => store.set((s) => ({ ...s, drop: null }));
    return [
      new Plugin({
        key: dragHandleKey,
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (store.get().dragging) return false;
              const pos = blockAtPoint(view, event.clientX, event.clientY);
              const rect = pos === null ? null : lineRect(view, pos);
              const current = store.get().hovered;
              if (pos === null || !rect) {
                if (current) store.set((s) => ({ ...s, hovered: null }));
              } else if (current?.pos !== pos || current.rect.top !== rect.top) {
                store.set((s) => ({ ...s, hovered: { pos, rect } }));
              }
              return false;
            },
            dragover(view, event) {
              const dragging = store.get().dragging;
              if (!dragging) return false;
              event.preventDefault();
              const pos = blockAtPoint(view, event.clientX, event.clientY);
              if (pos === null || (pos >= dragging.from && pos < dragging.to)) {
                clearDrop();
                return true;
              }
              const node = view.state.doc.nodeAt(pos)!;
              const dom = view.nodeDOM(pos);
              if (!(dom instanceof HTMLElement)) return true;
              const rect = dom.getBoundingClientRect();
              const $pos = view.state.doc.resolve(pos);
              const placement = placementAt(rect, event.clientX, event.clientY, {
                columns: node.type.name !== 'columns' && $pos.parent.type.name !== 'children',
                children: /\bchildren\b/.test(node.type.spec.content ?? ''),
              });
              store.set((s) => ({ ...s, drop: { rect, placement, target: pos } }));
              return true;
            },
            dragleave(_view, event) {
              if (
                !(event.relatedTarget instanceof Node) ||
                !(event.currentTarget as Node).contains(event.relatedTarget)
              ) {
                clearDrop();
              }
              return false;
            },
            drop(view, event) {
              const state = store.get() as HandleState & { target?: number };
              if (!state.dragging) return false;
              event.preventDefault();
              const { from, to } = state.dragging;
              if (state.drop && state.target !== undefined) {
                moveBlocksTo(
                  from,
                  to,
                  state.target,
                  state.drop.placement,
                )(view.state, view.dispatch);
              }
              store.set(emptyHandleState);
              view.focus();
              return true;
            },
            dragend() {
              store.set(emptyHandleState);
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Starts dragging the block at `pos` (or the selected blocks containing it). */
export function startBlockDrag(
  view: EditorView,
  store: Store<HandleState>,
  pos: number,
  range?: { from: number; to: number },
) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const from = range?.from ?? pos;
  const to = range?.to ?? pos + node.nodeSize;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.dragging = { slice: view.state.doc.slice(from, to), move: true };
  store.set({ hovered: null, drop: null, dragging: { from, to } });
}
