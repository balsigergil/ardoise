// SPDX-License-Identifier: AGPL-3.0-only
import { mergeAttributes, Node, type Attribute } from '@tiptap/core';
import { Fragment, type Schema, type TagParseRule } from '@tiptap/pm/model';
import { blockColorAttr, boolAttr, intAttr, numberAttr, stringAttr } from './attributes.js';
import type { BlockName } from './names.js';

/**
 * Block nodes of the core schema (ADR 0009 §1). Each block is one node named after its
 * type; `blockId` and `ext` are added to all of them by `BlockAttributes`.
 *
 * HTML: every block renders as `<div data-type="<name>">`, which is what copy and paste
 * inside Ardoise round-trips through. Rules for foreign HTML (`<p>`, `<h1>`, `<ul>`…)
 * have a lower priority, so they never shadow the internal form.
 */

/** Groups: `block` for every block, `flowBlock` for those allowed inside a column. */
const FLOW = 'block flowBlock';
const INTERNAL = 100;

function internalRule(name: string): TagParseRule {
  return { tag: `div[data-type="${name}"]`, priority: INTERNAL };
}

function render(name: string) {
  return ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) =>
    ['div', mergeAttributes({ 'data-type': name }, HTMLAttributes), 0] as const;
}

interface BlockOptions {
  attrs?: Record<string, Attribute>;
  foreign?: TagParseRule[];
}

function textBlock(name: BlockName, { attrs = {}, foreign = [] }: BlockOptions = {}) {
  return Node.create({
    name,
    group: FLOW,
    content: 'blockText children?',
    defining: true,
    addAttributes: () => ({ color: blockColorAttr, ...attrs }),
    parseHTML: () => [internalRule(name), ...foreign],
    renderHTML: render(name),
  });
}

function leafBlock(name: BlockName, { attrs = {}, foreign = [] }: BlockOptions = {}) {
  return Node.create({
    name,
    group: FLOW,
    content: 'children?',
    selectable: true,
    draggable: true,
    addAttributes: () => attrs,
    parseHTML: () => [internalRule(name), ...foreign],
    renderHTML: render(name),
  });
}

/** Shared textblock part of every text block. */
export const BlockText = Node.create({
  name: 'blockText',
  content: 'inline*',
  parseHTML: () => [{ tag: 'div[data-block-text]', priority: INTERNAL }],
  renderHTML: () => ['div', { 'data-block-text': '' }, 0],
});

/** Child blocks of any block (Tab / Shift+Tab). */
export const Children = Node.create({
  name: 'children',
  content: 'block+',
  parseHTML: () => [{ tag: 'div[data-children]', priority: INTERNAL }],
  renderHTML: () => ['div', { 'data-children': '' }, 0],
});

export const Paragraph = textBlock('paragraph', { foreign: [{ tag: 'p' }] });

export const Heading = textBlock('heading', {
  attrs: { level: intAttr('level', 1, 1, 3), toggle: boolAttr('toggle') },
  foreign: [1, 2, 3, 4, 5, 6].map((level) => ({
    tag: `h${level}`,
    attrs: { level: Math.min(level, 3) },
  })),
});

export const BulletedItem = textBlock('bulletedItem', { foreign: [{ tag: 'ul > li' }] });
export const NumberedItem = textBlock('numberedItem', { foreign: [{ tag: 'ol > li' }] });

export const Todo = textBlock('todo', {
  attrs: { checked: boolAttr('checked') },
  foreign: [
    {
      tag: 'li[data-checked]',
      priority: 60,
      getAttrs: (el) => ({ checked: el.getAttribute('data-checked') === 'true' }),
    },
  ],
});

export const Toggle = textBlock('toggle', { foreign: [{ tag: 'details' }] });
export const Quote = textBlock('quote', { foreign: [{ tag: 'blockquote' }] });
export const Callout = textBlock('callout', { attrs: { icon: stringAttr('icon') } });

export const CodeText = Node.create({
  name: 'codeText',
  content: 'text*',
  marks: '',
  code: true,
  parseHTML: () => [{ tag: 'pre[data-code-text]', priority: INTERNAL, preserveWhitespace: 'full' }],
  renderHTML: () => ['pre', { 'data-code-text': '' }, ['code', 0]],
});

/** Foreign `<pre>`: the whole text becomes the code part of a code block. */
function codeFromPre(el: HTMLElement, schema: Schema): Fragment {
  const text = el.textContent ?? '';
  return Fragment.from(schema.nodes['codeText']!.create(null, text ? schema.text(text) : null));
}

export const CodeBlock = Node.create({
  name: 'codeBlock',
  group: FLOW,
  content: 'codeText children?',
  defining: true,
  addAttributes: () => ({ language: stringAttr('language', 'plain'), wrap: boolAttr('wrap') }),
  parseHTML: () => [
    internalRule('codeBlock'),
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: (el) => {
        const cls = el.querySelector('code')?.className ?? '';
        const lang = /language-([\w+#-]+)/.exec(cls)?.[1];
        return { language: lang ?? 'plain' };
      },
      getContent: (el, schema) => codeFromPre(el as HTMLElement, schema),
    },
  ],
  renderHTML: render('codeBlock'),
});

export const Divider = leafBlock('divider', { foreign: [{ tag: 'hr' }] });

export const Image = leafBlock('image', {
  attrs: {
    fileId: stringAttr('fileId'),
    width: numberAttr('width'),
    caption: stringAttr('caption', ''),
  },
});

export const File = leafBlock('file', {
  attrs: {
    fileId: stringAttr('fileId'),
    name: stringAttr('name', ''),
    size: intAttr('size', 0, 0, Number.MAX_SAFE_INTEGER),
  },
});

export const Equation = leafBlock('equation', { attrs: { latex: stringAttr('latex', '') } });
export const PageLink = leafBlock('pageLink', { attrs: { pageId: stringAttr('pageId') } });
export const ChildPage = leafBlock('childPage', { attrs: { pageId: stringAttr('pageId') } });
export const TableOfContents = leafBlock('tableOfContents');

export const Bookmark = leafBlock('bookmark', {
  attrs: {
    url: stringAttr('url', ''),
    title: stringAttr('title', ''),
    description: stringAttr('description', ''),
    siteName: stringAttr('siteName', ''),
  },
});

export const Table = Node.create({
  name: 'table',
  group: FLOW,
  content: 'tableRow+',
  isolating: true,
  addAttributes: () => ({
    headerRow: boolAttr('headerRow', true),
    headerColumn: boolAttr('headerColumn'),
  }),
  parseHTML: () => [{ tag: 'table', priority: INTERNAL }],
  renderHTML: ({ HTMLAttributes }) => [
    'table',
    mergeAttributes({ 'data-type': 'table' }, HTMLAttributes),
    ['tbody', 0],
  ],
});

export const TableRow = Node.create({
  name: 'tableRow',
  content: 'tableCell+',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0],
});

export const TableCell = Node.create({
  name: 'tableCell',
  content: 'inline*',
  isolating: true,
  parseHTML: () => [{ tag: 'td' }, { tag: 'th' }],
  renderHTML: () => ['td', 0],
});

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,5}',
  isolating: true,
  parseHTML: () => [internalRule('columns')],
  renderHTML: render('columns'),
});

export const Column = Node.create({
  name: 'column',
  content: 'flowBlock+',
  isolating: true,
  addAttributes: () => ({ width: numberAttr('width') }),
  parseHTML: () => [{ tag: 'div[data-type="column"]', priority: INTERNAL }],
  renderHTML: render('column'),
});

export const Doc = Node.create({ name: 'doc', topNode: true, content: 'block*' });
export const Text = Node.create({ name: 'text', group: 'inline' });

export const blockNodes = [
  Doc,
  Text,
  BlockText,
  Children,
  Paragraph,
  Heading,
  BulletedItem,
  NumberedItem,
  Todo,
  Toggle,
  Quote,
  Callout,
  CodeText,
  CodeBlock,
  Divider,
  Image,
  File,
  Equation,
  PageLink,
  ChildPage,
  TableOfContents,
  Bookmark,
  Table,
  TableRow,
  TableCell,
  Columns,
  Column,
];
