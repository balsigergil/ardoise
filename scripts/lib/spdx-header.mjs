// SPDX-License-Identifier: AGPL-3.0-only
/** SPDX header rules (ADR 0001). */

export const HEADER_ID = 'SPDX-License-Identifier: AGPL-3.0-only';

const CHECKED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.sql'];
const CHECKED_BASENAMES = ['Dockerfile'];

const IGNORED_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /^packages\/db\/migrations\/meta\//,
  /(^|\/)routeTree\.gen\.ts$/,
  /\.d\.ts$/,
];

/** @param {string} path repository-relative, forward slashes */
export function requiresHeader(path) {
  if (IGNORED_PATTERNS.some((re) => re.test(path))) return false;
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (CHECKED_BASENAMES.includes(base)) return true;
  return CHECKED_EXTENSIONS.some((ext) => base.endsWith(ext));
}

/**
 * The header must appear within the first lines (after an optional shebang).
 * @param {string} content
 */
export function hasHeader(content) {
  const lines = content.split(/\r?\n/, 4);
  if (lines[0]?.startsWith('#!')) lines.shift();
  return lines.slice(0, 2).some((line) => line.includes(HEADER_ID));
}
