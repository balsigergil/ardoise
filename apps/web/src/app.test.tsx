// SPDX-License-Identifier: AGPL-3.0-only
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/app';
import { createI18n } from '@/i18n/i18n';
import { createAppRouter } from '@/router';
import { THEME_STORAGE_KEY } from '@/theme/theme';

async function renderAt(path: string, language: 'en' | 'fr') {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await act(async () => {
    render(<App i18n={createI18n(language)} router={router} />);
    await router.load();
  });
}

describe('app shell', () => {
  it('renders the sidebar sections and home page in English', async () => {
    await renderAt('/', 'en');
    expect(await screen.findByRole('heading', { name: 'Welcome to Ardoise' })).toBeTruthy();
    for (const label of ['Favorites', 'Teamspaces', 'Shared', 'Private', 'Trash', 'Settings']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders in French', async () => {
    await renderAt('/', 'fr');
    expect(await screen.findByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeTruthy();
    for (const label of [
      'Favoris',
      'Espaces d’équipe',
      'Partagé',
      'Privé',
      'Corbeille',
      'Paramètres',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('shows a localized not-found page for unknown routes', async () => {
    await renderAt('/does/not/exist', 'fr');
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
  });

  it('applies the stored theme to the document', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderAt('/', 'en');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
