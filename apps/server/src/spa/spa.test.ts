// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cacheControlFor, isNoIndexRoute, isSpaRoute } from './spa.js';

describe('isSpaRoute', () => {
  it.each([
    ['/', true],
    ['/p/0190f3c4-7a1b-7c3d-8e4f-0123456789ab', true],
    ['/settings/profile', true],
    ['/api', false],
    ['/api/v1/pages', false],
    ['/sync/pull', false],
    ['/collab', false],
    ['/files/abc', false],
    ['/mcp', false],
    ['/healthz', false],
    ['/readyz', false],
    ['/API/v1', false],
    ['/apiary', true],
    ['/assets/index-abc123.js', false],
    ['/favicon.ico', false],
    ['relative', false],
  ])('%s → %s', (path, expected) => {
    expect(isSpaRoute(path)).toBe(expected);
  });
});

describe('cacheControlFor', () => {
  it('caches hashed assets forever', () => {
    expect(cacheControlFor('/assets/index-BxT3kq9a.js')).toBe(
      'public, max-age=31536000, immutable',
    );
  });
  it('revalidates everything else', () => {
    expect(cacheControlFor('/index.html')).toBe('no-cache');
    expect(cacheControlFor('/favicon.svg')).toBe('no-cache');
    expect(cacheControlFor('/assets/logo.svg')).toBe('no-cache');
  });
});

describe('isNoIndexRoute', () => {
  it('marks public link pages only', () => {
    expect(isNoIndexRoute('/share/abc')).toBe(true);
    expect(isNoIndexRoute('/shared')).toBe(false);
    expect(isNoIndexRoute('/w/1/p/2')).toBe(false);
  });
});
