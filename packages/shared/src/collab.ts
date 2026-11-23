// SPDX-License-Identifier: AGPL-3.0-only
import { isUuidV7 } from './ids.js';

/**
 * Collaboration protocol details shared by the client and the `collab` role
 * (ADR 0009 §4–§6).
 */

/** WebSocket path of Hocuspocus on the single public origin. */
export const COLLAB_PATH = '/collab';

/** Document kinds; `synced` (M6) and `plugin` (M9) are reserved and rejected for now. */
export type CollabDocKind = 'page' | 'synced' | 'plugin';

export interface CollabDocRef {
  workspaceId: string;
  kind: CollabDocKind;
  /** The id after the prefix: a page id, a synced block id or a block id. */
  id: string;
  /** `page_documents.doc_name`, e.g. `page:<id>`. */
  docName: string;
}

const KINDS: readonly CollabDocKind[] = ['page', 'synced', 'plugin'];

/** `<workspaceId>/page:<pageId>`. */
export function collabDocumentName(workspaceId: string, pageId: string): string {
  return `${workspaceId}/page:${pageId}`;
}

/** Parses a Hocuspocus document name; null when malformed. */
export function parseCollabDocumentName(name: string): CollabDocRef | null {
  const match = /^([0-9a-f-]{36})\/([a-z]+):([0-9a-f-]{36})$/.exec(name);
  if (!match) return null;
  const [, workspaceId, kind, id] = match as unknown as [string, string, string, string];
  if (!isUuidV7(workspaceId) || !isUuidV7(id)) return null;
  if (!(KINDS as readonly string[]).includes(kind)) return null;
  return { workspaceId, kind: kind as CollabDocKind, id, docName: `${kind}:${id}` };
}

/**
 * Reasons sent when a document connection is refused or closed. Clients act on them:
 * `forbidden` and `not_found` drop the local copy, `reconnect` reconnects (the access
 * level changed), `document_too_large` shows an error and stops saving.
 */
export const COLLAB_REASONS = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  notFound: 'not_found',
  reconnect: 'reconnect',
  tooLarge: 'document_too_large',
  unsupported: 'unsupported_document',
} as const;
export type CollabReason = (typeof COLLAB_REASONS)[keyof typeof COLLAB_REASONS];

/** Presence data each client publishes in awareness (`user` field). */
export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

/** Cursor colors (our palette), picked from the user id so they are stable. */
export const PRESENCE_COLORS = [
  '#e5484d',
  '#f76b15',
  '#e2a336',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#6e56cf',
  '#d6409f',
  '#8e4ec6',
  '#3e63dd',
] as const;

export function presenceColor(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]!;
}
