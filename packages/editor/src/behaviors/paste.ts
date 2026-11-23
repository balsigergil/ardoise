// SPDX-License-Identifier: AGPL-3.0-only
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { DocJSON } from '../yjs.js';
import { isSafeHref } from '../schema/inline.js';

/** Turns Markdown text into editor JSON (provided by `@ardoise/markdown`). */
export type MarkdownParser = (markdown: string) => DocJSON;

export const pasteKey = new PluginKey('pasteConversion');

/** Heuristic: does plain text look like Markdown worth converting into blocks? */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const blockSyntax =
    /^(\s*)(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|- \[[ xX]\]\s|\|.*\|\s*$|---\s*$)/;
  if (lines.some((line) => blockSyntax.test(line))) return true;
  return /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/.test(text);
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text) && isSafeHref(text);
}

/** Slice of blocks for `json`; a single paragraph is pasted inline (no new block). */
export function sliceFromJSON(schema: Schema, json: DocJSON): Slice {
  const doc: PMNode = schema.nodeFromJSON(json);
  if (
    doc.childCount === 1 &&
    doc.firstChild!.type.name === 'paragraph' &&
    doc.firstChild!.childCount === 1
  ) {
    return new Slice(doc.firstChild!.firstChild!.content, 0, 0);
  }
  return new Slice(doc.content, 0, 0);
}

/**
 * Paste conversion (PRODUCT §6.1): HTML goes through the schema's parse rules (unknown
 * markup is dropped, links are filtered by `isSafeHref`); plain text that looks like
 * Markdown is converted into blocks; a URL pasted over a selection becomes a link.
 * Code blocks always receive plain text.
 */
export function createPasteConversion(parseMarkdown?: MarkdownParser) {
  return Extension.create({
    name: 'pasteConversion',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: pasteKey,
          props: {
            handlePaste(view, event) {
              const data = event.clipboardData;
              if (!data) return false;
              const { state } = view;
              const { $from } = state.selection;
              const text = data.getData('text/plain');
              if ($from.parent.type.name === 'codeText') {
                if (!text) return true;
                view.dispatch(state.tr.insertText(text.replace(/\r\n/g, '\n')).scrollIntoView());
                return true;
              }
              const html = data.getData('text/html');
              if (html) return false; // default HTML parsing through parse rules
              if (!text) return false;
              const trimmed = text.trim();
              if (isUrl(trimmed) && !state.selection.empty) {
                return editor.commands.setMark('link', { href: trimmed });
              }
              return false;
            },
            /** Plain text: Markdown when it looks like it, else one paragraph per line. */
            clipboardTextParser(text, $context) {
              const schema = $context.doc.type.schema;
              if ($context.parent.type.name === 'codeText') {
                return new Slice(Fragment.from(schema.text(text)), 0, 0);
              }
              if (parseMarkdown && looksLikeMarkdown(text)) {
                return sliceFromJSON(schema, parseMarkdown(text));
              }
              const lines = text.replace(/\r\n?/g, '\n').split('\n');
              if (lines.length === 1) {
                return new Slice(
                  lines[0] ? Fragment.from(schema.text(lines[0])) : Fragment.empty,
                  0,
                  0,
                );
              }
              const blocks = lines.map((line) =>
                schema.nodes['paragraph']!.create(
                  null,
                  schema.nodes['blockText']!.create(null, line ? schema.text(line) : null),
                ),
              );
              return new Slice(Fragment.from(blocks), 0, 0);
            },
          },
        }),
      ];
    },
  });
}
