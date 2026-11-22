// SPDX-License-Identifier: AGPL-3.0-only
import { errorCodes } from '@ardoise/shared';
import { resources } from '@ardoise/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/theme/theme';
import { me, mockApi, renderApp, signedIn, signedOut, workspace } from '@/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('routing and session', () => {
  it('sends signed-out users to the login page', async () => {
    mockApi(signedOut);
    const { router } = await renderApp(`/w/${workspace.id}/settings`);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(router.state.location.search).toEqual({ redirect: `/w/${workspace.id}/settings` });
  });

  it('sends visitors to setup while the instance has no administrator', async () => {
    mockApi({ ...signedOut, 'GET /api/setup': { body: { required: true } } });
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Set up Ardoise' })).toBeTruthy();
    expect(screen.getByText(/setup link printed in the server logs/)).toBeTruthy();
  });

  it('opens the last workspace with its sidebar sections', async () => {
    mockApi(signedIn());
    const { router } = await renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${workspace.id}`));
    expect(await screen.findByRole('heading', { name: 'Welcome to Ardoise' })).toBeTruthy();
    for (const label of ['Favorites', 'Teamspaces', 'Shared', 'Private', 'Trash', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('renders in French', async () => {
    mockApi(signedIn());
    await renderApp('/', 'fr');
    expect(await screen.findByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeTruthy();
    for (const label of [
      'Favoris',
      'Espaces d’équipe',
      'Partagé',
      'Privé',
      'Corbeille',
      'Paramètres',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('offers to create a workspace when the user has none', async () => {
    mockApi({ ...signedIn(), 'GET /api/workspaces': { body: [] } });
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'No workspace yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a workspace' })).toBeTruthy();
  });

  it('shows a localized not-found page for unknown routes', async () => {
    mockApi(signedOut);
    await renderApp('/does/not/exist', 'fr');
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
  });

  it('applies the stored theme to the document', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockApi(signedOut);
    await renderApp('/login');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies the account language after sign-in', async () => {
    mockApi(signedIn({ locale: 'fr' }));
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeTruthy();
  });
});

describe('login', () => {
  it('signs in and follows the redirect', async () => {
    const api = mockApi({
      ...signedOut,
      'POST /api/auth/login': { body: { user: me, csrfToken: 'c' } },
      ...Object.fromEntries(
        Object.entries(signedIn()).filter(([k]) => k !== 'GET /api/auth/session'),
      ),
    });
    const { router } = await renderApp(
      `/login?redirect=${encodeURIComponent(`/w/${workspace.id}/settings`)}`,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${workspace.id}/settings`));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'ana@example.test',
      password: 'correct horse battery',
    });
  });

  it('shows the localized error code', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': { status: 401, body: { error: { code: 'invalid_credentials' } } },
    });
    await renderApp('/login', 'fr');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'ana@example.test');
    await user.type(screen.getByLabelText('Mot de passe'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'E-mail ou mot de passe incorrect.',
    );
  });
});

describe('error messages', () => {
  it('exist in both languages for every API error code', () => {
    for (const language of ['en', 'fr'] as const) {
      const codes = resources[language].common.errors.codes as Record<string, string>;
      expect(Object.keys(codes).sort()).toEqual([...errorCodes].sort());
    }
  });
});
