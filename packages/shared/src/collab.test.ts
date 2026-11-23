// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  collabDocumentName,
  parseCollabDocumentName,
  presenceColor,
  PRESENCE_COLORS,
} from './collab.js';
import { newId } from './ids.js';

describe('collab document names', () => {
  const ws = newId();
  const page = newId();

  it('round-trips page documents', () => {
    expect(parseCollabDocumentName(collabDocumentName(ws, page))).toEqual({
      workspaceId: ws,
      kind: 'page',
      id: page,
      docName: `page:${page}`,
    });
  });

  it('parses the reserved prefixes (the server rejects them until their milestone)', () => {
    expect(parseCollabDocumentName(`${ws}/plugin:${page}`)?.kind).toBe('plugin');
    expect(parseCollabDocumentName(`${ws}/synced:${page}`)?.kind).toBe('synced');
  });

  it('rejects malformed names', () => {
    for (const name of [
      '',
      `page:${page}`,
      `${ws}/other:${page}`,
      `${ws}/page:${page}/x`,
      `${ws}/page:not-a-uuid-not-a-uuid-not-a-uuid-xxxx`,
      `00000000-0000-4000-8000-000000000000/page:${page}`,
    ]) {
      expect(parseCollabDocumentName(name), name).toBeNull();
    }
  });

  it('picks a stable presence color', () => {
    const id = newId();
    expect(presenceColor(id)).toBe(presenceColor(id));
    expect(PRESENCE_COLORS).toContain(presenceColor(id));
  });
});
