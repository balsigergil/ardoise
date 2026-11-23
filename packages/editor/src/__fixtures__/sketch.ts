// SPDX-License-Identifier: AGPL-3.0-only
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { getEditorSchema } from '../schema/index.js';

/**
 * Test DSL: a document is written as indented lines `<type>[:attr=value] <text>`; two
 * spaces of indentation put a block in the children of the line above. `|` in the text
 * marks the cursor (a second `|` makes a text selection). `columns` lines hold `column`
 * lines, whose children are the column's blocks.
 */
const schema = getEditorSchema();
let ids = 0;

interface Line {
  indent: number;
  type: string;
  attrs: Record<string, unknown>;
  text: string;
}

function parseLine(raw: string): Line {
  const indent = raw.length - raw.trimStart().length;
  const [head = '', ...rest] = raw.trim().split(' ');
  const [type = '', ...attrParts] = head.split(':');
  const attrs: Record<string, unknown> = {};
  for (const part of attrParts) {
    const [key = '', value = ''] = part.split('=');
    attrs[key] =
      value === 'true'
        ? true
        : value === 'false'
          ? false
          : /^\d+$/.test(value)
            ? Number(value)
            : value;
  }
  return { indent: indent / 2, type, attrs, text: rest.join(' ') };
}

function build(lines: Line[], start: number, indent: number): [PMNode[], number] {
  const nodes: PMNode[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent) {
    const line = lines[i]!;
    const [kids, next] = build(lines, i + 1, indent + 1);
    i = next;
    nodes.push(make(line, kids));
  }
  return [nodes, i];
}

function make(line: Line, kids: PMNode[]): PMNode {
  const type = schema.nodes[line.type];
  if (!type) throw new Error(`unknown type ${line.type}`);
  if (line.type === 'columns') return type.create({ blockId: `c${++ids}` }, kids);
  if (line.type === 'column') return type.create(null, kids);
  const attrs: Record<string, unknown> = {
    blockId: line.attrs['id'] ?? `b${++ids}`,
    ...line.attrs,
  };
  delete attrs['id'];
  const content: PMNode[] = [];
  const spec = type.spec.content ?? '';
  const text = line.text.replace(/\|/g, '‸');
  if (spec.startsWith('blockText')) {
    content.push(schema.nodes['blockText']!.create(null, text ? schema.text(text) : null));
  } else if (spec.startsWith('codeText')) {
    content.push(schema.nodes['codeText']!.create(null, text ? schema.text(text) : null));
  }
  if (kids.length) content.push(schema.nodes['children']!.create(null, kids));
  return type.create(attrs, content);
}

/** Builds a state from the DSL; `|` markers become the selection. */
export function stateOf(source: string, select?: { node: string }): EditorState {
  const lines = source
    .split('\n')
    .filter((l) => l.trim())
    .map(parseLine);
  const minIndent = Math.min(...lines.map((l) => l.indent));
  lines.forEach((l) => (l.indent -= minIndent));
  const [nodes] = build(lines, 0, 0);
  let doc = schema.nodes['doc']!.create(null, nodes);
  const marks: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      let offset = 0;
      for (const char of node.text!) {
        if (char === '‸') marks.push(pos + offset);
        offset++;
      }
    }
  });
  // Remove markers, adjusting positions.
  let state = EditorState.create({ doc, schema });
  if (marks.length) {
    const tr = state.tr;
    [...marks].reverse().forEach((pos) => tr.delete(pos, pos + 1));
    doc = tr.doc;
    const anchor = marks[0]!;
    const head = marks.length > 1 ? marks[1]! - 1 : anchor;
    state = EditorState.create({ doc, schema, selection: TextSelection.create(doc, anchor, head) });
  }
  if (select) {
    let target = -1;
    state.doc.descendants((node, pos) => {
      if (target < 0 && node.attrs['blockId'] === select.node) target = pos;
    });
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, target)));
  }
  return state;
}

/** The DSL form of a document, with `|` at the cursor (ids omitted unless asked). */
export function sketch(
  state: EditorState,
  options: { ids?: boolean; attrs?: string[] } = {},
): string {
  const lines: string[] = [];
  const cursor = state.selection.empty ? state.selection.from : -1;
  const walk = (node: PMNode, pos: number, indent: number) => {
    node.forEach((child, offset) => {
      const childPos = pos + offset;
      if (child.type.name === 'children') return walk(child, childPos + 1, indent);
      if (!child.type.isInGroup('block') && child.type.name !== 'column') return;
      let head = child.type.name;
      for (const key of options.attrs ?? []) {
        if (child.attrs[key] !== undefined && child.attrs[key] !== null)
          head += `:${key}=${String(child.attrs[key])}`;
      }
      if (options.ids && child.attrs['blockId']) head += `:id=${String(child.attrs['blockId'])}`;
      let text = '';
      const first = child.firstChild;
      if (first && (first.type.name === 'blockText' || first.type.name === 'codeText')) {
        const start = childPos + 2;
        text = first.textContent;
        if (cursor >= start && cursor <= start + first.content.size) {
          const offset = cursor - start;
          text = `${text.slice(0, offset)}|${text.slice(offset)}`;
        }
      }
      lines.push(`${'  '.repeat(indent)}${head}${text ? ` ${text}` : ''}`);
      walk(child, childPos + 1, indent + 1);
    });
  };
  walk(state.doc, 0, 0);
  return lines.join('\n');
}

/** Dedents a template literal sketch for readable `toBe` assertions. */
export function lines(source: string): string {
  const rows = source.split('\n').filter((l) => l.trim());
  const min = Math.min(...rows.map((l) => l.length - l.trimStart().length));
  return rows.map((l) => l.slice(min).trimEnd()).join('\n');
}
