// SPDX-License-Identifier: AGPL-3.0-only
/** Minimal browser-like client for integration tests: cookie jar + CSRF header. */
import { newId, type MutationResult, type PushResponse, type SessionDto } from '@ardoise/shared';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export class TestClient {
  private cookies = new Map<string, string>();
  csrfToken: string | undefined;

  constructor(
    readonly baseUrl: string,
    private readonly origin?: string,
  ) {}

  /** The same session, against another node. */
  on(baseUrl: string): TestClient {
    const copy = new TestClient(baseUrl, this.origin);
    copy.cookies = this.cookies;
    copy.csrfToken = this.csrfToken;
    return copy;
  }

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get cookieNames(): string[] {
    return [...this.cookies.keys()];
  }

  private storeCookies(headers: Headers) {
    for (const line of headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (/Max-Age=0/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.cookies.size > 0 && {
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        }),
        ...(this.csrfToken && { 'x-csrf-token': this.csrfToken }),
        ...(this.origin && { origin: this.origin }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.storeCookies(res.headers);
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as T);
    const session = (parsed as { csrfToken?: string; session?: SessionDto } | undefined) ?? {};
    if (typeof session.csrfToken === 'string') this.csrfToken = session.csrfToken;
    if (session.session?.csrfToken) this.csrfToken = session.session.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** Pushes one mutation through `/sync/mutations` and returns its result. */
  async mutate(
    workspaceId: string,
    name: string,
    args: unknown,
    id = newId(),
  ): Promise<MutationResult> {
    const res = await this.post<PushResponse>('/sync/mutations', {
      mutations: [{ id, workspaceId, name, args, clientTime: new Date().toISOString() }],
    });
    if (res.status !== 200)
      throw new Error(`push failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.results[0]!;
  }
}
