// SPDX-License-Identifier: AGPL-3.0-only
/** M2 screens: sidebar tree, page view, share dialog, trash, public page. */
import type { PageDto, SharingDto, TeamspaceDto } from '@ardoise/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderApp, signedIn, workspace, type MockApi } from '@/test-utils';

const WS = workspace.id;
const TS = '0190a000-0000-7000-8000-0000000000b1';
const ROOT = '0190a000-0000-7000-8000-0000000000c1';
const CHILD = '0190a000-0000-7000-8000-0000000000c2';

const teamspace: TeamspaceDto = {
  id: TS,
  name: 'Acme',
  icon: null,
  description: '',
  visibility: 'open',
  defaultLevel: 'can_edit',
  myRole: 'owner',
  canManage: true,
  memberCount: 1,
};

function page(id: string, overrides: Partial<PageDto> = {}): PageDto {
  return {
    id,
    kind: 'page',
    parentKind: 'teamspace',
    parentId: TS,
    position: 'a0',
    title: 'Roadmap',
    icon: null,
    cover: null,
    width: 'normal',
    font: 'default',
    isLocked: false,
    restrictInheritance: false,
    isInline: false,
    isTemplate: false,
    moveState: null,
    createdBy: me.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedBy: me.id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedRootId: null,
    hasChildren: false,
    ...overrides,
  };
}

const empty = { seq: 5, items: [], nextCursor: null };

/** A signed-in user with one teamspace holding one page; mutations are applied. */
function workspaceApi(extra: MockApi = {}): MockApi {
  return {
    ...signedIn(),
    [`GET /api/workspaces/${WS}/teamspaces`]: { body: { items: [teamspace], nextCursor: null } },
    [`GET /api/workspaces/${WS}/teamspaces/${TS}`]: { body: teamspace },
    [`GET /api/workspaces/${WS}/teamspaces/${TS}/pages`]: {
      body: { seq: 5, items: [page(ROOT, { hasChildren: true })], nextCursor: null },
    },
    [`GET /api/workspaces/${WS}/pages/${ROOT}/children`]: {
      body: {
        seq: 5,
        items: [page(CHILD, { parentKind: 'page', parentId: ROOT, title: 'Q3 goals' })],
        nextCursor: null,
      },
    },
    [`GET /api/workspaces/${WS}/private/pages`]: { body: empty },
    [`GET /api/workspaces/${WS}/shared/pages`]: { body: empty },
    [`GET /api/workspaces/${WS}/favorites`]: { body: { ...empty, positions: {} } },
    'GET /sync/pull': { body: { entries: [], cursor: 5, hasMore: false } },
    'POST /sync/mutations': (body) => ({
      body: {
        results: (body as { mutations: { id: string }[] }).mutations.map((m, i) => ({
          id: m.id,
          status: 'applied',
          seq: 6 + i,
        })),
      },
    }),
    ...extra,
  };
}

const pushed = (api: ReturnType<typeof mockApi>) =>
  api.calls
    .filter((c) => c.method === 'POST' && c.path === '/sync/mutations')
    .flatMap(
      (c) => (c.body as { mutations: { name: string; args: Record<string, unknown> }[] }).mutations,
    );

describe('sidebar tree', () => {
  it('loads teamspace pages lazily and expands children', async () => {
    mockApi(workspaceApi());
    await renderApp(`/w/${WS}`);
    const tree = await screen.findByTestId('sidebar-tree');
    expect(await within(tree).findByText('Roadmap')).toBeTruthy();
    expect(within(tree).queryByText('Q3 goals')).toBeNull();
    await userEvent.click(within(tree).getAllByRole('button', { name: 'Expand' }).at(-1)!);
    expect(await within(tree).findByText('Q3 goals')).toBeTruthy();
    for (const section of ['favorites', 'teamspaces', 'shared', 'private'])
      expect(screen.getByTestId(`sidebar-section-${section}`)).toBeTruthy();
  });

  it('creates a page in a teamspace through a mutation, optimistically', async () => {
    const api = mockApi(workspaceApi());
    await renderApp(`/w/${WS}`);
    await screen.findByText('Roadmap');
    await userEvent.click(screen.getByRole('button', { name: 'New page in Acme' }));
    await waitFor(() => expect(pushed(api).map((m) => m.name)).toContain('page.create'));
    expect(pushed(api)[0]!.args).toMatchObject({
      parent: { kind: 'teamspace', id: TS },
      title: '',
    });
    expect(await screen.findAllByText('Untitled')).not.toHaveLength(0);
  });

  it('adds a page to favorites from its menu', async () => {
    const api = mockApi(workspaceApi());
    await renderApp(`/w/${WS}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Roadmap' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => expect(pushed(api).map((m) => m.name)).toContain('favorite.add'));
    const favorites = screen.getByTestId('sidebar-section-favorites');
    expect(favorites).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Roadmap').length).toBeGreaterThan(1));
  });
});

describe('page view', () => {
  const detail = (overrides: Partial<PageDto> = {}, level = 'full_access') => ({
    [`GET /api/workspaces/${WS}/pages/${CHILD}`]: {
      body: {
        seq: 5,
        page: page(CHILD, { parentKind: 'page', parentId: ROOT, title: 'Q3 goals', ...overrides }),
        ancestors: [{ id: ROOT, title: 'Roadmap', icon: null, accessible: true }],
        section: { kind: 'teamspace', id: TS, name: 'Acme' },
        level,
        isFavorite: false,
        isFollowing: false,
      },
    },
    [`GET /api/workspaces/${WS}/pages/${CHILD}/children`]: { body: empty },
    [`PUT /api/workspaces/${WS}/recents/${CHILD}`]: { status: 204 },
  });

  it('shows the breadcrumb, records the visit and renames through page.update', async () => {
    const api = mockApi(workspaceApi(detail()));
    await renderApp(`/w/${WS}/p/${CHILD}`);
    const title = await screen.findByRole('textbox', { name: 'Page title' });
    expect(
      within(screen.getByRole('navigation', { name: 'Page location' })).getByText('Roadmap'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === 'PUT' && c.path.endsWith(`/recents/${CHILD}`)),
      ).toBe(true),
    );
    await userEvent.clear(title);
    await userEvent.type(title, 'Q4 goals{Enter}');
    await waitFor(() =>
      expect(pushed(api).find((m) => m.name === 'page.update')?.args).toMatchObject({
        id: CHILD,
        title: 'Q4 goals',
      }),
    );
  });

  it('is read-only for viewers and when locked', async () => {
    mockApi(workspaceApi(detail({}, 'can_view')));
    await renderApp(`/w/${WS}/p/${CHILD}`);
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('offers restore for pages in the trash', async () => {
    const api = mockApi(
      workspaceApi(detail({ deletedAt: '2026-02-01T00:00:00.000Z', deletedRootId: CHILD })),
    );
    await renderApp(`/w/${WS}/p/${CHILD}`);
    expect(await screen.findByText('This page is in the trash.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(pushed(api).map((m) => m.name)).toContain('page.restore'));
  });

  it('explains missing pages and lets workspace owners recover access', async () => {
    const api = mockApi(
      workspaceApi({
        [`GET /api/workspaces/${WS}/pages/${CHILD}`]: {
          status: 404,
          body: { error: { code: 'not_found' } },
        },
      }),
    );
    await renderApp(`/w/${WS}/p/${CHILD}`);
    expect(await screen.findByText('This page is not available')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Recover access' }));
    await waitFor(() => expect(pushed(api).map((m) => m.name)).toContain('permission.recover'));
  });
});

describe('share dialog', () => {
  const sharing: SharingDto = {
    seq: 5,
    pageId: CHILD,
    myLevel: 'full_access',
    restrictInheritance: false,
    restrictedAt: null,
    grants: [
      {
        principal: {
          kind: 'user',
          id: '0190a000-0000-7000-8000-0000000000d1',
          name: 'Bob',
          email: 'bob@x.test',
        },
        level: 'can_comment',
        inheritedFrom: { id: ROOT, title: 'Roadmap' },
      },
    ],
    root: { kind: 'teamspace', id: TS, name: 'Acme', defaultLevel: 'can_edit' },
    mySources: [],
    publicLink: { enabled: true, includeSubpages: false, url: 'https://ardoise.test/share/tok' },
    canRecover: false,
  };

  it('shows who has access and why, and restricts inheritance', async () => {
    const api = mockApi(
      workspaceApi({
        [`GET /api/workspaces/${WS}/pages/${CHILD}`]: {
          body: {
            seq: 5,
            page: page(CHILD, { parentKind: 'page', parentId: ROOT }),
            ancestors: [],
            section: null,
            level: 'full_access',
            isFavorite: false,
            isFollowing: false,
          },
        },
        [`GET /api/workspaces/${WS}/pages/${CHILD}/children`]: { body: empty },
        [`GET /api/workspaces/${WS}/pages/${CHILD}/sharing`]: { body: sharing },
        [`PUT /api/workspaces/${WS}/recents/${CHILD}`]: { status: 204 },
      }),
    );
    await renderApp(`/w/${WS}/p/${CHILD}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByTestId('share-dialog');
    expect(await within(dialog).findByText('Members of Acme')).toBeTruthy();
    expect(within(dialog).getByText('Inherited from Roadmap')).toBeTruthy();
    expect(within(dialog).getByDisplayValue('https://ardoise.test/share/tok')).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole('switch', { name: 'Restrict access to this page' }),
    );
    await waitFor(() =>
      expect(pushed(api).find((m) => m.name === 'permission.setRestrict')?.args).toEqual({
        pageId: CHILD,
        restrict: true,
      }),
    );
  });
});

describe('trash', () => {
  it('lists trashed pages and restores them', async () => {
    const api = mockApi(
      workspaceApi({
        [`GET /api/workspaces/${WS}/trash`]: {
          body: {
            seq: 5,
            items: [
              page(CHILD, {
                title: 'Old notes',
                deletedAt: '2026-02-01T00:00:00.000Z',
                deletedRootId: CHILD,
              }),
            ],
            nextCursor: null,
          },
        },
      }),
    );
    await renderApp(`/w/${WS}`);
    await userEvent.click(await screen.findByTestId('trash-button'));
    const list = await screen.findByTestId('trash-list');
    expect(await within(list).findByText('Old notes')).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(pushed(api).find((m) => m.name === 'page.restore')?.args).toEqual({ id: CHILD }),
    );
  });
});

describe('public page', () => {
  it('renders a shared page without a session and asks not to be indexed', async () => {
    mockApi({
      'GET /api/auth/session': { status: 401, body: { error: { code: 'unauthenticated' } } },
      'GET /api/public/tok123tok123tok123': {
        body: {
          page: {
            id: ROOT,
            title: 'Handbook',
            icon: { type: 'emoji', value: '📘' },
            cover: null,
            width: 'normal',
            font: 'default',
            hasChildren: true,
          },
          rootId: ROOT,
          includeSubpages: true,
          ancestors: [],
        },
      },
      [`GET /api/public/tok123tok123tok123/pages/${ROOT}/children`]: {
        body: {
          items: [{ id: CHILD, title: 'Onboarding', icon: null, cover: null, hasChildren: false }],
          nextCursor: null,
        },
      },
    });
    await renderApp('/share/tok123tok123tok123');
    expect(await screen.findByRole('heading', { name: 'Handbook' })).toBeTruthy();
    expect(await screen.findByText('Onboarding')).toBeTruthy();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain(
      'noindex',
    );
  });

  it('explains revoked links', async () => {
    mockApi({
      'GET /api/public/revokedrevokedrevoked': {
        status: 404,
        body: { error: { code: 'not_found' } },
      },
    });
    await renderApp('/share/revokedrevokedrevoked');
    expect(await screen.findByText('This link is not available')).toBeTruthy();
    await act(() => Promise.resolve());
  });
});
