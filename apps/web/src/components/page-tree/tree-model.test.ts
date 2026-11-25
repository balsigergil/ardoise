// SPDX-License-Identifier: AGPL-3.0-only
import {
  compareSiblings,
  newId,
  parentKey,
  positionsBetween,
  type PageDto,
  type PageParent,
} from '@ardoise/shared';
import { describe, expect, it } from 'vitest';
import {
  computeDrop,
  computeRootDrop,
  dropZone,
  expansionKey,
  flattenChildren,
  flattenPages,
  isSelfOrAncestor,
  parentsToLoad,
  rowIndent,
  type LoadState,
  type TreeSource,
} from './tree-model';

const TS = newId();
const root: PageParent = { kind: 'teamspace', id: TS };

function page(parent: PageParent, position: string, overrides: Partial<PageDto> = {}): PageDto {
  return {
    id: newId(),
    kind: 'page',
    parentKind: parent.kind,
    parentId: parent.id,
    position,
    title: 'p',
    icon: null,
    cover: null,
    width: 'normal',
    font: 'default',
    isLocked: false,
    restrictInheritance: false,
    isInline: false,
    isTemplate: false,
    moveState: null,
    createdBy: null,
    createdAt: '',
    updatedBy: null,
    updatedAt: '',
    deletedAt: null,
    deletedRootId: null,
    hasChildren: false,
    ...overrides,
  };
}

class Source implements TreeSource {
  pages = new Map<string, PageDto>();
  add(p: PageDto) {
    this.pages.set(p.id, p);
    return p;
  }
  children(parent: PageParent) {
    return [...this.pages.values()]
      .filter((p) => parentKey({ kind: p.parentKind, id: p.parentId }) === parentKey(parent))
      .sort(compareSiblings);
  }
  hasChildren(p: PageDto) {
    return p.hasChildren || this.children({ kind: 'page', id: p.id }).length > 0;
  }
  get(_type: 'page', id: string) {
    return this.pages.get(id);
  }
}

function fixture() {
  const s = new Source();
  const [k1, k2, k3] = positionsBetween(null, null, 3);
  const a = s.add(page(root, k1!, { title: 'A' }));
  const b = s.add(page(root, k2!, { title: 'B', hasChildren: true }));
  const c = s.add(page(root, k3!, { title: 'C' }));
  const [c1, c2] = positionsBetween(null, null, 2);
  const a1 = s.add(page({ kind: 'page', id: a.id }, c1!, { title: 'A1' }));
  const a2 = s.add(page({ kind: 'page', id: a.id }, c2!, { title: 'A2' }));
  return { s, a, b, c, a1, a2 };
}

const done = (parent: PageParent, next: string | null = null): [string, LoadState] => [
  parentKey(parent),
  { status: 'done', next },
];

describe('flattenChildren', () => {
  it('lists siblings in order and descends into expanded nodes', () => {
    const { s, a, b, c, a1, a2 } = fixture();
    const rows = flattenChildren(
      s,
      root,
      0,
      'ts',
      new Set([expansionKey('ts', a.id)]),
      new Map([done(root), done({ kind: 'page', id: a.id })]),
    );
    expect(
      rows.map((r) => (r.kind === 'page' ? [r.page.title, r.depth] : [r.kind, r.depth])),
    ).toEqual([
      ['A', 0],
      ['A1', 1],
      ['A2', 1],
      ['B', 0],
      ['C', 0],
    ]);
    expect(rows.find((r) => r.kind === 'page' && r.page.id === b.id)).toMatchObject({
      expandable: true,
      expanded: false,
    });
    expect(rows.find((r) => r.kind === 'page' && r.page.id === c.id)).toMatchObject({
      expandable: false,
    });
    expect([a1, a2]).toHaveLength(2);
  });

  it('shows loading, empty, error and more rows', () => {
    const { s, b, c } = fixture();
    const expanded = new Set([expansionKey('ts', b.id), expansionKey('ts', c.id)]);
    const loading = flattenChildren(s, root, 0, 'ts', expanded, new Map([done(root, 'cursor')]));
    expect(loading.filter((r) => r.kind !== 'page').map((r) => r.kind)).toEqual([
      'loading',
      'loading',
      'more',
    ]);
    expect(parentsToLoad(loading)).toEqual([
      { kind: 'page', id: b.id },
      { kind: 'page', id: c.id },
    ]);
    const settled = flattenChildren(
      s,
      root,
      0,
      'ts',
      expanded,
      new Map([
        done(root),
        done({ kind: 'page', id: b.id }),
        [parentKey({ kind: 'page', id: c.id }), { status: 'error', next: null }],
      ]),
    );
    expect(settled.filter((r) => r.kind !== 'page').map((r) => r.kind)).toEqual(['empty', 'error']);
  });

  it('keeps expansion scoped (favorites vs tree)', () => {
    const { s, a } = fixture();
    const rows = flattenPages(s, [a], 'fav', new Set([expansionKey('ts', a.id)]), new Map());
    expect(rows).toHaveLength(1);
    expect(
      flattenPages(
        s,
        [a],
        'fav',
        new Set([expansionKey('fav', a.id)]),
        new Map([done({ kind: 'page', id: a.id })]),
      ),
    ).toHaveLength(3);
  });

  it('survives cycles in a stale cache', () => {
    const s = new Source();
    const x = s.add(page({ kind: 'page', id: 'y' }, 'a0'));
    const y = s.add({ ...page({ kind: 'page', id: x.id }, 'a0'), id: 'y' });
    const rows = flattenChildren(
      s,
      { kind: 'page', id: x.id },
      0,
      'ts',
      new Set([expansionKey('ts', y.id), expansionKey('ts', x.id)]),
      new Map(),
    );
    expect(rows.length).toBeLessThan(10);
  });
});

describe('drops', () => {
  it('maps pointer offsets to zones', () => {
    expect(dropZone(2, 30)).toBe('before');
    expect(dropZone(15, 30)).toBe('inside');
    expect(dropZone(28, 30)).toBe('after');
  });

  it('computes positions before, after and inside a target', () => {
    const { s, a, b, c, a2 } = fixture();
    const before = computeDrop(s, c.id, b, 'before')!;
    expect(before.parent).toEqual(root);
    expect(before.position > a.position && before.position < b.position).toBe(true);
    const after = computeDrop(s, a.id, b, 'after')!;
    expect(after.position > b.position && after.position < c.position).toBe(true);
    const inside = computeDrop(s, c.id, a, 'inside')!;
    expect(inside.parent).toEqual({ kind: 'page', id: a.id });
    expect(inside.position > a2.position).toBe(true);
  });

  it('refuses drops onto itself or its own subtree', () => {
    const { s, a, a1 } = fixture();
    expect(computeDrop(s, a.id, a, 'inside')).toBeUndefined();
    expect(computeDrop(s, a.id, a1, 'before')).toBeUndefined();
    expect(isSelfOrAncestor(s, a.id, a1.id)).toBe(true);
    expect(isSelfOrAncestor(s, a1.id, a.id)).toBe(false);
  });

  it('appends at the end of a section root', () => {
    const { s, a, c } = fixture();
    const drop = computeRootDrop(s, a.id, root);
    expect(drop.position > c.position).toBe(true);
  });
});

describe('rowIndent', () => {
  it('indents each level by a small, constant step', () => {
    expect(rowIndent(0)).toBe(4);
    expect(rowIndent(1) - rowIndent(0)).toBe(10);
    expect(rowIndent(3) - rowIndent(2)).toBe(10);
  });
});
