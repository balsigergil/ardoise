// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { kitchenSink } from '../__fixtures__/documents.js';
import { docFromJSON, type DocJSON } from '../yjs.js';
import {
  createCoreProjection,
  MAX_PLAIN_TEXT,
  pageIdFromHref,
  project,
  projectState,
  ProjectionRegistry,
} from './projection.js';

const W = '0190a000-0000-7000-8000-00000000aaaa';
const P = '0190a000-0000-7000-8000-00000000bbbb';
const U = '0190a000-0000-7000-8000-00000000cccc';

const bt = (...content: unknown[]) => ({ type: 'blockText', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks && { marks }) });
const doc = (...content: unknown[]): DocJSON => ({ type: 'doc', content });

describe('projection', () => {
  it('extracts text with one line per text part, nested children included', () => {
    const p = project(
      doc(
        {
          type: 'heading',
          attrs: { blockId: 'h', level: 2 },
          content: [bt(t('Hello '), t('world'))],
        },
        {
          type: 'paragraph',
          attrs: { blockId: 'p' },
          content: [
            bt(t('line'), { type: 'hardBreak' }, t('two')),
            { type: 'children', content: [{ type: 'quote', content: [bt(t('nested'))] }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'codeText', content: [t('let x = 1;')] }] },
      ),
    );
    expect(p.plainText).toBe('Hello world\nline two\nnested\nlet x = 1;');
    expect(p.outline).toEqual([{ blockId: 'h', level: 2, text: 'Hello world' }]);
  });

  it('collects page links, page mentions, internal hrefs and user mentions with their block', () => {
    const p = project(
      doc(
        { type: 'pageLink', attrs: { pageId: P } },
        {
          type: 'paragraph',
          attrs: { blockId: 'b1' },
          content: [
            bt(
              { type: 'mention', attrs: { kind: 'user', id: U } },
              { type: 'mention', attrs: { kind: 'page', id: P } },
              t('x', [{ type: 'link', attrs: { href: `/w/${W}/p/${P}#block-1` } }]),
              t('y', [{ type: 'link', attrs: { href: 'https://example.org/w/x' } }]),
            ),
          ],
        },
        { type: 'childPage', attrs: { pageId: 'not-a-uuid' } },
      ),
    );
    expect(p.links).toEqual([
      { pageId: P, kind: 'link' },
      { pageId: P, kind: 'mention' },
    ]);
    expect(p.userMentions).toEqual([{ userId: U, blockId: 'b1' }]);
  });

  it('indexes attribute text (captions, equations, bookmarks, file names) and files', () => {
    const p = project(kitchenSink());
    expect(p.plainText).toContain('A caption');
    expect(p.plainText).toContain('report.pdf');
    expect(p.plainText).toContain('\\int_0^1 x\\,dx');
    expect(p.plainText).toContain('Example');
    expect(p.plainText).toContain('a b');
    expect(p.plainText).toContain('2026-11-23');
    expect(p.fileIds).toHaveLength(2);
  });

  it('uses the text fallback for plugin nodes and unknown types', () => {
    const p = project(kitchenSink());
    expect(p.plainText).toContain('Diagram');
    expect(p.plainText).toContain('Tabs');
    expect(p.plainText).toContain('inside');
    expect(p.plainText).toContain('dialogue');
    expect(p.plainText).toContain('chip');
    const unknown = project(
      doc({
        type: 'futureBlock',
        attrs: { text: 'fallback' },
        content: [{ type: 'paragraph', content: [bt(t('kept'))] }],
      }),
    );
    expect(unknown.plainText).toBe('fallback\nkept');
  });

  it('caps the plain text', () => {
    const big = 'x'.repeat(MAX_PLAIN_TEXT + 1000);
    const p = project(
      doc(
        { type: 'paragraph', content: [bt(t(big))] },
        { type: 'paragraph', content: [bt(t('after'))] },
      ),
    );
    expect(p.plainText.length).toBeLessThanOrEqual(MAX_PLAIN_TEXT);
    expect(p.plainText).not.toContain('after');
  });

  it('projects an encoded Yjs state', () => {
    const state = Y.encodeStateAsUpdate(docFromJSON(kitchenSink()));
    expect(projectState(state).plainText).toContain('Title');
  });

  it('lets extractors be registered per node type, once', () => {
    const registry = createCoreProjection();
    expect(() => registry.register('heading', () => undefined)).toThrow();
    const custom = new ProjectionRegistry().register('pluginBlock', (node, ctx) => {
      ctx.text(`custom:${String(node.attrs?.['type'])}`);
      ctx.line();
      return false;
    });
    expect(
      custom.project(doc({ type: 'pluginBlock', attrs: { type: 'd', text: 'ignored' } })).plainText,
    ).toBe('custom:d');
  });

  it('parses in-app page hrefs only', () => {
    expect(pageIdFromHref(`/w/${W}/p/${P}`)).toBe(P);
    expect(pageIdFromHref(`https://ardoise.example/w/${W}/p/${P}?x=1`)).toBe(P);
    expect(pageIdFromHref(`/w/${W}/teamspaces/${P}`)).toBeNull();
    expect(pageIdFromHref(42)).toBeNull();
  });
});
