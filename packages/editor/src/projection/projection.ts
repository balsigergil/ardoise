// SPDX-License-Identifier: AGPL-3.0-only
import { isUuidV7 } from '@ardoise/shared';
import { stateToJSON, type DocJSON } from '../yjs.js';

/**
 * Projection of a document (ARCHITECTURE §11): plain text for search, outline, links to
 * pages, page and user mentions, and referenced files. It works on editor JSON, so it
 * runs on the server without a DOM or the editor schema, and it never assumes that every
 * node type is a core one: unknown nodes use the generic fallback.
 */

/** A node of editor JSON. */
export interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type LinkKind = 'link' | 'mention' | 'synced_ref';

export interface Projection {
  /** Text of every block, one line per text part, capped at `MAX_PLAIN_TEXT`. */
  plainText: string;
  /** Headings in document order (table of contents, search snippets). */
  outline: { blockId: string | null; level: number; text: string }[];
  /** Pages this document points to, deduplicated per (page, kind). */
  links: { pageId: string; kind: LinkKind }[];
  /** Users mentioned, with the block holding each mention (for notifications). */
  userMentions: { userId: string; blockId: string | null }[];
  /** Files embedded (images and file blocks). */
  fileIds: string[];
}

/** Postgres caps a tsvector at 1 MB; keep the indexed text well under it. */
export const MAX_PLAIN_TEXT = 200_000;

/** What an extractor can record while walking the document. */
export interface ProjectionContext {
  /** Appends text to the current line. */
  text(value: string): void;
  /** Ends the current line (block boundary). */
  line(): void;
  link(pageId: unknown, kind?: LinkKind): void;
  mentionUser(userId: unknown): void;
  file(fileId: unknown): void;
  heading(level: number, text: string): void;
  /** The id of the innermost block being walked. */
  readonly blockId: string | null;
  /** Walks the node's content with the registered extractors. */
  walkContent(node: JSONNode): void;
}

/** Extracts what a node type contributes. Return `false` to skip its content. */
export type ProjectionExtractor = (node: JSONNode, ctx: ProjectionContext) => void | false;

const INTERNAL_PAGE_LINK = /^\/w\/[0-9a-f-]{36}\/p\/([0-9a-f-]{36})(?:[/?#]|$)/;

/** The page id of an in-app link (`/w/<workspace>/p/<page>`), or null. */
export function pageIdFromHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  let path = href;
  try {
    if (/^https?:/.test(href)) path = new URL(href).pathname;
  } catch {
    return null;
  }
  const id = INTERNAL_PAGE_LINK.exec(path)?.[1];
  return id && isUuidV7(id) ? id : null;
}

export class ProjectionRegistry {
  private readonly extractors = new Map<string, ProjectionExtractor>();

  register(type: string, extractor: ProjectionExtractor): this {
    if (this.extractors.has(type)) throw new Error(`extractor already registered: ${type}`);
    this.extractors.set(type, extractor);
    return this;
  }

  get(type: string): ProjectionExtractor | undefined {
    return this.extractors.get(type);
  }

  /** Projects editor JSON. */
  project(doc: DocJSON | JSONNode): Projection {
    const lines: string[] = [];
    let current = '';
    let size = 0;
    const outline: Projection['outline'] = [];
    const links = new Map<string, Projection['links'][number]>();
    const users = new Map<string, Projection['userMentions'][number]>();
    const files = new Set<string>();
    const blockIds: (string | null)[] = [null];

    const ctx: ProjectionContext = {
      text(value) {
        if (size >= MAX_PLAIN_TEXT || !value) return;
        const room = MAX_PLAIN_TEXT - size;
        const piece = value.length > room ? value.slice(0, room) : value;
        current += piece;
        size += piece.length;
      },
      line() {
        if (current.trim()) lines.push(current.trim());
        if (current) size += 1;
        current = '';
      },
      link(pageId, kind = 'link') {
        if (isUuidV7(pageId)) links.set(`${pageId}:${kind}`, { pageId, kind });
      },
      mentionUser(userId) {
        if (!isUuidV7(userId)) return;
        const blockId = blockIds.at(-1) ?? null;
        users.set(`${userId}:${blockId}`, { userId, blockId });
      },
      file(fileId) {
        if (isUuidV7(fileId)) files.add(fileId);
      },
      heading(level, text) {
        outline.push({ blockId: blockIds.at(-1) ?? null, level, text });
      },
      get blockId() {
        return blockIds.at(-1) ?? null;
      },
      walkContent: (node) => {
        for (const child of node.content ?? []) walk(child);
      },
    };

    const walk = (node: JSONNode) => {
      if (!node || typeof node.type !== 'string') return;
      const blockId =
        typeof node.attrs?.['blockId'] === 'string' ? node.attrs['blockId'] : undefined;
      if (blockId !== undefined) blockIds.push(blockId);
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link') ctx.link(pageIdFromHref(mark.attrs?.['href']), 'link');
      }
      const extractor = this.extractors.get(node.type) ?? genericExtractor;
      if (extractor(node, ctx) !== false) ctx.walkContent(node);
      if (blockId !== undefined) blockIds.pop();
    };
    walk(doc as JSONNode);
    ctx.line();
    return {
      plainText: lines.join('\n'),
      outline,
      links: [...links.values()],
      userMentions: [...users.values()],
      fileIds: [...files],
    };
  }
}

/**
 * Fallback for node types without an extractor (plugin nodes whose plugin is not loaded
 * on the server, future types): their `text` attribute, then their content.
 */
export const genericExtractor: ProjectionExtractor = (node, ctx) => {
  const text = node.attrs?.['text'];
  if (typeof text === 'string' && text) {
    ctx.text(text);
    ctx.line();
  }
};

function textOf(node: JSONNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/** The core extractors. */
export function createCoreProjection(): ProjectionRegistry {
  const registry = new ProjectionRegistry();
  const lineAfter: ProjectionExtractor = (node, ctx) => {
    ctx.walkContent(node);
    ctx.line();
    return false;
  };
  const attrText =
    (...keys: string[]): ProjectionExtractor =>
    (node, ctx) => {
      for (const key of keys) {
        const value = node.attrs?.[key];
        if (typeof value === 'string' && value) {
          ctx.text(value);
          ctx.line();
        }
      }
    };
  registry
    .register('text', (node, ctx) => ctx.text(node.text ?? ''))
    .register('hardBreak', (_node, ctx) => ctx.text(' '))
    .register('blockText', lineAfter)
    .register('codeText', lineAfter)
    .register('tableCell', (node, ctx) => {
      ctx.walkContent(node);
      ctx.text(' ');
      return false;
    })
    .register('tableRow', lineAfter)
    .register('heading', (node, ctx) => {
      const level = typeof node.attrs?.['level'] === 'number' ? node.attrs['level'] : 1;
      const first = node.content?.[0];
      ctx.heading(level, first ? textOf(first) : '');
    })
    .register('mention', (node, ctx) => {
      const kind = node.attrs?.['kind'];
      const id = node.attrs?.['id'];
      if (kind === 'user') ctx.mentionUser(id);
      else if (kind === 'page') ctx.link(id, 'mention');
      else if (kind === 'date' && typeof node.attrs?.['date'] === 'string')
        ctx.text(node.attrs['date']);
    })
    .register('inlineEquation', (node, ctx) => {
      if (typeof node.attrs?.['latex'] === 'string') ctx.text(node.attrs['latex']);
    })
    .register('equation', attrText('latex'))
    .register('image', (node, ctx) => {
      ctx.file(node.attrs?.['fileId']);
      attrText('caption')(node, ctx);
    })
    .register('file', (node, ctx) => {
      ctx.file(node.attrs?.['fileId']);
      attrText('name')(node, ctx);
    })
    .register('bookmark', attrText('title', 'description', 'url'))
    .register('pageLink', (node, ctx) => ctx.link(node.attrs?.['pageId'], 'link'))
    .register('childPage', (node, ctx) => ctx.link(node.attrs?.['pageId'], 'link'))
    // `pluginText`: its own text is the fallback (PLUGINS.md §6.3), no `text` attribute.
    .register('pluginText', () => undefined)
    .register('pluginMark', () => undefined);
  return registry;
}

let core: ProjectionRegistry | undefined;

/** Projects editor JSON with the core extractors. */
export function project(doc: DocJSON): Projection {
  core ??= createCoreProjection();
  return core.project(doc);
}

/** Projects an encoded Yjs state (as stored in `page_documents.state`). */
export function projectState(state: Uint8Array): Projection {
  return project(stateToJSON(state));
}
