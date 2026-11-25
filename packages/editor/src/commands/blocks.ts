// SPDX-License-Identifier: AGPL-3.0-only
import { newId } from '@ardoise/shared';
import {
  Fragment,
  type Node as PMNode,
  type NodeType,
  type ResolvedPos,
  type Schema,
} from '@tiptap/pm/model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';

/**
 * Block commands over the ADR 0009 structure. They are plain ProseMirror commands so
 * they are unit tested on an `EditorState` without a DOM, and shared by keymaps, the
 * block menu, drag and drop and multi-block selection.
 */

/** A block node and the position just before it. */
export interface BlockRef {
  node: PMNode;
  pos: number;
  depth: number;
}

/** Text blocks that a new line continues (Enter keeps the type). */
export const CONTINUING_BLOCKS = new Set(['bulletedItem', 'numberedItem', 'todo', 'toggle']);

/** Containers of blocks: their content is a list of blocks. */
const CONTAINERS = new Set(['doc', 'children', 'column', 'pluginContainer']);

export function isBlock(node: PMNode): boolean {
  return node.type.isInGroup('block');
}

export function hasTextPart(node: PMNode): boolean {
  const first = node.firstChild;
  return !!first && (first.type.name === 'blockText' || first.type.name === 'codeText');
}

export function acceptsChildren(type: NodeType): boolean {
  return /\bchildren\b/.test(type.spec.content ?? '');
}

export function childrenOf(node: PMNode): PMNode | null {
  const last = node.lastChild;
  return last && last.type.name === 'children' ? last : null;
}

/** The deepest block containing `$pos`. */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (isBlock(node)) return { node, pos: $pos.before(depth), depth };
  }
  return null;
}

/** The block that starts exactly at `pos`. */
export function blockStartingAt(doc: PMNode, pos: number): BlockRef | null {
  const node = doc.nodeAt(pos);
  if (!node || !isBlock(node)) return null;
  const $pos = doc.resolve(pos);
  return { node, pos, depth: $pos.depth + 1 };
}

/**
 * Blocks covered by the selection, as siblings of one container: a node selection of a
 * block, a single block holding the cursor, or every top-most block a text selection
 * spans.
 */
export function selectedBlocks(state: EditorState): BlockRef[] {
  const { selection } = state;
  if (selection instanceof NodeSelection && isBlock(selection.node)) {
    return [{ node: selection.node, pos: selection.from, depth: selection.$from.depth + 1 }];
  }
  const { $from, $to } = selection;
  const shared = $from.sharedDepth($to.pos);
  for (let depth = shared; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (isBlock(node)) return [{ node, pos: $from.before(depth), depth }];
    if (CONTAINERS.has(node.type.name)) {
      if (depth === $from.depth && $from.pos === $to.pos) return [];
      const start = $from.index(depth);
      const end = $to.index(depth);
      const blocks: BlockRef[] = [];
      let pos = $from.start(depth);
      node.forEach((child, _offset, index) => {
        if (index >= start && index <= end && isBlock(child)) {
          blocks.push({ node: child, pos, depth: depth + 1 });
        }
        pos += child.nodeSize;
      });
      return blocks;
    }
  }
  return [];
}

/** A copy of a block subtree with fresh block ids (duplicate, templates, paste). */
export function withFreshIds(node: PMNode): PMNode {
  const mapChildren = (n: PMNode): Fragment => {
    const children: PMNode[] = [];
    n.forEach((child) => children.push(withFreshIds(child)));
    return Fragment.from(children);
  };
  if (node.isText) return node;
  const attrs = isBlock(node) ? { ...node.attrs, blockId: newId() } : node.attrs;
  return node.type.create(attrs, mapChildren(node), node.marks);
}

function blockText(schema: Schema, content?: Fragment | PMNode | null): PMNode {
  return schema.nodes['blockText']!.create(null, content ?? null);
}

/** Creates an empty block of a text type with a fresh id. */
export function createTextBlock(
  schema: Schema,
  type: string,
  attrs: Record<string, unknown> = {},
  content?: Fragment | null,
  children?: Fragment | null,
): PMNode {
  const nodes = [blockText(schema, content)];
  if (children && children.size) nodes.push(schema.nodes['children']!.create(null, children));
  return schema.nodes[type]!.create({ ...attrs, blockId: newId() }, nodes);
}

/** Positions of a block's parts. */
function parts(ref: BlockRef) {
  const textStart = ref.pos + 2; // inside the text part
  const text = hasTextPart(ref.node) ? ref.node.firstChild! : null;
  const children = childrenOf(ref.node);
  const end = ref.pos + ref.node.nodeSize;
  return {
    textStart,
    textEnd: text ? textStart + text.content.size : textStart,
    children,
    /** Start of the children's content, or where a children node would be inserted. */
    childrenContentStart: children ? end - 1 - children.nodeSize + 1 : end - 1,
    childrenContentEnd: children ? end - 2 : end - 1,
    end,
  };
}

/**
 * Removes the node range `[from, to)` and repairs containers left empty: an empty
 * `children` is dropped, an empty column is dropped, and `columns` with a single column
 * left is unwrapped into its blocks.
 */
export function deleteAndRepair(tr: Transaction, from: number, to: number): Transaction {
  const $from = tr.doc.resolve(from);
  const depth = $from.depth;
  const container = $from.node(depth);
  const wholeContainer = depth > 0 && from === $from.start(depth) && to === $from.end(depth);
  if (wholeContainer) {
    const before = $from.before(depth);
    const after = $from.after(depth);
    switch (container.type.name) {
      case 'children':
        return tr.delete(before, after);
      case 'column':
        return deleteColumn(tr, before, after);
      case 'pluginContainer':
        // Its body must hold a block: keep an empty paragraph.
        return tr.replaceWith(from, to, createTextBlock(tr.doc.type.schema, 'paragraph'));
    }
  }
  return tr.delete(from, to);
}

function deleteColumn(tr: Transaction, before: number, after: number): Transaction {
  const $col = tr.doc.resolve(before);
  const columns = $col.parent;
  const columnsPos = $col.before($col.depth);
  if (columns.childCount <= 2) {
    const other = columns.child($col.index() === 0 ? 1 : 0);
    return tr.replaceWith(columnsPos, columnsPos + columns.nodeSize, other.content);
  }
  // Give the removed column's width back to its neighbours by clearing all widths.
  tr.delete(before, after);
  const pos = tr.mapping.map(columnsPos);
  const updated = tr.doc.nodeAt(pos);
  updated?.forEach((_col, offset) => tr.setNodeAttribute(pos + 1 + offset, 'width', null));
  return tr;
}

/** Tab: moves the selected blocks into the children of their previous sibling. */
export const indentBlocks: Command = (state, dispatch) => {
  const blocks = selectedBlocks(state);
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return false;
  const $first = state.doc.resolve(first.pos);
  const prevNode = $first.nodeBefore;
  if (!prevNode || !isBlock(prevNode) || !acceptsChildren(prevNode.type)) return false;
  if (!dispatch) return true;
  const prev: BlockRef = { node: prevNode, pos: first.pos - prevNode.nodeSize, depth: first.depth };
  const from = first.pos;
  const to = last.pos + last.node.nodeSize;
  const moved = state.doc.slice(from, to).content;
  const tr = state.tr.delete(from, to);
  const p = parts(prev);
  let insertAt: number;
  if (p.children) {
    insertAt = p.childrenContentEnd;
    tr.insert(insertAt, moved);
  } else {
    tr.insert(p.childrenContentStart, state.schema.nodes['children']!.create(null, moved));
    insertAt = p.childrenContentStart + 1;
  }
  const { selection } = state;
  const shift = insertAt - from;
  if (selection instanceof NodeSelection)
    tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
  else
    tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Shift+Tab: moves the selected blocks out of their parent's children, right after the
 * parent. Following siblings become children of the last moved block, so the visual
 * order does not change.
 */
export const outdentBlocks: Command = (state, dispatch) => {
  const blocks = selectedBlocks(state);
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return false;
  const $first = state.doc.resolve(first.pos);
  const container = $first.parent;
  if (container.type.name !== 'children') return false;
  if (!dispatch) return true;
  const containerDepth = $first.depth;
  const parentPos = $first.before(containerDepth - 1);
  const parent = $first.node(containerDepth - 1);
  const startIndex = $first.index(containerDepth);
  const endIndex = startIndex + blocks.length - 1;

  const before: PMNode[] = [];
  const moved: PMNode[] = [];
  const following: PMNode[] = [];
  container.forEach((child, _o, index) => {
    if (index < startIndex) before.push(child);
    else if (index <= endIndex) moved.push(child);
    else following.push(child);
  });
  const schema = state.schema;
  if (following.length) {
    const lastMoved = moved.pop()!;
    const own = childrenOf(lastMoved);
    if (acceptsChildren(lastMoved.type)) {
      // Copy: `Fragment.from` keeps the array, which is emptied below.
      const kids = (own ? own.content : Fragment.empty).append(Fragment.from([...following]));
      const content = own
        ? lastMoved.content.replaceChild(lastMoved.childCount - 1, own.copy(kids))
        : lastMoved.content.addToEnd(schema.nodes['children']!.create(null, kids));
      moved.push(lastMoved.copy(content));
      following.length = 0;
    } else moved.push(lastMoved);
  }
  const parentContent = before.length
    ? parent.content.replaceChild(parent.childCount - 1, container.copy(Fragment.from(before)))
    : parent.content.cut(0, parent.content.size - container.nodeSize);
  const newParent = parent.copy(parentContent);
  const replacement = [newParent, ...moved];
  // Blocks that could not take the following siblings keep them after them.
  const tr = state.tr.replaceWith(parentPos, parentPos + parent.nodeSize, replacement);
  if (following.length) {
    tr.insert(parentPos + replacement.reduce((n, b) => n + b.nodeSize, 0), following);
  }
  const shift = parentPos + newParent.nodeSize - first.pos;
  const { selection } = state;
  if (selection instanceof NodeSelection)
    tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
  else
    tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Text block holding an empty cursor, with the cursor's offset in its text part. */
function cursorTextBlock(state: EditorState): { block: BlockRef; $cursor: ResolvedPos } | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return null;
  const $cursor = selection.$cursor;
  if ($cursor.parent.type.name !== 'blockText' && $cursor.parent.type.name !== 'codeText') {
    return null;
  }
  const depth = $cursor.depth - 1;
  return {
    block: { node: $cursor.node(depth), pos: $cursor.before(depth), depth },
    $cursor,
  };
}

function isNested(state: EditorState, block: BlockRef): boolean {
  return state.doc.resolve(block.pos).parent.type.name === 'children';
}

/**
 * Enter in a text block:
 * - on an empty list item, to-do or toggle: outdent it when nested, otherwise turn it
 *   into a paragraph;
 * - at the start of a non-empty block: insert an empty block above (the block keeps its
 *   id and children);
 * - otherwise: move the text after the cursor to a new block, placed as the first child
 *   when the block has children, or right after it. List items, to-dos and toggles are
 *   continued; other types continue as paragraphs.
 */
export const splitBlock: Command = (state, dispatch) => {
  let current = state;
  let tr = state.tr;
  if (!state.selection.empty) {
    tr = tr.deleteSelection();
    current = state.apply(tr);
  }
  const found = cursorTextBlock(current);
  if (!found || found.$cursor.parent.type.name !== 'blockText') return false;
  const { block, $cursor } = found;
  const schema = state.schema;
  const name = block.node.type.name;
  const text = $cursor.parent;

  if (text.content.size === 0 && CONTINUING_BLOCKS.has(name)) {
    if (isNested(current, block)) {
      return outdentBlocks(current, (outdent) => {
        if (!dispatch) return;
        for (const step of outdent.steps) tr.step(step);
        tr.setSelection(outdent.selection.map(tr.doc, tr.mapping.slice(tr.steps.length)));
        dispatch(tr);
      });
    }
    if (dispatch) {
      tr.setNodeMarkup(block.pos, schema.nodes['paragraph'], keepAttrs(block.node));
      dispatch(tr);
    }
    return true;
  }
  if (!dispatch) return true;

  const type = CONTINUING_BLOCKS.has(name) ? name : 'paragraph';
  const attrs = type === 'todo' ? { checked: false } : {};
  const p = parts(block);
  if ($cursor.parentOffset === 0 && text.content.size > 0) {
    tr.insert(block.pos, createTextBlock(schema, type, attrs));
    tr.setSelection(TextSelection.create(tr.doc, $cursor.pos + 4));
    dispatch(tr.scrollIntoView());
    return true;
  }
  const tail = text.content.cut($cursor.parentOffset);
  tr.delete($cursor.pos, p.textEnd);
  const newBlock = createTextBlock(schema, type, attrs, tail);
  const mappedBlock = tr.mapping.map(block.pos);
  const node = tr.doc.nodeAt(mappedBlock)!;
  const mp = parts({ node, pos: mappedBlock, depth: block.depth });
  const insertAt = mp.children ? mp.childrenContentStart : mp.end;
  tr.insert(insertAt, newBlock);
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Attributes kept when a block changes type. */
function keepAttrs(node: PMNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = { blockId: node.attrs['blockId'], ext: node.attrs['ext'] };
  if ('color' in node.attrs) attrs['color'] = node.attrs['color'];
  return attrs;
}

/** The last block in document order inside `node` (itself when it has no children). */
function lastDescendant(ref: BlockRef): BlockRef {
  const kids = childrenOf(ref.node);
  if (!kids || !kids.lastChild) return ref;
  const pos = ref.pos + ref.node.nodeSize - 1 - kids.lastChild.nodeSize - 1;
  return lastDescendant({ node: kids.lastChild, pos, depth: ref.depth + 2 });
}

/** Moves the text of `source` to the end of the text part of `target` (before it). */
function mergeInto(
  state: EditorState,
  target: BlockRef,
  source: BlockRef,
  dispatch: (tr: Transaction) => void,
): boolean {
  const tp = parts(target);
  const sourceText = source.node.firstChild!;
  const kids = childrenOf(source.node);
  const tr = state.tr;
  const targetIsCode = target.node.firstChild!.type.name === 'codeText';
  const content = targetIsCode
    ? sourceText.textContent
      ? Fragment.from(state.schema.text(sourceText.textContent))
      : Fragment.empty
    : sourceText.type.name === 'codeText'
      ? sourceText.textContent
        ? Fragment.from(state.schema.text(sourceText.textContent))
        : Fragment.empty
      : sourceText.content;
  // Source first (it is after the target), so the target's positions stay valid.
  const from = source.pos;
  const to = source.pos + source.node.nodeSize;
  if (kids) tr.replaceWith(from, to, kids.content);
  else deleteAndRepair(tr, from, to);
  tr.insert(tp.textEnd, content);
  tr.setSelection(TextSelection.create(tr.doc, tp.textEnd));
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Backspace at the start of a text block: turns a non-paragraph into a paragraph,
 * outdents a nested paragraph, or merges it into the visually previous text block (its
 * children take its place). A previous block without text gets selected instead.
 */
export const joinBackward: Command = (state, dispatch) => {
  const found = cursorTextBlock(state);
  if (!found || found.$cursor.parentOffset !== 0) return false;
  const { block } = found;
  const name = block.node.type.name;
  if (name === 'codeBlock') {
    if (block.node.textContent !== '') return true;
    return turnInto('paragraph', {}, [block])(state, dispatch);
  }
  if (name !== 'paragraph' && name !== 'pluginText') {
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(block.pos, state.schema.nodes['paragraph'], keepAttrs(block.node)),
      );
    }
    return true;
  }
  if (isNested(state, block)) return outdentBlocks(state, dispatch);
  const $block = state.doc.resolve(block.pos);
  const prevNode = $block.nodeBefore;
  if (!prevNode) {
    // First block of its container: nothing to join with.
    return true;
  }
  const prev: BlockRef = { node: prevNode, pos: block.pos - prevNode.nodeSize, depth: block.depth };
  const target = isBlock(prevNode) ? lastDescendant(prev) : prev;
  if (!isBlock(target.node) || !hasTextPart(target.node)) {
    if (!dispatch) return true;
    const tr = state.tr;
    if (block.node.textContent === '' && !childrenOf(block.node)) {
      deleteAndRepair(tr, block.pos, block.pos + block.node.nodeSize);
    }
    tr.setSelection(NodeSelection.create(tr.doc, target.pos));
    dispatch(tr);
    return true;
  }
  if (!dispatch) return true;
  return mergeInto(state, target, block, dispatch);
};

/** The block after `ref` in document order (first child, next sibling, or an ancestor's). */
function nextInOrder(doc: PMNode, ref: BlockRef): BlockRef | null {
  const kids = childrenOf(ref.node);
  if (kids?.firstChild) {
    const pos = ref.pos + ref.node.nodeSize - 1 - kids.nodeSize + 1;
    return { node: kids.firstChild, pos, depth: ref.depth + 2 };
  }
  let pos = ref.pos + ref.node.nodeSize;
  for (;;) {
    const $pos = doc.resolve(pos);
    const after = $pos.nodeAfter;
    if (after && isBlock(after)) return { node: after, pos, depth: $pos.depth + 1 };
    if ($pos.depth === 0 || $pos.parent.type.name !== 'children') return null;
    // End of a children group: continue after the owning block.
    pos = $pos.after($pos.depth - 1);
  }
}

/** Delete at the end of a text block: merges the next block's text into it. */
export const joinForward: Command = (state, dispatch) => {
  const found = cursorTextBlock(state);
  if (!found) return false;
  const { block, $cursor } = found;
  if ($cursor.parentOffset !== $cursor.parent.content.size) return false;
  const next = nextInOrder(state.doc, block);
  if (!next) return true;
  if (!hasTextPart(next.node)) {
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, next.pos)));
    return true;
  }
  if (!dispatch) return true;
  return mergeInto(state, block, next, dispatch);
};

/** Deletes the given blocks (or the selected ones), repairing emptied containers. */
export function deleteBlocks(refs?: BlockRef[]): Command {
  return (state, dispatch) => {
    const blocks = refs ?? selectedBlocks(state);
    if (!blocks.length) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    const from = blocks[0]!.pos;
    const last = blocks.at(-1)!;
    deleteAndRepair(tr, from, last.pos + last.node.nodeSize);
    const $pos = tr.doc.resolve(Math.min(tr.mapping.map(from), tr.doc.content.size));
    tr.setSelection(Selection.near($pos, -1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Duplicates the selected blocks right after the last one, with fresh ids. A duplicated
 * child page becomes a link to the same page (a page has one place in the tree).
 */
export function duplicateBlocks(refs?: BlockRef[]): Command {
  return (state, dispatch) => {
    const blocks = refs ?? selectedBlocks(state);
    if (!blocks.length) return false;
    if (!dispatch) return true;
    const schema = state.schema;
    const copies = blocks.map(({ node }) => {
      const copy = withFreshIds(node);
      if (copy.type.name !== 'childPage') return copy;
      const { blockId, ext, pageId } = copy.attrs as Record<string, unknown>;
      return schema.nodes['pageLink']!.create({ blockId, ext, pageId }, copy.content);
    });
    const last = blocks.at(-1)!;
    const insertAt = last.pos + last.node.nodeSize;
    const tr = state.tr.insert(insertAt, copies);
    const firstCopy = copies[0]!;
    tr.setSelection(
      hasTextPart(firstCopy)
        ? TextSelection.create(tr.doc, insertAt + 2 + firstCopy.firstChild!.content.size)
        : NodeSelection.create(tr.doc, insertAt),
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Moves the selected blocks one sibling up (-1) or down (+1) within their container. */
export function moveBlocks(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const blocks = selectedBlocks(state);
    const first = blocks[0];
    const last = blocks.at(-1);
    if (!first || !last) return false;
    const from = first.pos;
    const to = last.pos + last.node.nodeSize;
    const $from = state.doc.resolve(from);
    const sibling = direction < 0 ? $from.nodeBefore : state.doc.resolve(to).nodeAfter;
    if (!sibling) return false;
    if (!dispatch) return true;
    const slice = state.doc.slice(from, to).content;
    const tr = state.tr.delete(from, to);
    const insertAt = direction < 0 ? from - sibling.nodeSize : from + sibling.nodeSize;
    tr.insert(insertAt, slice);
    const shift = insertAt - from;
    const { selection } = state;
    if (selection instanceof NodeSelection)
      tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
    else
      tr.setSelection(
        TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift),
      );
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Types a block can be turned into from the block menu or a Markdown shortcut. */
export function canTurnInto(node: PMNode, type: NodeType): boolean {
  const textual = (t: NodeType) =>
    t.name === 'codeBlock' || /^blockText\b/.test(t.spec.content ?? '');
  return textual(node.type) && textual(type) && type.name !== 'pluginText';
}

function textToCode(schema: Schema, node: PMNode): PMNode {
  const text = node.firstChild!;
  let value = '';
  text.forEach((child) => {
    value += child.type.name === 'hardBreak' ? '\n' : child.isText ? child.text : '';
  });
  return schema.nodes['codeText']!.create(null, value ? schema.text(value) : null);
}

function codeToText(schema: Schema, node: PMNode): PMNode {
  const lines = node.firstChild!.textContent.split('\n');
  const content: PMNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push(schema.nodes['hardBreak']!.create());
    if (line) content.push(schema.text(line));
  });
  return blockText(schema, Fragment.from(content));
}

/**
 * Turns the selected blocks into `type` with `attrs`, keeping text, children, `blockId`
 * and `ext`. Between a text block and a code block the text part is rebuilt (marks are
 * dropped). Blocks that cannot be turned are left as they are.
 */
export function turnInto(
  typeName: string,
  attrs: Record<string, unknown> = {},
  refs?: BlockRef[],
): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes[typeName];
    if (!type) return false;
    const blocks = (refs ?? selectedBlocks(state)).filter((b) => canTurnInto(b.node, type));
    if (!blocks.length) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const block of [...blocks].reverse()) turnBlockInto(tr, block, type, attrs);
    const sel = state.selection;
    try {
      tr.setSelection(sel.map(tr.doc, tr.mapping));
    } catch {
      // Keep the default mapped selection.
    }
    dispatch(tr);
    return true;
  };
}

/** Turns one block into `type` inside `tr` (see `turnInto`). */
export function turnBlockInto(
  tr: Transaction,
  block: BlockRef,
  type: NodeType,
  attrs: Record<string, unknown> = {},
): void {
  const schema = type.schema;
  const merged = { ...keepAttrs(block.node), ...attrs };
  if (!('color' in (type.spec.attrs ?? {}))) delete merged['color'];
  const fromCode = block.node.type.name === 'codeBlock';
  const toCode = type.name === 'codeBlock';
  if (fromCode === toCode) {
    tr.setNodeMarkup(block.pos, type, merged);
    return;
  }
  const textPart = toCode ? textToCode(schema, block.node) : codeToText(schema, block.node);
  const content = block.node.content.replaceChild(0, textPart);
  tr.replaceWith(block.pos, block.pos + block.node.nodeSize, type.create(merged, content));
}

/** Sets (or clears with `null`) the color of the selected text blocks. */
export function setBlockColor(color: string | null, refs?: BlockRef[]): Command {
  return (state, dispatch) => {
    const blocks = (refs ?? selectedBlocks(state)).filter((b) => 'color' in b.node.attrs);
    if (!blocks.length) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const block of blocks) tr.setNodeAttribute(block.pos, 'color', color);
    dispatch(tr);
    return true;
  };
}

/** Toggles the checkbox of a to-do block at `pos`. */
export function toggleTodo(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type.name !== 'todo') return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(pos, 'checked', !node.attrs['checked']));
    return true;
  };
}

/** Where a dragged block lands relative to a target block. */
export type DropPlacement = 'before' | 'after' | 'child' | 'left' | 'right';

/**
 * Moves the blocks `[from, to)` next to the block at `targetPos`. `left`/`right` put them
 * in a column beside the target: inside the target's `columns` when it is already in a
 * column (up to 5), otherwise by wrapping the target in a new two-column layout.
 */
export function moveBlocksTo(
  from: number,
  to: number,
  targetPos: number,
  placement: DropPlacement,
): Command {
  return (state, dispatch) => {
    const target = state.doc.nodeAt(targetPos);
    if (!target || !isBlock(target)) return false;
    if (targetPos >= from && targetPos < to) return false; // onto itself
    const schema = state.schema;
    const moved = state.doc.slice(from, to).content;
    const $target = state.doc.resolve(targetPos);
    if (placement === 'left' || placement === 'right') {
      if (moved.childCount === 0) return false;
      let hasColumns = false;
      moved.forEach((n) => {
        if (n.type.name === 'columns') hasColumns = true;
      });
      if (hasColumns) return false; // columns do not nest
      const inColumnsAlready = $target.parent.type.name === 'column';
      if (inColumnsAlready && $target.node($target.depth - 1).childCount >= 5) return false;
    }
    if (placement === 'child' && !acceptsChildren(target.type)) return false;
    // A block cannot move inside itself.
    if (from < targetPos && targetPos < to) return false;
    if (!dispatch) return true;

    const tr = state.tr;
    deleteAndRepair(tr, from, to);
    const mapped = tr.mapping.mapResult(targetPos, 1);
    if (mapped.deleted) return false;
    const pos = mapped.pos;
    const node = tr.doc.nodeAt(pos)!;
    const ref: BlockRef = { node, pos, depth: tr.doc.resolve(pos).depth + 1 };
    let insertedAt: number;
    switch (placement) {
      case 'before':
        insertedAt = pos;
        tr.insert(pos, moved);
        break;
      case 'after':
        insertedAt = pos + node.nodeSize;
        tr.insert(insertedAt, moved);
        break;
      case 'child': {
        const p = parts(ref);
        if (p.children) {
          insertedAt = p.childrenContentStart;
          tr.insert(insertedAt, moved);
        } else {
          tr.insert(p.childrenContentStart, schema.nodes['children']!.create(null, moved));
          insertedAt = p.childrenContentStart + 1;
        }
        break;
      }
      default: {
        const column = schema.nodes['column']!.create(null, moved);
        const $pos = tr.doc.resolve(pos);
        if ($pos.parent.type.name === 'column') {
          const columnPos = $pos.before($pos.depth);
          const columnNode = $pos.parent;
          const at = placement === 'left' ? columnPos : columnPos + columnNode.nodeSize;
          tr.insert(at, column);
          insertedAt = at + 1;
          const columnsPos = tr.doc.resolve(at).before();
          const columns = tr.doc.nodeAt(columnsPos)!;
          columns.forEach((_c, offset) =>
            tr.setNodeAttribute(columnsPos + 1 + offset, 'width', null),
          );
        } else {
          const targetColumn = schema.nodes['column']!.create(null, node);
          const pair = placement === 'left' ? [column, targetColumn] : [targetColumn, column];
          const columns = schema.nodes['columns']!.create({ blockId: newId() }, pair);
          tr.replaceWith(pos, pos + node.nodeSize, columns);
          insertedAt = placement === 'left' ? pos + 2 : pos + 2 + targetColumn.nodeSize;
        }
      }
    }
    const firstMoved = tr.doc.nodeAt(insertedAt);
    if (firstMoved) {
      tr.setSelection(
        hasTextPart(firstMoved)
          ? TextSelection.create(tr.doc, insertedAt + 2)
          : NodeSelection.create(tr.doc, insertedAt),
      );
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Inserts blocks after the selected block (or at the end), selecting the first one. */
export function insertBlocksAfter(nodes: PMNode[], replaceEmpty = true): Command {
  return (state, dispatch) => {
    if (!nodes.length) return false;
    if (!dispatch) return true;
    const blocks = selectedBlocks(state);
    const last = blocks.at(-1);
    const tr = state.tr;
    let insertAt: number;
    if (
      last &&
      replaceEmpty &&
      hasTextPart(last.node) &&
      last.node.content.size === 2 &&
      last.node.type.name === 'paragraph'
    ) {
      // An empty paragraph (e.g. where "/" was typed) is replaced.
      insertAt = last.pos;
      tr.replaceWith(last.pos, last.pos + last.node.nodeSize, nodes);
    } else {
      insertAt = last ? last.pos + last.node.nodeSize : state.doc.content.size;
      tr.insert(insertAt, nodes);
    }
    const first = tr.doc.nodeAt(insertAt);
    if (first) {
      const inner =
        first.type.name === 'columns' || first.type.name === 'table'
          ? Selection.near(tr.doc.resolve(insertAt + 1))
          : null;
      tr.setSelection(
        inner ??
          (hasTextPart(first)
            ? TextSelection.create(tr.doc, insertAt + 2)
            : NodeSelection.create(tr.doc, insertAt)),
      );
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Enter in the page title: moves the cursor to the start of the content. A blank page
 * (no block, or a single empty paragraph) gets the cursor in that first paragraph;
 * otherwise a new empty paragraph is inserted above every block, which all shift down.
 */
export const enterFromTitle: Command = (state, dispatch) => {
  if (!dispatch) return true;
  const { doc } = state;
  const first = doc.firstChild;
  const blank =
    doc.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 2;
  const tr = state.tr;
  if (!blank) tr.insert(0, createTextBlock(state.schema, 'paragraph'));
  tr.setSelection(TextSelection.create(tr.doc, 2));
  dispatch(tr.scrollIntoView());
  return true;
};
