// SPDX-License-Identifier: AGPL-3.0-only
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from './schema/names.js';
import { getEditorSchema } from './schema/index.js';

/** Editor JSON (`doc` node). */
export interface DocJSON {
  type: 'doc';
  content?: unknown[];
}

/** Builds a Yjs document from editor JSON (seeds, imports, duplication, tests). */
export function docFromJSON(json: DocJSON, schema: Schema = getEditorSchema()): Y.Doc {
  const ydoc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(schema, json, ydoc.getXmlFragment(CONTENT_FRAGMENT));
  return ydoc;
}

/** Reads the body of a Yjs document as editor JSON (no schema validation). */
export function docToJSON(ydoc: Y.Doc): DocJSON {
  return yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(CONTENT_FRAGMENT)) as DocJSON;
}

/** Decodes an encoded Yjs state (as stored in `page_documents.state`) to editor JSON. */
export function stateToJSON(state: Uint8Array): DocJSON {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    return docToJSON(ydoc);
  } finally {
    ydoc.destroy();
  }
}

/** Parses editor JSON into a ProseMirror node, throwing if it violates the schema. */
export function nodeFromJSON(json: DocJSON, schema: Schema = getEditorSchema()): PMNode {
  const node = schema.nodeFromJSON(json);
  node.check();
  return node;
}
