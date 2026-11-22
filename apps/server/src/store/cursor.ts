// SPDX-License-Identifier: AGPL-3.0-only
/** Opaque keyset cursors: base64url JSON of the last row's sort keys. */
export function encodeCursor(keys: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(keys), 'utf8').toString('base64url');
}

/** Returns undefined for a missing or malformed cursor (treated as the first page). */
export function decodeCursor(cursor: string | undefined, arity: number): string[] | undefined {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === arity && value.every((v) => typeof v === 'string'))
      return value;
  } catch {
    // fall through
  }
  return undefined;
}

/** Splits `limit + 1` fetched rows into a page and the next cursor. */
export function toPage<T>(rows: T[], limit: number, keys: (row: T) => string[]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(keys(last)) : null,
  };
}

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
