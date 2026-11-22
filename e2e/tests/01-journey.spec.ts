// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { admin, invitee, login, logout, WORKSPACE } from './accounts.js';

/** ROADMAP M1 e2e: setup → invite → accept → login. */
test.describe.serial('setup → invite → accept → login', () => {
  let invitationLink = '';

  test('first-run setup creates the super-admin and the first workspace', async ({ page }) => {
    const setupUrl = process.env.E2E_SETUP_URL;
    test.skip(!setupUrl, 'E2E_SETUP_URL is required against an external stack');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up Ardoise' })).toBeVisible();
    await page.goto(setupUrl!);
    await page.getByLabel('Name', { exact: true }).fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByLabel('Workspace name').fill(WORKSPACE);
    await page.getByRole('button', { name: 'Create account and workspace' }).click();
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
    await expect(page.getByTestId('workspace-switcher')).toContainText(WORKSPACE);
  });

  test('the owner invites a member and gets a link', async ({ page }) => {
    await login(page, admin);
    await page.getByTestId('workspace-settings-link').click();
    await page.getByRole('tab', { name: 'Invitations' }).click();
    await page.getByLabel('Email').fill(invitee.email);
    await page.getByRole('button', { name: 'Invite' }).click();
    const created = page.getByTestId('invitation-created');
    await expect(created).toBeVisible();
    invitationLink = await created.getByTestId('copy-field').inputValue();
    expect(invitationLink).toMatch(/\/invite#token=[\w-]+$/);
    await expect(page.getByRole('cell', { name: invitee.email })).toBeVisible();
    await logout(page);
  });

  test('the invitee accepts and lands in the workspace', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(invitationLink);
    await expect(page.getByRole('heading', { name: `Join ${WORKSPACE}` })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(invitee.name);
    await page.getByLabel('Password', { exact: true }).fill(invitee.password);
    await page.getByLabel('Confirm password').fill(invitee.password);
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
    await expect(page.getByTestId('workspace-switcher')).toContainText(WORKSPACE);
    await logout(page);

    // The link is single use.
    await page.goto(invitationLink);
    await expect(page.getByRole('alert')).toHaveText('This invitation was already used.');
    await context.close();
  });

  test('the new member signs in and appears in the member list', async ({ page }) => {
    await login(page, invitee);
    await expect(page.getByTestId('workspace-switcher')).toContainText(WORKSPACE);
    await page.getByTestId('workspace-settings-link').click();
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(page.getByTestId(`member-${invitee.email}`)).toContainText('Member');
    await expect(page.getByTestId(`member-${admin.email}`)).toContainText('Owner');
  });

  test('wrong passwords are rejected', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(invitee.email);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
  });
});
