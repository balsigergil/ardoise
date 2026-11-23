// SPDX-License-Identifier: AGPL-3.0-only
import { Mark, mergeAttributes, Node } from '@tiptap/core';
import { isColor, stringAttr } from './attributes.js';

/** Mention of a user, a page or a date (PRODUCT §6.1). */
export const MENTION_KINDS = ['user', 'page', 'date'] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    kind: {
      default: 'page',
      parseHTML: (el) => {
        const raw = el.getAttribute('data-kind');
        return (MENTION_KINDS as readonly (string | null)[]).includes(raw) ? raw : 'page';
      },
      renderHTML: (attrs) => ({ 'data-kind': String(attrs['kind']) }),
    },
    id: stringAttr('id'),
    date: stringAttr('date'),
  }),
  parseHTML: () => [{ tag: 'span[data-mention]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'span',
    mergeAttributes({ 'data-mention': '' }, HTMLAttributes),
    String(node.attrs['date'] ?? node.attrs['id'] ?? ''),
  ],
});

export const InlineEquation = Node.create({
  name: 'inlineEquation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ latex: stringAttr('latex', '') }),
  parseHTML: () => [{ tag: 'span[data-inline-equation]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'span',
    mergeAttributes({ 'data-inline-equation': '' }, HTMLAttributes),
    String(node.attrs['latex']),
  ],
});

export const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: () => ['br'],
});

export const Bold = Mark.create({
  name: 'bold',
  parseHTML: () => [
    { tag: 'strong' },
    { tag: 'b', getAttrs: (el) => (el.style.fontWeight === 'normal' ? false : null) },
    {
      style: 'font-weight',
      getAttrs: (value) => (/^(bold(er)?|[6-9]\d{2})$/.test(value) ? null : false),
    },
  ],
  renderHTML: () => ['strong', 0],
});

export const Italic = Mark.create({
  name: 'italic',
  parseHTML: () => [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
  renderHTML: () => ['em', 0],
});

export const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration=underline' }],
  renderHTML: () => ['u', 0],
});

export const Strike = Mark.create({
  name: 'strike',
  parseHTML: () => [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
  renderHTML: () => ['s', 0],
});

export const Code = Mark.create({
  name: 'code',
  parseHTML: () => [{ tag: 'code' }],
  renderHTML: () => ['code', 0],
});

/** Links: only http(s), mailto and same-origin relative URLs are kept. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  if (href.startsWith('#')) return true;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export const Link = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes: () => ({
    href: {
      default: null,
      parseHTML: (el) => el.getAttribute('href'),
      renderHTML: (attrs) => ({ href: attrs['href'] as string }),
    },
  }),
  parseHTML: () => [
    {
      tag: 'a[href]',
      getAttrs: (el) => (isSafeHref(el.getAttribute('href')) ? null : false),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => [
    'a',
    mergeAttributes(HTMLAttributes, { rel: 'noopener noreferrer nofollow' }),
    0,
  ],
});

function colorMark(name: 'textColor' | 'backgroundColor', html: string) {
  return Mark.create({
    name,
    addAttributes: () => ({
      color: {
        default: 'gray',
        parseHTML: (el) => el.getAttribute(html),
        renderHTML: (attrs) => ({ [html]: attrs['color'] as string }),
      },
    }),
    parseHTML: () => [
      { tag: `span[${html}]`, getAttrs: (el) => (isColor(el.getAttribute(html)) ? null : false) },
    ],
    renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  });
}

export const TextColor = colorMark('textColor', 'data-text-color');
export const BackgroundColor = colorMark('backgroundColor', 'data-background-color');

export const inlineNodes = [Mention, InlineEquation, HardBreak];
export const marks = [Bold, Italic, Underline, Strike, Code, Link, TextColor, BackgroundColor];
