// SPDX-License-Identifier: AGPL-3.0-only
import { isErrorCode, type ApiErrorBody, type ErrorCode } from '@ardoise/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let csrfToken: string | undefined;

/** Set from the session: sent back on every state-changing request (ARCHITECTURE §13). */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

const SAFE = new Set(['GET', 'HEAD']);

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    const code = body.error?.code;
    if (isErrorCode(code)) return new ApiError(res.status, code, body.error?.issues);
  } catch {
    // not JSON
  }
  return new ApiError(res.status, res.status === 401 ? 'unauthenticated' : 'internal_error');
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!SAFE.has(method) && csrfToken) headers['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'internal_error');
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T = void>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = void>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Query string for paginated lists. */
export function pageQuery(params: { cursor?: string | null; limit?: number; q?: string }): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.q?.trim()) search.set('q', params.q.trim());
  const value = search.toString();
  return value ? `?${value}` : '';
}

/** Reads `token` from a URL fragment such as `#token=…` (one-time links, ADR 0005). */
export function tokenFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token');
  return token && /^[\w-]{16,128}$/.test(token) ? token : undefined;
}
