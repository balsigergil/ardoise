// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure tree logic for the sidebar: flattening the visible part of lazily loaded trees
 * into rows (for virtualization) and computing drop targets for drag and drop.
 */
import { parentKey, positionAt, type PageDto, type PageParent } from '@ardoise/shared';

export interface TreeSource {
  children(parent: PageParent): PageDto[];
  hasChildren(page: PageDto): boolean;
  get(type: 'page', id: string): PageDto | undefined;
}

export interface LoadState {
  status: 'loading' | 'done' | 'error';
  next: string | null;
}

export type TreeRow =
  | {
      kind: 'page';
      key: string;
      page: PageDto;
      depth: number;
      parent: PageParent;
      expanded: boolean;
      expandable: boolean;
      /** Expansion namespace, so a page can be expanded in Favorites and not in its tree. */
      scope: string;
    }
  | {
      kind: 'loading' | 'empty' | 'more' | 'error';
      key: string;
      depth: number;
      parent: PageParent;
      scope: string;
    };

/** Left padding (px) of a sidebar row at `depth`: each level shifts by a small step. */
export const INDENT_STEP = 10;
export function rowIndent(depth: number): number {
  return 4 + depth * INDENT_STEP;
}

export const expansionKey = (scope: string, pageId: string) => `${scope}:${pageId}`;

/** Rows for one parent's subtree, depth-first, following `expanded`. */
export function flattenChildren(
  source: TreeSource,
  parent: PageParent,
  depth: number,
  scope: string,
  expanded: ReadonlySet<string>,
  loads: ReadonlyMap<string, LoadState>,
  out: TreeRow[] = [],
  /** Guards against cycles in a stale cache. */
  seen: Set<string> = new Set(),
): TreeRow[] {
  const pk = parentKey(parent);
  const load = loads.get(pk);
  const children = source.children(parent);
  if (children.length === 0) {
    if (!load || load.status === 'loading')
      out.push({ kind: 'loading', key: `${scope}:${pk}:loading`, depth, parent, scope });
    else if (load.status === 'error')
      out.push({ kind: 'error', key: `${scope}:${pk}:error`, depth, parent, scope });
    else out.push({ kind: 'empty', key: `${scope}:${pk}:empty`, depth, parent, scope });
    return out;
  }
  for (const page of children) {
    if (seen.has(page.id)) continue;
    const isExpanded = expanded.has(expansionKey(scope, page.id));
    const expandable = source.hasChildren(page);
    out.push({
      kind: 'page',
      key: `${scope}:${page.id}`,
      page,
      depth,
      parent,
      expanded: isExpanded,
      expandable,
      scope,
    });
    if (isExpanded) {
      seen.add(page.id);
      flattenChildren(
        source,
        { kind: 'page', id: page.id },
        depth + 1,
        scope,
        expanded,
        loads,
        out,
        seen,
      );
      seen.delete(page.id);
    }
  }
  if (load?.next) out.push({ kind: 'more', key: `${scope}:${pk}:more`, depth, parent, scope });
  return out;
}

/** Rows for a list of standalone pages (favorites, shared), each expandable. */
export function flattenPages(
  source: TreeSource,
  pages: readonly PageDto[],
  scope: string,
  expanded: ReadonlySet<string>,
  loads: ReadonlyMap<string, LoadState>,
): TreeRow[] {
  const out: TreeRow[] = [];
  for (const page of pages) {
    const isExpanded = expanded.has(expansionKey(scope, page.id));
    out.push({
      kind: 'page',
      key: `${scope}:${page.id}`,
      page,
      depth: 0,
      parent: { kind: page.parentKind, id: page.parentId },
      expanded: isExpanded,
      expandable: source.hasChildren(page),
      scope,
    });
    if (isExpanded)
      flattenChildren(
        source,
        { kind: 'page', id: page.id },
        1,
        scope,
        expanded,
        loads,
        out,
        new Set([page.id]),
      );
  }
  return out;
}

/** Parents whose children must be loaded for the rows to be complete. */
export function parentsToLoad(rows: readonly TreeRow[]): PageParent[] {
  return rows.filter((r) => r.kind === 'loading').map((r) => r.parent);
}

export type DropZone = 'before' | 'after' | 'inside';

/** Zone of a pointer at `offsetY` within a row of `height`: edges reorder, middle nests. */
export function dropZone(offsetY: number, height: number): DropZone {
  if (offsetY < height * 0.25) return 'before';
  if (offsetY > height * 0.75) return 'after';
  return 'inside';
}

export interface DropTarget {
  parent: PageParent;
  position: string;
}

/** True when `pageId` is `candidateId` or one of its known ancestors. */
export function isSelfOrAncestor(source: TreeSource, pageId: string, candidateId: string): boolean {
  let current: PageDto | undefined = source.get('page', candidateId);
  let guard = 0;
  while (current && guard++ < 1000) {
    if (current.id === pageId) return true;
    if (current.parentKind !== 'page') return false;
    current = source.get('page', current.parentId);
  }
  return false;
}

/**
 * Where a page dropped relative to `target` lands. Returns undefined for invalid drops
 * (onto itself or into its own subtree).
 */
export function computeDrop(
  source: TreeSource,
  draggedId: string,
  target: PageDto,
  zone: DropZone,
): DropTarget | undefined {
  if (isSelfOrAncestor(source, draggedId, target.id)) return undefined;
  if (zone === 'inside') {
    const parent: PageParent = { kind: 'page', id: target.id };
    const siblings = source.children(parent).filter((p) => p.id !== draggedId);
    return { parent, position: positionAt(siblings, siblings.length) };
  }
  const parent: PageParent = { kind: target.parentKind, id: target.parentId };
  const siblings = source.children(parent).filter((p) => p.id !== draggedId);
  const index = siblings.findIndex((p) => p.id === target.id);
  if (index < 0) return undefined;
  return { parent, position: positionAt(siblings, zone === 'before' ? index : index + 1) };
}

/** Appending at the end of a section root (teamspace or private). */
export function computeRootDrop(
  source: TreeSource,
  draggedId: string,
  parent: PageParent,
): DropTarget {
  const siblings = source.children(parent).filter((p) => p.id !== draggedId);
  return { parent, position: positionAt(siblings, siblings.length) };
}
