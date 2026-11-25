// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Child page blocks written by the server (M3 follow-up, ADR 0011): a page created from
 * the sidebar, moved or restored under a page gets a `childPage` block in that page's
 * content, and a page moved away loses the block in its old parent. These helpers edit
 * the Yjs tree directly, like duplication, so unknown node types are left untouched.
 */
import { CONTENT_FRAGMENT } from '@ardoise/editor';
import { newId } from '@ardoise/shared';
import * as Y from 'yjs';
import type { JobPayloads } from '../jobs/jobs.js';
import type { Store } from '../store/store.js';

type Container = Y.XmlFragment | Y.XmlElement;

const CHILD_PAGE = 'childPage';

/** Every `childPage` element pointing to `pageId`, at any depth, with its container. */
function findChildPageBlocks(
  container: Container,
  pageId: string,
  found: { parent: Container; element: Y.XmlElement }[] = [],
): { parent: Container; element: Y.XmlElement }[] {
  for (const child of container.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === CHILD_PAGE && child.getAttribute('pageId') === pageId)
      found.push({ parent: container, element: child });
    findChildPageBlocks(child, pageId, found);
  }
  return found;
}

function indexIn(parent: Container, element: Y.XmlElement): number {
  return parent.toArray().indexOf(element);
}

/** True when the content has a child page block for `pageId`. */
export function hasChildPageBlock(doc: Y.Doc, pageId: string): boolean {
  return findChildPageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT), pageId).length > 0;
}

/**
 * Adds a child page block for `pageId` unless the content already has one: right after
 * the block of `afterPageId` when there is one (a duplicate next to its source),
 * otherwise at the end. Returns whether a block was added.
 */
export function ensureChildPageBlock(
  doc: Y.Doc,
  pageId: string,
  options: { afterPageId?: string; blockId?: string } = {},
): boolean {
  const content = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (findChildPageBlocks(content, pageId).length > 0) return false;
  const block = new Y.XmlElement(CHILD_PAGE);
  block.setAttribute('blockId', options.blockId ?? newId());
  block.setAttribute('pageId', pageId);
  const anchor = options.afterPageId
    ? findChildPageBlocks(content, options.afterPageId)[0]
    : undefined;
  doc.transact(() => {
    if (anchor) anchor.parent.insert(indexIn(anchor.parent, anchor.element) + 1, [block]);
    else content.push([block]);
  });
  return true;
}

/** Removes every child page block for `pageId`; returns how many were removed. */
export function removeChildPageBlocks(doc: Y.Doc, pageId: string): number {
  const found = findChildPageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT), pageId);
  doc.transact(() => {
    // Last first, so indexes in a shared container stay valid.
    for (const { parent, element } of found.reverse()) {
      parent.delete(indexIn(parent, element), 1);
    }
  });
  return found.length;
}

/** Edits the live content of a page (a direct Hocuspocus connection in production). */
export interface ContentEditor {
  /** Applies `edit` to the page's document, then stores it; open editors see it at once. */
  edit(workspaceId: string, pageId: string, edit: (doc: Y.Doc) => void): Promise<void>;
}

/**
 * Reconciles child page blocks with the tree, from the page's current state rather than
 * the job's, so jobs that run late or out of order (a create quickly followed by a move)
 * leave the right blocks: the block is removed only if the page is no longer under
 * `from`, and added only if it is still under `to` and neither page is in the trash.
 */
export class ChildBlockService {
  constructor(
    private readonly store: Store,
    private readonly content: ContentEditor,
  ) {}

  async sync({
    workspaceId,
    pageId,
    from,
    to,
    afterPageId,
  }: JobPayloads['page.childBlock']): Promise<void> {
    const page = await this.store.pages.findById(workspaceId, pageId);
    const parentId = page?.parentKind === 'page' ? page.parentId : undefined;
    if (from && from !== parentId && (await this.store.pages.findById(workspaceId, from))) {
      await this.content.edit(workspaceId, from, (doc) => void removeChildPageBlocks(doc, pageId));
    }
    if (!to || !page || page.deletedAt || to !== parentId) return;
    const parent = await this.store.pages.findById(workspaceId, to);
    if (!parent || parent.deletedAt) return;
    await this.content.edit(
      workspaceId,
      to,
      (doc) => void ensureChildPageBlock(doc, pageId, afterPageId ? { afterPageId } : {}),
    );
  }
}
