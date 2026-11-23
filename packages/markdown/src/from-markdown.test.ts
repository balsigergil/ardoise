// SPDX-License-Identifier: AGPL-3.0-only
import { nodeFromJSON, type JSONNode } from '@ardoise/editor';
import { describe, expect, it } from 'vitest';
import { markdownToDoc } from './from-markdown.js';

/** Compact outline: `type[attrs] text`, two spaces per nesting level. */
function outline(markdown: string): string {
  const doc = markdownToDoc(markdown);
  expect(() => nodeFromJSON(doc)).not.toThrow();
  const lines: string[] = [];
  const textOf = (n: JSONNode): string => n.text ?? (n.content ?? []).map(textOf).join('');
  const walk = (nodes: JSONNode[], depth: number) => {
    for (const node of nodes) {
      const attrs = Object.entries(node.attrs ?? {})
        .filter(([k]) => k !== 'blockId')
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',');
      const first = node.content?.[0];
      const text =
        first && (first.type === 'blockText' || first.type === 'codeText') ? textOf(first) : '';
      lines.push(
        `${'  '.repeat(depth)}${node.type}${attrs ? `[${attrs}]` : ''}${text ? ` ${text}` : ''}`,
      );
      const kids = node.content?.find((c) => c.type === 'children');
      if (kids) walk(kids.content ?? [], depth + 1);
    }
  };
  walk(doc.content as JSONNode[], 0);
  return lines.join('\n');
}

const marks = (markdown: string) => {
  const found: string[] = [];
  const walk = (n: JSONNode) => {
    if (n.type === 'text') found.push(`${n.text}:${(n.marks ?? []).map((m) => m.type).join('+')}`);
    if (n.type === 'inlineEquation') found.push(`eq:${String(n.attrs?.['latex'])}`);
    (n.content ?? []).forEach(walk);
  };
  walk(markdownToDoc(markdown) as JSONNode);
  return found;
};

describe('markdownToDoc', () => {
  it('maps headings (h4+ become h3), paragraphs and dividers', () => {
    expect(outline('# A\n\n## B\n\n#### D\n\ntext\n\n---')).toBe(
      'heading[level=1] A\nheading[level=2] B\nheading[level=3] D\nparagraph text\ndivider',
    );
  });

  it('maps lists with nesting, ordered lists and task lists', () => {
    expect(outline('- a\n  - b\n    more\n- c\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done')).toBe(
      [
        'bulletedItem a',
        '  bulletedItem b more',
        'bulletedItem c',
        'numberedItem one',
        'numberedItem two',
        'todo[checked=false] todo',
        'todo[checked=true] done',
      ].join('\n'),
    );
  });

  it('maps quotes and GitHub alerts to callouts', () => {
    expect(outline('> quoted\n>\n> second')).toBe('quote quoted\n  paragraph second');
    expect(outline('> [!WARNING]\n> careful')).toBe('callout[icon=⚠️] careful');
  });

  it('maps code blocks with their language, tables and math', () => {
    expect(outline('```TS\nlet a = 1;\n```\n\n```\nplain\n```')).toBe(
      'codeBlock[language=ts] let a = 1;\ncodeBlock[language=plain] plain',
    );
    const table = markdownToDoc('| a | b |\n|---|---|\n| 1 |\n').content![0] as JSONNode;
    expect(table.type).toBe('table');
    expect(table.content).toHaveLength(2);
    expect(table.content![1]!.content).toHaveLength(2); // short rows are padded
    expect(outline('$$\nx^2\n$$')).toBe('equation[latex=x^2]');
  });

  it('maps inline marks, links, breaks and inline math', () => {
    expect(marks('**b** *i* ~~s~~ `c` [l](https://a.b) $x$')).toEqual([
      'b:bold',
      ' :',
      'i:italic',
      ' :',
      's:strike',
      ' :',
      'c:code',
      ' :',
      'l:link',
      ' :',
      'eq:x',
    ]);
    expect(marks('***both***')).toEqual(['both:italic+bold']);
  });

  it('drops unsafe links and turns images into links', () => {
    expect(marks('[x](javascript:alert(1))')).toEqual(['x:']);
    expect(marks('![alt](https://img.example/a.png)')).toEqual(['alt:link']);
  });

  it('keeps raw HTML as text instead of interpreting it', () => {
    expect(outline('<script>alert(1)</script>')).toBe('paragraph <script>alert(1)</script>');
  });

  it('gives every block a fresh id', () => {
    const doc = markdownToDoc('a\n\nb');
    const ids = (doc.content as JSONNode[]).map((n) => n.attrs?.['blockId']);
    expect(new Set(ids).size).toBe(2);
  });
});
