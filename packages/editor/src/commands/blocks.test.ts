// SPDX-License-Identifier: AGPL-3.0-only
import { EditorState, type Command } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { lines, sketch, stateOf } from '../__fixtures__/sketch.js';
import {
  deleteBlocks,
  duplicateBlocks,
  enterFromTitle,
  indentBlocks,
  joinBackward,
  joinForward,
  joinIntoTitle,
  moveBlocks,
  moveBlocksTo,
  outdentBlocks,
  selectedBlocks,
  setBlockColor,
  splitBlock,
  toggleTodo,
  turnInto,
} from './blocks.js';

function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  expect(handled).toBe(true);
  next.doc.check();
  return next;
}

const run = (source: string, command: Command, opts?: Parameters<typeof sketch>[1]) =>
  sketch(apply(stateOf(source), command), opts);

function posOf(state: EditorState, id: string): number {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.attrs['blockId'] === id) found = pos;
  });
  return found;
}

describe('selectedBlocks', () => {
  it('returns the block holding the cursor, or the siblings a selection spans', () => {
    const state = stateOf(`
      paragraph a|a
      paragraph bb
      paragraph c|c
    `);
    expect(selectedBlocks(state).map((b) => b.node.textContent)).toEqual(['aa', 'bb', 'cc']);
    expect(selectedBlocks(stateOf('paragraph a|b')).map((b) => b.node.textContent)).toEqual(['ab']);
  });

  it('returns the top-most blocks when the selection goes into children', () => {
    const state = stateOf(`
      paragraph a|a
        paragraph child
      paragraph b|b
    `);
    expect(selectedBlocks(state).map((b) => b.node.firstChild!.textContent)).toEqual(['aa', 'bb']);
  });
});

describe('indent and outdent', () => {
  it('Tab moves a block into the previous sibling, appending to its children', () => {
    expect(
      run(
        `
        paragraph a
          paragraph x
        paragraph b|
      `,
        indentBlocks,
      ),
    ).toBe(
      lines(`
      paragraph a
        paragraph x
        paragraph b|
    `),
    );
  });

  it('Tab on the first block, or under a block without children, does nothing', () => {
    expect(indentBlocks(stateOf('paragraph a|'), () => {})).toBe(false);
    expect(indentBlocks(stateOf('table\nparagraph a|'), () => {})).toBe(false);
  });

  it('Tab indents several selected blocks at once', () => {
    expect(
      run(
        `
        paragraph a
        paragraph b|
        paragraph c|
      `,
        indentBlocks,
      ),
    ).toBe(
      lines(`
      paragraph a
        paragraph b
        paragraph c
    `),
    );
  });

  it('Shift+Tab moves a block after its parent; following siblings become its children', () => {
    expect(
      run(
        `
        bulletedItem a
          bulletedItem b
          bulletedItem c|
          bulletedItem d
        paragraph e
      `,
        outdentBlocks,
      ),
    ).toBe(
      lines(`
      bulletedItem a
        bulletedItem b
      bulletedItem c|
        bulletedItem d
      paragraph e
    `),
    );
  });

  it('Shift+Tab on an only child removes the empty children group', () => {
    expect(run('paragraph a\n  paragraph |b', outdentBlocks)).toBe('paragraph a\nparagraph |b');
  });

  it('Shift+Tab at the top level or inside a column does nothing', () => {
    expect(outdentBlocks(stateOf('paragraph a|'), () => {})).toBe(false);
  });
});

describe('splitBlock (Enter)', () => {
  it('moves the text after the cursor to a new paragraph after a heading', () => {
    expect(run('heading:level=1 Hel|lo', splitBlock)).toBe('heading Hel\nparagraph |lo');
  });

  it('continues list items and to-dos (unchecked)', () => {
    expect(run('bulletedItem one|', splitBlock)).toBe('bulletedItem one\nbulletedItem |');
    expect(run('todo:checked=true done|', splitBlock, { attrs: ['checked'] })).toBe(
      'todo:checked=true done\ntodo:checked=false |',
    );
  });

  it('places the new block as the first child when the block has children', () => {
    expect(run('toggle title|\n  paragraph inside', splitBlock)).toBe(
      lines(`
      toggle title
        toggle |
        paragraph inside
    `),
    );
  });

  it('at the start of a block, inserts an empty block above and keeps the id', () => {
    const state = apply(stateOf('paragraph:id=keep |text'), splitBlock);
    expect(sketch(state, { ids: true })).toMatch(/^paragraph:id=\S+\nparagraph:id=keep \|text$/);
    expect(sketch(state, { ids: true }).startsWith('paragraph:id=keep')).toBe(false);
  });

  it('on an empty list item: turns it into a paragraph, or outdents it when nested', () => {
    expect(run('bulletedItem a\nbulletedItem |', splitBlock)).toBe('bulletedItem a\nparagraph |');
    expect(run('bulletedItem a\n  bulletedItem |', splitBlock)).toBe(
      'bulletedItem a\nbulletedItem |',
    );
  });

  it('replaces a selection before splitting', () => {
    expect(run('paragraph a|bc|d', splitBlock)).toBe('paragraph a\nparagraph |d');
  });

  it('gives new blocks a fresh id', () => {
    const state = apply(stateOf('paragraph:id=x ab|cd'), splitBlock);
    const ids: unknown[] = [];
    state.doc.forEach((n) => ids.push(n.attrs['blockId']));
    expect(new Set(ids).size).toBe(2);
  });
});

describe('joinBackward (Backspace at the start)', () => {
  it('turns a non-paragraph into a paragraph first', () => {
    expect(run('heading:level=2 |Title', joinBackward)).toBe('paragraph |Title');
  });

  it('outdents a nested paragraph', () => {
    expect(run('paragraph a\n  paragraph |b', joinBackward)).toBe('paragraph a\nparagraph |b');
  });

  it('merges into the visually previous text block; children take its place', () => {
    expect(
      run(
        `
        paragraph a
          paragraph deep
        paragraph |b
          paragraph kid
      `,
        joinBackward,
      ),
    ).toBe(
      lines(`
      paragraph a
        paragraph deep|b
      paragraph kid
    `),
    );
  });

  it('selects a previous block without text instead of merging', () => {
    const state = apply(stateOf('divider\nparagraph |b'), joinBackward);
    expect(state.selection.constructor.name).toBe('NodeSelection');
    expect(sketch(state)).toBe('divider\nparagraph b');
  });

  it('deletes an empty paragraph after a divider and selects the divider', () => {
    expect(run('divider\nparagraph |', joinBackward)).toBe('divider');
  });

  it('turns an empty code block into a paragraph', () => {
    expect(run('codeBlock |', joinBackward)).toBe('paragraph |');
  });
});

describe('joinForward (Delete at the end)', () => {
  it('merges the next block in document order, including a first child', () => {
    expect(run('paragraph a|\n  paragraph b\nparagraph c', joinForward)).toBe(
      'paragraph a|b\nparagraph c',
    );
    expect(run('paragraph a|\nheading b', joinForward)).toBe('paragraph a|b');
  });

  it('merges the next block after the end of a children group', () => {
    expect(run('paragraph a\n  paragraph b|\nparagraph c', joinForward)).toBe(
      'paragraph a\n  paragraph b|c',
    );
  });
});

describe('delete, duplicate, move, turn into, color', () => {
  it('deletes a block and drops an emptied children group', () => {
    const state = stateOf('paragraph a\n  paragraph:id=k b', { node: 'k' });
    expect(sketch(apply(state, deleteBlocks()))).toBe('paragraph a|');
  });

  it('deletes the last block of a column and unwraps two-column layouts', () => {
    const state = stateOf(
      `
      columns
        column
          paragraph:id=l left
        column
          paragraph right
    `,
      { node: 'l' },
    );
    expect(sketch(apply(state, deleteBlocks()))).toBe('paragraph right|');
  });

  it('duplicates with fresh ids, including descendants, and keeps ext', () => {
    const base = stateOf('paragraph:id=a a|\n  paragraph:id=b b');
    const withExt = base.apply(base.tr.setNodeAttribute(0, 'ext', { acme: { x: 1 } }));
    const state = apply(withExt, duplicateBlocks());
    const ids: string[] = [];
    state.doc.descendants((node) => {
      if (node.type.isInGroup('block')) ids.push(node.attrs['blockId'] as string);
    });
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(state.doc.child(1).attrs['ext']).toEqual({ acme: { x: 1 } });
    expect(sketch(state)).toBe('paragraph a\n  paragraph b\nparagraph a|\n  paragraph b');
  });

  it('duplicates a child page as a link to the same page', () => {
    const state = stateOf('childPage:id=c:pageId=p1', { node: 'c' });
    expect(sketch(apply(state, duplicateBlocks()), { attrs: ['pageId'] })).toBe(
      'childPage:pageId=p1\npageLink:pageId=p1',
    );
  });

  it('moves blocks up and down among siblings', () => {
    expect(run('paragraph a\nparagraph b|', moveBlocks(-1))).toBe('paragraph b|\nparagraph a');
    expect(run('paragraph a|\nparagraph b', moveBlocks(1))).toBe('paragraph b\nparagraph a|');
    expect(moveBlocks(-1)(stateOf('paragraph a|'), () => {})).toBe(false);
  });

  it('turns text blocks into one another, keeping id, ext, color and children', () => {
    const state = apply(stateOf('paragraph:id=x:color=red a|\n  paragraph b'), turnInto('todo'));
    expect(sketch(state, { ids: true, attrs: ['color'] })).toBe(
      'todo:color=red:id=x a|\n  paragraph:id=b2 b'.replace(
        ':id=b2',
        `:id=${String(state.doc.firstChild!.lastChild!.firstChild!.attrs['blockId'])}`,
      ),
    );
  });

  it('turns text into code and back, rebuilding the text part', () => {
    const code = apply(stateOf('paragraph line|'), turnInto('codeBlock'));
    expect(sketch(code)).toBe('codeBlock line|');
    expect(sketch(apply(code, turnInto('quote')))).toBe('quote line|');
  });

  it('does not turn atoms into text blocks', () => {
    expect(turnInto('paragraph')(stateOf('divider:id=d', { node: 'd' }), () => {})).toBe(false);
  });

  it('sets and clears block colors', () => {
    const state = apply(stateOf('paragraph a|'), setBlockColor('blue_background'));
    expect(sketch(state, { attrs: ['color'] })).toBe('paragraph:color=blue_background a|');
    expect(sketch(apply(state, setBlockColor(null)), { attrs: ['color'] })).toBe('paragraph a|');
  });

  it('toggles a to-do', () => {
    expect(run('todo x', toggleTodo(0), { attrs: ['checked'] })).toBe('todo:checked=true |x');
  });
});

describe('moveBlocksTo (drag and drop)', () => {
  const source = `
    paragraph:id=a a
    paragraph:id=b b
    paragraph:id=c c
  `;
  function drop(
    src: string,
    moved: string,
    target: string,
    placement: Parameters<typeof moveBlocksTo>[3],
  ) {
    const state = stateOf(src);
    const from = posOf(state, moved);
    const node = state.doc.nodeAt(from)!;
    return sketch(
      apply(state, moveBlocksTo(from, from + node.nodeSize, posOf(state, target), placement)),
    );
  }

  it('moves before, after and into children', () => {
    expect(drop(source, 'c', 'a', 'before')).toBe('paragraph |c\nparagraph a\nparagraph b');
    expect(drop(source, 'a', 'c', 'after')).toBe('paragraph b\nparagraph c\nparagraph |a');
    expect(drop(source, 'c', 'a', 'child')).toBe('paragraph a\n  paragraph |c\nparagraph b');
  });

  it('creates columns when dropped beside a block', () => {
    expect(drop(source, 'c', 'a', 'right')).toBe(
      lines(`
      columns
        column
          paragraph a
        column
          paragraph |c
      paragraph b
    `),
    );
  });

  it('adds a column to existing columns, and unwraps the source layout when emptied', () => {
    const src = `
      columns
        column
          paragraph:id=a a
        column
          paragraph:id=b b
      paragraph:id=c c
    `;
    expect(drop(src, 'c', 'b', 'left')).toBe(
      lines(`
      columns
        column
          paragraph a
        column
          paragraph |c
        column
          paragraph b
    `),
    );
    expect(drop(src, 'a', 'c', 'after')).toBe('paragraph b\nparagraph c\nparagraph |a');
  });

  it('refuses to drop a block onto or into itself', () => {
    const state = stateOf('paragraph:id=a a\n  paragraph:id=k k');
    const node = state.doc.firstChild!;
    expect(moveBlocksTo(0, node.nodeSize, posOf(state, 'k'), 'after')(state, () => {})).toBe(false);
    expect(moveBlocksTo(0, node.nodeSize, 0, 'after')(state, () => {})).toBe(false);
  });
});

describe('enterFromTitle', () => {
  it('puts the cursor in the first paragraph of a blank page', () => {
    expect(run('paragraph ', enterFromTitle)).toBe('paragraph |');
  });

  it('creates the first paragraph of a page without blocks', () => {
    const empty = EditorState.create({ schema: stateOf('paragraph a').schema });
    expect(sketch(apply(empty, enterFromTitle))).toBe('paragraph |');
  });

  it('shifts every block down and focuses a new first paragraph', () => {
    const state = stateOf('heading:level=1 Intro\nparagraph bo|dy');
    const next = apply(state, enterFromTitle);
    expect(sketch(next)).toBe('paragraph |\nheading Intro\nparagraph body');
    expect(next.doc.firstChild!.attrs['blockId']).toBeTruthy();
  });

  it('shifts the blocks when the first paragraph is empty but others follow', () => {
    expect(run('paragraph \nparagraph b', enterFromTitle)).toBe(
      'paragraph |\nparagraph\nparagraph b',
    );
  });
});

describe('joinIntoTitle', () => {
  function leave(source: string) {
    const left: string[] = [];
    const state = stateOf(source);
    let next = state;
    const handled = joinIntoTitle((text) => left.push(text))(
      state,
      (tr) => (next = state.apply(tr)),
    );
    next.doc.check();
    return { handled, left, doc: sketch(next) };
  }

  it('moves the first paragraph text to the title and removes the block', () => {
    expect(leave('paragraph |hello\nparagraph world')).toEqual({
      handled: true,
      left: ['hello'],
      doc: 'paragraph |world',
    });
  });

  it('removes an empty first paragraph', () => {
    expect(leave('paragraph |\nheading:level=1 Intro')).toMatchObject({
      left: [''],
      doc: 'heading |Intro',
    });
  });

  it('removes an empty first block of any type', () => {
    expect(leave('heading:level=1 |\nparagraph body')).toMatchObject({
      handled: true,
      left: [''],
      doc: 'paragraph |body',
    });
    expect(leave('todo |\nparagraph body')).toMatchObject({ doc: 'paragraph |body' });
    expect(leave('bulletedItem |')).toMatchObject({ left: [''], doc: 'paragraph |' });
  });

  it('keeps the single paragraph of a page, emptied', () => {
    expect(leave('paragraph |only')).toMatchObject({ left: ['only'], doc: 'paragraph |' });
    expect(leave('paragraph |')).toMatchObject({ left: [''], doc: 'paragraph |' });
  });

  it('lets the children take the place of the paragraph', () => {
    expect(leave('paragraph |parent\n  paragraph child')).toMatchObject({
      left: ['parent'],
      doc: 'paragraph |child',
    });
  });

  it('only applies at the very start of the first paragraph', () => {
    expect(leave('paragraph he|llo').handled).toBe(false);
    expect(leave('paragraph a\nparagraph |b').handled).toBe(false);
    expect(leave('heading:level=1 |Intro').handled).toBe(false);
    expect(leave('todo |\n  paragraph child').handled).toBe(false);
    expect(leave('paragraph |he|llo').handled).toBe(false);
    expect(leave('paragraph a\n  paragraph |child').handled).toBe(false);
  });
});
