// SPDX-License-Identifier: AGPL-3.0-only
import { SNIPPET_END, SNIPPET_START } from '@ardoise/shared';

/** Splits a search snippet into plain and matched parts (rendered as text, never HTML). */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest) {
    const start = rest.indexOf(SNIPPET_START);
    if (start < 0) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(SNIPPET_END, start + 1);
    const stop = end < 0 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), match: true });
    rest = end < 0 ? '' : rest.slice(end + 1);
  }
  return parts.filter((p) => p.text);
}

/** `editedAfter` for an "edited within" filter. */
export function editedAfter(range: string, now = new Date()): string | undefined {
  const days = { day: 1, week: 7, month: 30, year: 365 }[range];
  return days ? new Date(now.getTime() - days * 86_400_000).toISOString() : undefined;
}

export interface SearchFilters {
  q: string;
  titleOnly: boolean;
  teamspaceId: string;
  createdBy: string;
  edited: string;
}

export function searchPath(workspaceId: string, f: SearchFilters, cursor: string | null): string {
  const params = new URLSearchParams({ q: f.q, limit: '20' });
  if (f.titleOnly) params.set('titleOnly', 'true');
  if (f.teamspaceId) params.set('teamspaceId', f.teamspaceId);
  if (f.createdBy) params.set('createdBy', f.createdBy);
  const after = editedAfter(f.edited);
  if (after) params.set('editedAfter', after);
  if (cursor) params.set('cursor', cursor);
  return `/api/workspaces/${workspaceId}/search?${params.toString()}`;
}
