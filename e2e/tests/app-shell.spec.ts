// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test.describe('app shell (M0 acceptance)', () => {
  test.describe('English browser', () => {
    test.use({ locale: 'en-US' });

    test('shows the shell in English', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome to Ardoise' })).toBeVisible();
      for (const section of ['Favorites', 'Teamspaces', 'Shared', 'Private']) {
        await expect(page.getByText(section, { exact: true })).toBeVisible();
      }
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });

    test('switches to French and remembers it', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('language-menu').click();
      await page.getByRole('menuitemradio', { name: 'Français' }).click();
      await expect(page.getByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await page.reload();
      await expect(page.getByText('Corbeille')).toBeVisible();
    });
  });

  test.describe('French browser', () => {
    test.use({ locale: 'fr-FR' });

    test('defaults to French', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Bienvenue dans Ardoise' })).toBeVisible();
      await expect(page.getByText('Espaces d’équipe')).toBeVisible();
    });
  });

  test.describe('themes', () => {
    test.use({ locale: 'en-US' });

    test('follows the system theme by default', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/');
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    });

    test('lets the user force light or dark', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/');
      await page.getByTestId('theme-menu').click();
      await page.getByRole('menuitemradio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.getByTestId('theme-menu').click();
      await page.getByRole('menuitemradio', { name: 'Light' }).click();
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
        background,
      );
    });
  });

  test('unknown routes show the not-found page inside the shell', async ({ page }) => {
    await page.goto('/this/route/does/not/exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to Ardoise' })).toBeVisible();
  });
});
