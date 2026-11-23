// SPDX-License-Identifier: AGPL-3.0-only
import type { DocJSON } from '../yjs.js';

let counter = 0;
/** Deterministic block ids for fixtures (valid UUIDv7 shape). */
export function fixtureId(): string {
  counter += 1;
  return `0190a000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`;
}

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const blockText = (...content: unknown[]) => ({ type: 'blockText', content });

function block(type: string, attrs: Record<string, unknown> = {}, content?: unknown[]) {
  return {
    type,
    attrs: { blockId: fixtureId(), ext: null, ...attrs },
    ...(content && { content }),
  };
}

/** A document that uses every node type, mark and attribute of the core schema. */
export function kitchenSink(): DocJSON {
  return {
    type: 'doc',
    content: [
      block('heading', { level: 1, toggle: true, color: 'blue' }, [blockText(text('Title'))]),
      block('paragraph', { ext: { 'acme.review': { status: 'ok' } } }, [
        blockText(
          text('bold', [{ type: 'bold' }]),
          text('italic', [{ type: 'italic' }, { type: 'underline' }]),
          text('strike', [{ type: 'strike' }]),
          text('code', [{ type: 'code' }]),
          text('link', [{ type: 'link', attrs: { href: 'https://example.org' } }]),
          text('red', [{ type: 'textColor', attrs: { color: 'red' } }]),
          text('bg', [{ type: 'backgroundColor', attrs: { color: 'yellow' } }]),
          { type: 'hardBreak' },
          { type: 'mention', attrs: { kind: 'user', id: fixtureId(), date: null } },
          { type: 'mention', attrs: { kind: 'date', id: null, date: '2026-11-23' } },
          { type: 'inlineEquation', attrs: { latex: 'x^2' } },
          {
            type: 'pluginInline',
            attrs: { plugin: 'acme', type: 'chip', version: 2, data: { v: 1 }, text: 'chip' },
          },
          text('noted', [
            {
              type: 'pluginMark',
              attrs: { plugin: 'acme', type: 'note', version: 1, data: { id: 1 } },
            },
          ]),
        ),
        {
          type: 'children',
          content: [
            block('bulletedItem', {}, [blockText(text('bullet'))]),
            block('numberedItem', {}, [blockText(text('one'))]),
            block('todo', { checked: true }, [blockText(text('done'))]),
          ],
        },
      ]),
      block('toggle', {}, [
        blockText(text('toggle')),
        { type: 'children', content: [block('quote', {}, [blockText(text('quoted'))])] },
      ]),
      block('callout', { icon: '💡', color: 'gray_background' }, [blockText(text('callout'))]),
      block('codeBlock', { language: 'typescript', wrap: true }, [
        { type: 'codeText', content: [text('const a = 1;\n  return a;')] },
      ]),
      block('divider'),
      block('image', { fileId: fixtureId(), width: 0.5, caption: 'A caption' }),
      block('file', { fileId: fixtureId(), name: 'report.pdf', size: 1234 }),
      block('equation', { latex: '\\int_0^1 x\\,dx' }),
      block('pageLink', { pageId: fixtureId() }),
      block('childPage', { pageId: fixtureId() }),
      block('tableOfContents'),
      block('bookmark', {
        url: 'https://example.org',
        title: 'Example',
        description: 'An example',
        siteName: 'example.org',
      }),
      block('table', { headerRow: true, headerColumn: false }, [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [text('a')] },
            { type: 'tableCell', content: [text('b', [{ type: 'bold' }])] },
          ],
        },
        { type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] },
      ]),
      block('columns', {}, [
        {
          type: 'column',
          attrs: { width: 0.3 },
          content: [block('paragraph', {}, [blockText(text('left'))])],
        },
        { type: 'column', attrs: { width: 0.7 }, content: [block('paragraph', {}, [blockText()])] },
      ]),
      block('pluginBlock', {
        plugin: 'acme',
        type: 'diagram',
        version: 3,
        data: { nodes: [1, 2] },
        text: 'Diagram',
      }),
      block(
        'pluginContainer',
        { plugin: 'acme', type: 'tabs', version: 1, data: {}, text: 'Tabs' },
        [block('paragraph', {}, [blockText(text('inside'))])],
      ),
      block(
        'pluginText',
        { plugin: 'acme', type: 'line', version: 1, data: { who: 'A' }, text: '', color: null },
        [blockText(text('dialogue'))],
      ),
    ],
  };
}
