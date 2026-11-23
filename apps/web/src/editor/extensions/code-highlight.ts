// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Syntax highlighting of code blocks: lowlight (highlight.js grammars) produces token
 * decorations over the `codeText` part; the language is an attribute of the parent
 * `codeBlock`. Results are memoized by (language, text), so typing re-highlights only the
 * block being edited.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { common, createLowlight } from 'lowlight';

export const lowlight = createLowlight(common);

/** Languages offered in the code block menu (`plain` first). */
export const CODE_LANGUAGES = ['plain', ...lowlight.listLanguages().sort()];

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

const memo = new Map<string, [number, number, string][]>();
const MEMO_SIZE = 500;

/** Flattens lowlight's tree into [from, to, classes] ranges relative to the text. */
export function tokenRanges(code: string, language: string): [number, number, string][] {
  if (language === 'plain' || !lowlight.registered(language)) return [];
  const id = `${language}\u0000${code}`;
  const cached = memo.get(id);
  if (cached) return cached;
  const ranges = highlight(code, language);
  if (memo.size >= MEMO_SIZE) memo.delete(memo.keys().next().value!);
  memo.set(id, ranges);
  return ranges;
}

function highlight(code: string, language: string): [number, number, string][] {
  const tree = lowlight.highlight(language, code) as unknown as HastNode;
  const ranges: [number, number, string][] = [];
  let offset = 0;
  const walk = (node: HastNode, classes: string[]) => {
    if (node.type === 'text') {
      const length = node.value?.length ?? 0;
      if (classes.length) ranges.push([offset, offset + length, classes.join(' ')]);
      offset += length;
      return;
    }
    const next = node.properties?.className ? [...classes, ...node.properties.className] : classes;
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(tree, []);
  return ranges;
}

const key = new PluginKey<DecorationSet>('codeHighlight');

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock;
    const code = node.firstChild;
    if (code?.type.name !== 'codeText') return true;
    const start = pos + 2;
    for (const [from, to, cls] of tokenRanges(code.textContent, String(node.attrs['language']))) {
      decorations.push(Decoration.inline(start + from, start + to, { class: cls }));
    }
    return true; // children may hold code blocks too
  });
  return DecorationSet.create(doc, decorations);
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_c, state) => decorate(state.doc),
        apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set.map(tr.mapping, tr.doc)),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
  ],
});
