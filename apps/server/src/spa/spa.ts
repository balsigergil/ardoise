// SPDX-License-Identifier: AGPL-3.0-only
/** Path prefixes owned by the server; everything else may be an SPA route (ARCHITECTURE §2). */
export const serverPrefixes = [
  '/api',
  '/sync',
  '/collab',
  '/files',
  '/mcp',
  '/healthz',
  '/readyz',
] as const;

/**
 * True when a GET request for `path` should receive the SPA's index.html: not a server
 * route and not a static file (paths whose last segment has an extension).
 */
export function isSpaRoute(path: string): boolean {
  if (!path.startsWith('/')) return false;
  const lower = path.toLowerCase();
  if (serverPrefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`)))
    return false;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/** Cache policy: hashed build assets are immutable, everything else is revalidated. */
export function cacheControlFor(path: string): string {
  return /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}
