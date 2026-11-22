// SPDX-License-Identifier: AGPL-3.0-only
import { resources, lookup } from '@ardoise/i18n';
import {
  teamspaceDefaultLevels,
  teamspaceRoles,
  teamspaceVisibilities,
  workspaceRoles,
} from '@ardoise/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminTabs } from '@/routes/admin/tabs';
import { workspaceSettingsTabs } from '@/routes/workspace/tabs';
import { me, mockApi, renderApp, signedIn, signedOut, workspace } from '@/test-utils';

const TOKEN = 'tok_0123456789abcdefghijklmnop';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('setup', () => {
  it('creates the administrator with the token from the link fragment', async () => {
    window.location.hash = `#token=${TOKEN}`;
    const api = mockApi({
      ...signedOut,
      'GET /api/setup': { body: { required: true } },
      'POST /api/setup': {
        status: 201,
        body: {
          session: { user: { ...me, isSuperAdmin: true }, csrfToken: 'c' },
          workspaceId: workspace.id,
        },
      },
      ...Object.fromEntries(
        Object.entries(signedIn()).filter(([k]) => k !== 'GET /api/auth/session'),
      ),
    });
    const { router } = await renderApp('/setup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Root');
    await user.type(screen.getByLabelText('Email'), 'root@example.test');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.type(screen.getByLabelText('Workspace name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create account and workspace' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${workspace.id}`));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Root',
      email: 'root@example.test',
      password: 'a long enough password',
      workspaceName: 'Acme',
      token: TOKEN,
      locale: 'en',
    });
  });
});

describe('invitation', () => {
  it('creates an account from the link', async () => {
    window.location.hash = `#token=${TOKEN}`;
    const api = mockApi({
      ...signedOut,
      'POST /api/invitations/preview': {
        body: {
          email: 'nina@example.test',
          workspaceName: 'Acme',
          inviterName: 'Ana',
          role: 'member',
          hasAccount: false,
        },
      },
      'POST /api/invitations/accept': {
        body: { workspaceId: workspace.id, session: { user: me, csrfToken: 'c' } },
      },
      ...Object.fromEntries(
        Object.entries(signedIn()).filter(([k]) => k !== 'GET /api/auth/session'),
      ),
    });
    const { router } = await renderApp('/invite');
    expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeTruthy();
    expect(screen.getByText('Ana invited nina@example.test.')).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Nina');
    await user.type(screen.getByLabelText('Password'), 'nina password 1234');
    await user.type(screen.getByLabelText('Confirm password'), 'nina password 1234');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${workspace.id}`));
    expect(api.calls.find((c) => c.path === '/api/invitations/accept')?.body).toMatchObject({
      token: TOKEN,
      name: 'Nina',
      password: 'nina password 1234',
    });
  });

  it('asks existing accounts to sign in first', async () => {
    window.location.hash = `#token=${TOKEN}`;
    mockApi({
      ...signedOut,
      'POST /api/invitations/preview': {
        body: {
          email: 'bob@example.test',
          workspaceName: 'Acme',
          inviterName: null,
          role: 'member',
          hasAccount: true,
        },
      },
    });
    await renderApp('/invite');
    expect(await screen.findByText(/An account already exists for bob@example.test/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain(
      'redirect=',
    );
  });

  it('explains expired invitations', async () => {
    window.location.hash = `#token=${TOKEN}`;
    mockApi({
      ...signedOut,
      'POST /api/invitations/preview': {
        status: 410,
        body: { error: { code: 'invitation_expired' } },
      },
    });
    await renderApp('/invite', 'fr');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cette invitation a expiré. Demandez-en une nouvelle.',
    );
  });
});

describe('workspace settings', () => {
  it('invites a member and shows the link to copy', async () => {
    const api = mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${workspace.id}/invitations`]: {
        body: { items: [], nextCursor: null },
      },
      [`POST /api/workspaces/${workspace.id}/invitations`]: {
        status: 201,
        body: {
          invitation: {
            id: 'i1',
            email: 'nina@example.test',
            role: 'member',
            workspaceId: workspace.id,
            createdAt: '',
            expiresAt: '',
            inviterName: 'Ana',
          },
          link: 'http://localhost/invite#token=abc',
          emailSent: true,
        },
      },
    });
    await renderApp(`/w/${workspace.id}/settings?tab=invitations`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'nina@example.test');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    const created = await screen.findByTestId('invitation-created');
    expect(within(created).getByText(/Invitation sent to nina@example.test/)).toBeTruthy();
    expect(within(created).getByTestId<HTMLInputElement>('copy-field').value).toBe(
      'http://localhost/invite#token=abc',
    );
    const post = api.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ email: 'nina@example.test', role: 'member', locale: 'en' });
    expect(post?.headers['x-csrf-token']).toBe('csrf-token');
  });

  it('lists members with their roles', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${workspace.id}/members`]: {
        body: {
          items: [
            { userId: me.id, email: me.email, name: 'Ana', role: 'owner', joinedAt: '' },
            { userId: 'u2', email: 'bob@example.test', name: 'Bob', role: 'member', joinedAt: '' },
          ],
          nextCursor: null,
        },
      },
    });
    await renderApp(`/w/${workspace.id}/settings?tab=members`, 'fr');
    const bob = await screen.findByTestId('member-bob@example.test');
    expect(within(bob).getByRole('button', { name: 'Retirer' })).toBeTruthy();
    const ana = screen.getByTestId(`member-${me.email}`);
    expect(within(ana).getByRole('button', { name: 'Quitter' })).toBeTruthy();
  });
});

describe('admin and account', () => {
  it('hides the admin panel from regular users', async () => {
    mockApi(signedIn());
    await renderApp('/admin');
    expect(await screen.findByText('You are not allowed to do this.')).toBeTruthy();
  });

  it('lists users for super-admins', async () => {
    mockApi({
      ...signedIn({ isSuperAdmin: true }),
      'GET /api/admin/users': {
        body: {
          items: [
            {
              id: 'u2',
              email: 'bob@example.test',
              name: 'Bob',
              isSuperAdmin: false,
              disabled: true,
              createdAt: '',
            },
          ],
          nextCursor: null,
        },
      },
    });
    await renderApp('/admin');
    const row = await screen.findByTestId('admin-user-bob@example.test');
    expect(within(row).getByText('Disabled')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Enable' })).toBeTruthy();
  });

  it('lists sessions and marks the current device', async () => {
    mockApi({
      ...signedIn(),
      'GET /api/auth/sessions': {
        body: [
          {
            id: 's1',
            createdAt: '2026-01-01T00:00:00Z',
            lastSeenAt: '2026-01-02T00:00:00Z',
            userAgent: 'Firefox',
            ip: null,
            current: true,
          },
          {
            id: 's2',
            createdAt: '2026-01-01T00:00:00Z',
            lastSeenAt: '2026-01-01T00:00:00Z',
            userAgent: 'Phone',
            ip: '10.0.0.2',
            current: false,
          },
        ],
      },
    });
    await renderApp('/account');
    const rows = await screen.findAllByTestId('session-row');
    expect(within(rows[0]!).getByText('This device')).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('option labels', () => {
  const sets: [string, readonly string[]][] = [
    ['roles.workspace', workspaceRoles],
    ['roles.teamspace', teamspaceRoles],
    ['teamspaces.visibility', teamspaceVisibilities],
    ['teamspaces.visibilityHint', teamspaceVisibilities],
    ['permissions', teamspaceDefaultLevels],
    ['admin.tabs', adminTabs],
    ['workspace.settings.tabs', workspaceSettingsTabs],
    ['admin.settings.workspaceCreationOptions', ['all_users', 'super_admins']],
    ['admin.email.source', ['admin', 'env', 'none']],
  ];
  it('exist for every option in both languages', () => {
    for (const language of ['en', 'fr'] as const)
      for (const [prefix, options] of sets)
        for (const option of options)
          expect(
            lookup(resources[language].common, `${prefix}.${option}`),
            `${language} ${prefix}.${option}`,
          ).toBeTruthy();
  });
});

describe('one-time links', () => {
  it('picks up a token added to the fragment after the page opened', async () => {
    mockApi({ ...signedOut, 'GET /api/setup': { body: { required: true } } });
    await renderApp('/setup');
    expect(await screen.findByText(/setup link printed in the server logs/)).toBeTruthy();
    window.location.hash = `#token=${TOKEN}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByLabelText('Workspace name')).toBeTruthy();
  });
});
