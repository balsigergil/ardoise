// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';
import { admin, login } from './accounts.js';

/** Picks the UI language in the account settings (the app shell has no top bar). */
async function pickLanguage(page: Page, current: 'Language' | 'Langue', name: string) {
  await page.goto('/account');
  await page.getByRole('combobox', { name: current }).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH',
  );
  await page.getByRole('option', { name }).click();
  await saved;
  await page.goto('/');
}

test.describe('app shell', () => {
  test('shows the sidebar sections in English', async ({ page }) => {
    await login(page, admin);
    await expect(page.getByRole('heading', { name: 'Welcome to Ardoise' })).toBeVisible();
    for (const section of ['Favorites', 'Teamspaces', 'Shared', 'Private']) {
      await expect(page.getByText(section, { exact: true })).toBeVisible();
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test.describe('signed out', () => {
    test('switches to French and remembers it', async ({ page }) => {
      await page.goto('/login');
      await page.getByTestId('language-menu').click();
      await page.getByRole('menuitemradio', { name: 'Français' }).click();
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    });

    test.describe('French browser', () => {
      test.use({ locale: 'fr-FR' });
      test('defaults to French', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
      });
    });

    test('follows the system theme by default', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/login');
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    });

    test('lets the user force light or dark', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/login');
      await page.getByTestId('theme-menu').click();
      await page.getByRole('menuitemradio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.getByTestId('theme-menu').click();
      await page.getByRole('menuitemradio', { name: 'Light' }).click();
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    });
  });

  test('the account language follows the user to a new browser', async ({ browser }) => {
    const first = await browser.newContext({ locale: 'en-US' });
    const page = await first.newPage();
    await login(page, admin);
    await pickLanguage(page, 'Language', 'Français');
    await expect(page.getByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeVisible();
    await first.close();

    const second = await browser.newContext({ locale: 'en-US' });
    const other = await second.newPage();
    await login(other, admin);
    await expect(other.getByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeVisible();
    // Restore English for the following tests.
    await pickLanguage(other, 'Langue', 'English');
    await expect(other.getByRole('heading', { name: 'Welcome to Ardoise' })).toBeVisible();
    await second.close();
  });

  test('unknown routes show the not-found page', async ({ page }) => {
    await page.goto('/this/route/does/not/exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
