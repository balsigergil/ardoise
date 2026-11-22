// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page } from '@playwright/test';

export const admin = {
  name: 'Root Admin',
  email: 'root@example.test',
  password: 'root password 1234',
};
export const invitee = { name: 'Nina', email: 'nina@example.test', password: 'nina password 1234' };
export const WORKSPACE = 'Acme';

export async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
}

export async function logout(page: Page) {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}
