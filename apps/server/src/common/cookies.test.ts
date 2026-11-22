// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from './cookies.js';

describe('parseCookies', () => {
  it('parses pairs, decodes values and keeps the first occurrence', () => {
    expect(parseCookies('a=1; b=hello%20world; a=2; c="q"')).toEqual({
      a: '1',
      b: 'hello world',
      c: 'q',
    });
  });
  it('ignores malformed input', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('novalue; =x; d=%E0%A4%A')).toEqual({});
  });
});

describe('serializeCookie', () => {
  it('sets secure defaults', () => {
    expect(serializeCookie('s', 'v', { secure: true, maxAgeSeconds: 60 })).toBe(
      's=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure',
    );
  });
  it('omits Secure on plain http and clears with Max-Age=0', () => {
    expect(serializeCookie('s', '', { secure: false, maxAgeSeconds: 0 })).toBe(
      's=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    );
  });
});
