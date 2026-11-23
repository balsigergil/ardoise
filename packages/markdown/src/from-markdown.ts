// SPDX-License-Identifier: AGPL-3.0-only
import { isSafeHref, type DocJSON, type JSONNode } from '@ardoise/editor';
import { newId } from '@ardoise/shared';
import type {
  Blockquote,
  Code,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  RootContent,
  Table,
} from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** Math nodes added by remark-math. */
interface MathNode {
  type: 'math' | 'inlineMath';
  value: string;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** GitHub-style alerts (`> [!NOTE]`) become callouts. */
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const ALERT_ICONS: Record<string, string> = {
  NOTE: 'ℹ️',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠️',
  CAUTION: '🛑',
};

function block(
  type: string,
  attrs: Record<string, unknown>,
  text: JSONNode[],
  children: JSONNode[] = [],
): JSONNode {
  const content: JSONNode[] = [{ type: 'blockText', ...(text.length && { content: text }) }];
  if (children.length) content.push({ type: 'children', content: children });
  return { type, attrs: { blockId: newId(), ...attrs }, content };
}

function inline(nodes: readonly PhrasingContent[], marks: Mark[] = []): JSONNode[] {
  const out: JSONNode[] = [];
  const text = (value: string, extra: Mark[] = []) => {
    if (!value) return;
    const all = [...marks, ...extra];
    out.push({ type: 'text', text: value, ...(all.length && { marks: all }) });
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        text(node.value.replace(/\n/g, ' '));
        break;
      case 'strong':
        out.push(...inline(node.children, [...marks, { type: 'bold' }]));
        break;
      case 'emphasis':
        out.push(...inline(node.children, [...marks, { type: 'italic' }]));
        break;
      case 'delete':
        out.push(...inline(node.children, [...marks, { type: 'strike' }]));
        break;
      case 'inlineCode':
        text(node.value, [{ type: 'code' }]);
        break;
      case 'break':
        out.push({ type: 'hardBreak' });
        break;
      case 'link': {
        const link = isSafeHref(node.url) ? [{ type: 'link', attrs: { href: node.url } }] : [];
        out.push(...inline(node.children, [...marks, ...link]));
        break;
      }
      case 'image': {
        // Remote images are not shown (strict CSP, no file id): keep a link with the alt text.
        const label = node.alt || node.url;
        text(label, isSafeHref(node.url) ? [{ type: 'link', attrs: { href: node.url } }] : []);
        break;
      }
      default: {
        const value = (node as unknown as MathNode).type === 'inlineMath' ? null : toString(node);
        if ((node as unknown as MathNode).type === 'inlineMath') {
          out.push({
            type: 'inlineEquation',
            attrs: { latex: (node as unknown as MathNode).value },
          });
        } else if (value) text(value);
      }
    }
  }
  return out;
}

/** Splits a container's children into the text of its first paragraph and the rest. */
function textAndChildren(nodes: readonly RootContent[]): [JSONNode[], JSONNode[]] {
  const [first, ...rest] = nodes;
  if (first?.type === 'paragraph') return [inline(first.children), blocks(rest)];
  return [[], blocks(nodes)];
}

function listItems(list: List): JSONNode[] {
  return list.children.map((item: ListItem) => {
    const [text, children] = textAndChildren(item.children);
    if (typeof item.checked === 'boolean')
      return block('todo', { checked: item.checked }, text, children);
    return block(list.ordered ? 'numberedItem' : 'bulletedItem', {}, text, children);
  });
}

function quote(node: Blockquote): JSONNode {
  const [first] = node.children;
  if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
    const head = first.children[0];
    const match = ALERT.exec(head.value);
    if (match) {
      const kind = match[1]!.toUpperCase();
      const rest = { ...head, value: head.value.slice(match[0].length) };
      const paragraph = { ...first, children: [rest, ...first.children.slice(1)] };
      const [text, children] = textAndChildren([paragraph, ...node.children.slice(1)]);
      return block('callout', { icon: ALERT_ICONS[kind] }, text, children);
    }
  }
  const [text, children] = textAndChildren(node.children);
  return block('quote', {}, text, children);
}

function code(node: Code): JSONNode {
  return {
    type: 'codeBlock',
    attrs: { blockId: newId(), language: node.lang?.toLowerCase() ?? 'plain' },
    content: [
      { type: 'codeText', ...(node.value && { content: [{ type: 'text', text: node.value }] }) },
    ],
  };
}

function table(node: Table): JSONNode {
  const width = Math.max(1, ...node.children.map((row) => row.children.length));
  return {
    type: 'table',
    attrs: { blockId: newId(), headerRow: true },
    content: node.children.map((row) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, i) => {
        const cell = row.children[i];
        const content = cell ? inline(cell.children) : [];
        return { type: 'tableCell', ...(content.length && { content }) };
      }),
    })),
  };
}

function blocks(nodes: readonly RootContent[]): JSONNode[] {
  const out: JSONNode[] = [];
  for (const node of nodes as readonly Nodes[]) {
    switch (node.type) {
      case 'heading':
        out.push(block('heading', { level: Math.min(node.depth, 3) }, inline(node.children)));
        break;
      case 'paragraph':
        out.push(block('paragraph', {}, inline(node.children)));
        break;
      case 'list':
        out.push(...listItems(node));
        break;
      case 'blockquote':
        out.push(quote(node));
        break;
      case 'code':
        out.push(code(node));
        break;
      case 'thematicBreak':
        out.push({ type: 'divider', attrs: { blockId: newId() } });
        break;
      case 'table':
        out.push(table(node));
        break;
      case 'html':
        // Raw HTML is not interpreted: it is kept as text.
        if (node.value.trim())
          out.push(block('paragraph', {}, [{ type: 'text', text: node.value.trim() }]));
        break;
      default: {
        const math = node as unknown as MathNode;
        if (math.type === 'math') {
          out.push({ type: 'equation', attrs: { blockId: newId(), latex: math.value } });
          break;
        }
        const value = toString(node);
        if (value.trim()) out.push(block('paragraph', {}, [{ type: 'text', text: value }]));
      }
    }
  }
  return out;
}

/** Parses Markdown (CommonMark + GFM + math) into editor JSON with fresh block ids. */
export function markdownToDoc(markdown: string): DocJSON {
  const root = processor.parse(markdown);
  return { type: 'doc', content: blocks(root.children) };
}
