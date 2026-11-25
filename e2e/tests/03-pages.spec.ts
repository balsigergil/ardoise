// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';
import { admin, invitee, login } from './accounts.js';

/** ROADMAP M2 e2e: create nested pages, move them, share with another user who sees them live. */
test.describe.serial('pages: create, nest, move, share live', () => {
  const tree = (page: Page) => page.getByTestId('sidebar-tree');
  const row = (page: Page, title: string) =>
    tree(page)
      .getByTestId('tree-row')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });

  async function setTitle(page: Page, title: string) {
    const input = page.getByRole('textbox', { name: 'Page title' });
    await expect(input).toBeEditable();
    await input.fill(title);
    await input.press('Enter');
  }

  async function addSubpage(page: Page, parent: string, title: string) {
    await row(page, parent).hover();
    await row(page, parent)
      .getByRole('button', { name: `Add a subpage to ${parent}` })
      .click();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('');
    await setTitle(page, title);
  }

  test('the owner creates nested pages, moves one by drag and drop, and shares the tree live', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext({ locale: 'en-US' });
    const owner = await ownerContext.newPage();
    await login(owner, admin);

    // Create "Project plan" in the private section, then two subpages.
    await owner.getByRole('button', { name: 'New private page' }).click();
    await setTitle(owner, 'Project plan');
    await expect(row(owner, 'Project plan')).toBeVisible();
    const planUrl = owner.url();
    await addSubpage(owner, 'Project plan', 'Milestones');
    await owner.goto(planUrl);
    await addSubpage(owner, 'Project plan', 'Budget');
    await owner.goto(planUrl);

    // Adding a subpage from the sidebar expanded "Project plan": drag "Budget" into "Milestones".
    await expect(row(owner, 'Milestones')).toBeVisible();
    await expect(row(owner, 'Budget')).toBeVisible();
    await row(owner, 'Budget').dragTo(row(owner, 'Milestones'));
    // Dropping inside a page expands it.
    await expect(row(owner, 'Milestones').getByRole('button', { name: 'Collapse' })).toBeVisible();
    await expect(row(owner, 'Budget')).toBeVisible();

    // The member signs in in another browser; nothing is shared yet.
    const memberContext = await browser.newContext({ locale: 'en-US' });
    const member = await memberContext.newPage();
    await login(member, invitee);
    const shared = member.getByTestId('sidebar-section-shared');
    await expect(shared).toBeVisible();
    await expect(tree(member).getByText('Nothing shared with you yet')).toBeVisible();

    // The owner shares "Project plan" with the member.
    await owner.goto(planUrl);
    await owner.getByRole('button', { name: 'Share' }).click();
    const dialog = owner.getByTestId('share-dialog');
    await dialog
      .getByRole('searchbox', { name: 'Add people, teamspaces or everyone' })
      .fill('Nina');
    await dialog.getByRole('button', { name: /Nina/ }).click();
    await expect(dialog.getByTestId('share-grant').filter({ hasText: 'Nina' })).toBeVisible();
    await owner.keyboard.press('Escape');

    // The member sees it appear live under Shared, with its subpages.
    await expect(row(member, 'Project plan')).toBeVisible({ timeout: 15_000 });
    await row(member, 'Project plan').getByRole('button', { name: 'Expand' }).click();
    await expect(row(member, 'Milestones')).toBeVisible();
    await row(member, 'Milestones').getByRole('button', { name: 'Expand' }).click();
    await expect(row(member, 'Budget')).toBeVisible();

    // A rename by the owner shows up live for the member.
    await row(owner, 'Milestones').getByRole('link').click();
    await setTitle(owner, 'Milestones 2026');
    await expect(row(member, 'Milestones 2026')).toBeVisible({ timeout: 15_000 });

    // The member can edit (default level) and the owner sees that live too.
    await row(member, 'Budget').getByRole('link').click();
    await setTitle(member, 'Budget v2');
    await expect(row(owner, 'Budget v2')).toBeVisible({ timeout: 15_000 });

    await memberContext.close();
    await ownerContext.close();
  });

  test('trash and restore', async ({ page }) => {
    await login(page, admin);
    const plan = page
      .getByTestId('sidebar-tree')
      .getByRole('link', { name: 'Project plan', exact: true });
    await plan.click();
    await page.getByRole('button', { name: 'Page options' }).click();
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    await expect(page.getByText('This page is in the trash.')).toBeVisible();
    await expect(plan).toHaveCount(0);
    await page.getByTestId('trash-button').click();
    const list = page.getByTestId('trash-list');
    await expect(list.getByText('Project plan')).toBeVisible();
    await list.getByRole('button', { name: 'Restore' }).click();
    await expect(list.getByText('The trash is empty.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(plan).toBeVisible();
  });
});
