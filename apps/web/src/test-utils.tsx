// SPDX-License-Identifier: AGPL-3.0-only
import type { MeDto, WorkspaceDto } from '@ardoise/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '@/app';
import { createQueryClient } from '@/lib/query-client';
import { createI18n } from '@/i18n/i18n';
import { createAppRouter } from '@/router';

export interface MockRoute {
  status?: number;
  body?: unknown;
}

export type MockApi = Record<string, MockRoute | ((body: unknown) => MockRoute)>;

/** Replaces `fetch` with a table of `"METHOD /path"` → response. Unknown routes return 404. */
export function mockApi(routes: MockApi) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] =
    [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = `${method} ${path.split('?')[0]}`;
    const route = routes[key];
    const result =
      typeof route === 'function'
        ? route(body)
        : (route ?? { status: 404, body: { error: { code: 'not_found' } } });
    const status = result.status ?? 200;
    return Promise.resolve(
      new Response(
        result.body === undefined || status === 204 ? null : JSON.stringify(result.body),
        { status },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const signedOut: MockApi = {
  'GET /api/auth/session': { status: 401, body: { error: { code: 'unauthenticated' } } },
  'GET /api/setup': { body: { required: false } },
};

export const me: MeDto = {
  id: '0190a000-0000-7000-8000-000000000001',
  email: 'ana@example.test',
  name: 'Ana',
  locale: null,
  theme: 'system',
  isSuperAdmin: false,
};

export const workspace: WorkspaceDto = {
  id: '0190a000-0000-7000-8000-0000000000aa',
  name: 'Acme',
  icon: null,
  role: 'owner',
};

export function signedIn(overrides: Partial<MeDto> = {}): MockApi {
  return {
    'GET /api/auth/session': { body: { user: { ...me, ...overrides }, csrfToken: 'csrf-token' } },
    'GET /api/workspaces': { body: [workspace] },
    [`GET /api/workspaces/${workspace.id}`]: { body: workspace },
    [`GET /api/workspaces/${workspace.id}/teamspaces`]: { body: { items: [], nextCursor: null } },
    'GET /api/instance': {
      body: {
        mailEnabled: true,
        workspaceCreation: 'all_users',
        workspaceInvitationsEnabled: true,
      },
    },
  };
}

export async function renderApp(path: string, language: 'en' | 'fr' = 'en') {
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(queryClient, history);
  await act(async () => {
    render(<App i18n={createI18n(language)} router={router} queryClient={queryClient} />);
    await router.load();
  });
  return { router, queryClient, history };
}
