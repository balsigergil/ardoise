// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pages.path` is an ltree whose labels are page ids written as 32 lowercase hex
 * characters, without hyphens (ADR 0002).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_RE = /^[0-9a-f]{32}$/;

export function uuidToLabel(id: string): string {
  if (!UUID_RE.test(id)) throw new TypeError(`not a UUID: ${id}`);
  return id.replaceAll('-', '').toLowerCase();
}

export function labelToUuid(label: string): string {
  if (!LABEL_RE.test(label)) throw new TypeError(`not an ltree id label: ${label}`);
  return [
    label.slice(0, 8),
    label.slice(8, 12),
    label.slice(12, 16),
    label.slice(16, 20),
    label.slice(20),
  ].join('-');
}

/** Builds an ltree path from ancestor ids, root first. */
export function pathFromIds(ids: readonly string[]): string {
  if (ids.length === 0) throw new RangeError('a path needs at least one id');
  return ids.map(uuidToLabel).join('.');
}

/** Splits an ltree path back into ids, root first. */
export function idsFromPath(path: string): string[] {
  if (path === '') return [];
  return path.split('.').map(labelToUuid);
}
