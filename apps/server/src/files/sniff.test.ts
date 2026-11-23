// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanMime, contentDisposition, isInlineMime, sniffMime } from './sniff.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

describe('sniffMime', () => {
  it('recognizes raster images and PDF from their signatures', () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(text('GIF89a...'))).toBe('image/gif');
    expect(sniffMime(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(text('\0\0\0\x1cftypavif'))).toBe('image/avif');
    expect(sniffMime(text('%PDF-1.7'))).toBe('application/pdf');
  });

  it('does not trust SVG, HTML or unknown content', () => {
    expect(sniffMime(text('<svg xmlns='))).toBeNull();
    expect(sniffMime(text('<!doctype html>'))).toBeNull();
    expect(sniffMime(bytes())).toBeNull();
  });
});

describe('helpers', () => {
  it('serves only images and PDF inline', () => {
    expect(isInlineMime('image/png')).toBe(true);
    expect(isInlineMime('application/pdf')).toBe(true);
    expect(isInlineMime('image/svg+xml')).toBe(false);
    expect(isInlineMime('text/html')).toBe(false);
  });

  it('cleans MIME types and names', () => {
    expect(cleanMime('Text/Plain; charset=utf-8')).toBe('text/plain');
    expect(cleanMime('nonsense')).toBe('application/octet-stream');
    expect(cleanMime(undefined)).toBe('application/octet-stream');
    expect(cleanFileName('C:\\Users\\x\\report.pdf')).toBe('report.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('a\u0000b\nc')).toBe('abc');
    expect(cleanFileName('')).toBe('file');
  });

  it('builds RFC 6266 dispositions', () => {
    expect(contentDisposition('attachment', 'été "x".pdf')).toBe(
      `attachment; filename="_t_ _x_.pdf"; filename*=UTF-8''%C3%A9t%C3%A9%20%22x%22.pdf`,
    );
  });
});
