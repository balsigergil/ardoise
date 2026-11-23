// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MIME detection from the first bytes. Only formats that are shown inline are
 * recognized (raster images and PDF); everything else is served as a download.
 */
const SIGNATURES: { mime: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/png', test: (b) => hex(b, 0, 8) === '89504e470d0a1a0a' },
  { mime: 'image/jpeg', test: (b) => hex(b, 0, 3) === 'ffd8ff' },
  { mime: 'image/gif', test: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' },
  { mime: 'image/webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  {
    mime: 'image/avif',
    test: (b) => ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12)),
  },
  { mime: 'application/pdf', test: (b) => ascii(b, 0, 5) === '%PDF-' },
];

function hex(b: Uint8Array, from: number, to: number): string {
  return Buffer.from(b.subarray(from, to)).toString('hex');
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return Buffer.from(b.subarray(from, to)).toString('latin1');
}

/** Bytes needed by `sniffMime`. */
export const SNIFF_BYTES = 16;

export function sniffMime(head: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.test(head))?.mime ?? null;
}

export const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/** Types served `inline`; anything else is an attachment. */
export function isInlineMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime) || mime === 'application/pdf';
}

/** A declared MIME type kept for downloads: `type/subtype`, else octet-stream. */
export function cleanMime(declared: string | undefined): string {
  const value = (declared ?? '').toLowerCase().split(';')[0]!.trim();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(value)
    ? value
    : 'application/octet-stream';
}

/** A display name without paths or control characters. */
export function cleanFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return clean || 'file';
}

/** RFC 6266 `Content-Disposition` with an ASCII fallback and a UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
