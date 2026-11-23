// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plain DOM node view of a column: its width (a fraction, `null` = equal share) and a
 * resize handle on its right edge that adjusts it and its right neighbour.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';

const MIN = 0.1;

export function flexFor(width: number | null): string {
  return width ? `${width} 1 0%` : '1 1 0%';
}

/** New widths of two neighbours after moving their border by `delta` (fraction of the row). */
export function resizePair(left: number, right: number, delta: number): [number, number] {
  const total = left + right;
  const next = Math.min(total - MIN, Math.max(MIN, left + delta));
  return [Math.round(next * 1000) / 1000, Math.round((total - next) * 1000) / 1000];
}

export class ColumnView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  constructor(
    private node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'ardoise-column';
    this.dom.dataset['type'] = 'column';
    this.dom.style.flex = flexFor(node.attrs['width'] as number | null);
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'ardoise-column-content';
    this.dom.append(this.contentDOM);
    if (view.editable) {
      const handle = document.createElement('div');
      handle.className = 'ardoise-column-resize';
      handle.contentEditable = 'false';
      handle.addEventListener('pointerdown', (e) => this.startResize(e));
      this.dom.append(handle);
    }
  }

  private startResize(event: PointerEvent) {
    event.preventDefault();
    const row = this.dom.parentElement;
    const next = this.dom.nextElementSibling as HTMLElement | null;
    const pos = this.getPos();
    if (!row || !next || pos === undefined) return;
    const rowWidth = row.getBoundingClientRect().width || 1;
    const left0 = this.dom.getBoundingClientRect().width / rowWidth;
    const right0 = next.getBoundingClientRect().width / rowWidth;
    const startX = event.clientX;
    let widths: [number, number] = [left0, right0];
    const move = (e: PointerEvent) => {
      widths = resizePair(left0, right0, (e.clientX - startX) / rowWidth);
      this.dom.style.flex = flexFor(widths[0]);
      next.style.flex = flexFor(widths[1]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const $pos = this.view.state.doc.resolve(pos);
      const columns = $pos.parent;
      const columnsStart = $pos.start();
      // Give every column an explicit width so the row keeps its proportions.
      const tr = this.view.state.tr;
      const all: number[] = [];
      columns.forEach((_c, _o, i) => {
        const el = row.children[i] as HTMLElement | undefined;
        all.push((el?.getBoundingClientRect().width ?? rowWidth / columns.childCount) / rowWidth);
      });
      const index = $pos.index();
      all[index] = widths[0];
      all[index + 1] = widths[1];
      let offset = 0;
      columns.forEach((child, _o, i) => {
        tr.setNodeAttribute(columnsStart + offset, 'width', Math.round(all[i]! * 1000) / 1000);
        offset += child.nodeSize;
      });
      this.view.dispatch(tr);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.style.flex = flexFor(node.attrs['width'] as number | null);
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}
