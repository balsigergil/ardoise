// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isSafeMethod, isSameOriginRequest } from './origin.js';

const url = 'https://ardoise.example.org';

describe('isSameOriginRequest', () => {
  it('accepts the public origin', () => {
    expect(isSameOriginRequest({ origin: 'https://ardoise.example.org' }, url)).toBe(true);
  });
  it('rejects other origins, ports, schemes and null', () => {
    for (const origin of [
      'https://evil.test',
      'https://ardoise.example.org:8443',
      'http://ardoise.example.org',
      'null',
      'garbage',
    ])
      expect(isSameOriginRequest({ origin }, url)).toBe(false);
  });
  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    expect(isSameOriginRequest({}, url)).toBe(true);
    expect(isSameOriginRequest({ secFetchSite: 'same-origin' }, url)).toBe(true);
    expect(isSameOriginRequest({ secFetchSite: 'cross-site' }, url)).toBe(false);
    expect(isSameOriginRequest({ secFetchSite: 'same-site' }, url)).toBe(false);
  });
});

describe('isSafeMethod', () => {
  it('treats only GET, HEAD and OPTIONS as safe', () => {
    expect(['GET', 'head', 'OPTIONS'].every(isSafeMethod)).toBe(true);
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].some(isSafeMethod)).toBe(false);
  });
});
