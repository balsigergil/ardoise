// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, pageQuery, setCsrfToken, tokenFromHash, type ApiError } from './api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(undefined);
});

describe('api client', () => {
  it('sends JSON and the CSRF token on writes only', async () => {
    setCsrfToken('csrf-1');
    const fetch = mockFetch(200, { ok: true });
    await api.post('/api/x', { a: 1 });
    await api.get('/api/y');
    const [, postInit] = fetch.mock.calls[0]!;
    const [, getInit] = fetch.mock.calls[1]!;
    expect(postInit?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-1',
    });
    expect(postInit?.body).toBe('{"a":1}');
    expect(getInit?.headers).not.toHaveProperty('x-csrf-token');
  });

  it('maps error bodies to ApiError with the stable code', async () => {
    mockFetch(409, { error: { code: 'last_owner' } });
    await expect(api.delete('/api/x')).rejects.toMatchObject({ status: 409, code: 'last_owner' });
    mockFetch(400, {
      error: { code: 'validation_failed', issues: [{ path: 'email', message: 'bad' }] },
    });
    const error = (await api.post('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(error.issues).toEqual([{ path: 'email', message: 'bad' }]);
  });

  it('falls back to generic codes for unexpected responses', async () => {
    mockFetch(502);
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'internal_error' });
    mockFetch(401);
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'unauthenticated' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 0 });
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(api.post('/api/x')).resolves.toBeUndefined();
  });
});

describe('helpers', () => {
  it('builds page queries', () => {
    expect(pageQuery({})).toBe('');
    expect(pageQuery({ cursor: 'abc', limit: 20, q: ' ana ' })).toBe('?cursor=abc&limit=20&q=ana');
  });
  it('reads tokens from the URL fragment', () => {
    expect(tokenFromHash('#token=abcdefghijklmnop_-123')).toBe('abcdefghijklmnop_-123');
    expect(tokenFromHash('#token=short')).toBeUndefined();
    expect(tokenFromHash('')).toBeUndefined();
    expect(tokenFromHash('#token=<script>alert(1)</script>xxxxxxxx')).toBeUndefined();
  });
});
