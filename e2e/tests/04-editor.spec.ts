// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Browser, type Page } from '@playwright/test';
import { admin, invitee, login } from './accounts.js';

/**
 * ROADMAP M3 e2e: two browsers co-edit a page; cursors visible; no lost text. Plus
 * Markdown shortcuts and the slash menu, page lock, and search.
 */
test.describe.serial('editor: real-time collaboration', () => {
  const editor = (page: Page) => page.getByTestId('page-editor');
  let pageUrl = '';

  async function setTitle(page: Page, title: string) {
    const input = page.getByRole('textbox', { name: 'Page title' });
    await expect(input).toBeEditable();
    await input.fill(title);
    await input.press('Enter');
  }

  async function openAs(browser: Browser, account: { email: string; password: string }) {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await login(page, account);
    return { context, page };
  }

  async function startTyping(page: Page) {
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
    await editor(page).click();
  }

  test('two browsers co-edit a page; cursors are visible; no text is lost', async ({ browser }) => {
    const { context: ownerContext, page: owner } = await openAs(browser, admin);
    await owner.getByRole('button', { name: 'New private page' }).click();
    await setTitle(owner, 'Shared notes');
    pageUrl = owner.url();

    await owner.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = owner.getByTestId('share-dialog');
    await dialog
      .getByRole('searchbox', { name: 'Add people, teamspaces or everyone' })
      .fill('Nina');
    await dialog.getByRole('button', { name: /Nina/ }).click();
    await expect(dialog.getByTestId('share-grant').filter({ hasText: 'Nina' })).toBeVisible();
    await owner.keyboard.press('Escape');

    const { context: memberContext, page: member } = await openAs(browser, invitee);
    await member.goto(pageUrl);

    // The owner writes; the member sees it live.
    await startTyping(owner);
    await owner.keyboard.type('Hello from the owner');
    await expect(editor(member)).toContainText('Hello from the owner', { timeout: 15_000 });

    // The member adds a line; the owner sees it, with the member's cursor and name.
    await startTyping(member);
    await member.keyboard.press('ControlOrMeta+End');
    await member.keyboard.press('Enter');
    await member.keyboard.type('Hi from Nina');
    await expect(editor(owner)).toContainText('Hi from Nina', { timeout: 15_000 });
    await expect(owner.locator('.collaboration-carets__label', { hasText: 'Nina' })).toBeVisible();
    await expect(owner.getByTestId('presence')).toBeVisible();

    // Both type at the same time in the same paragraph: nothing is lost.
    await owner.keyboard.press('ControlOrMeta+End');
    await owner.keyboard.press('Enter');
    const paragraphs = (page: Page) => editor(page).locator('[data-type="paragraph"]').count();
    // Both sides see the owner's new, empty last line before typing into it.
    await expect
      .poll(async () => (await paragraphs(member)) === (await paragraphs(owner)), {
        timeout: 15_000,
      })
      .toBe(true);
    await member.keyboard.press('ControlOrMeta+End');
    const ownerWords = 'alpha beta gamma delta ';
    const memberWords = 'one two three four ';
    await Promise.all([
      owner.keyboard.type(ownerWords, { delay: 15 }),
      member.keyboard.type(memberWords, { delay: 15 }),
    ]);
    // Document text only: collaborators' carets (and their name labels) are left out.
    const text = (page: Page) =>
      editor(page).evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.collaboration-carets__caret').forEach((c) => c.remove());
        return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
    await expect
      .poll(async () => (await text(owner)) === (await text(member)), { timeout: 15_000 })
      .toBe(true);
    const merged = await text(owner);
    // Concurrent typing at the same spot may interleave, but every character survives.
    const letters = (value: string) => [...value.replace(/\s+/g, '')].sort().join('');
    const typed = letters(ownerWords + memberWords);
    const before = 'Hello from the ownerHi from Nina';
    expect(merged.startsWith(before)).toBe(true);
    expect(letters(merged.slice(before.length))).toBe(typed);

    // The content is stored: a reload shows it.
    await owner.waitForTimeout(3_000);
    await member.reload();
    await expect(editor(member)).toContainText('Hello from the owner', { timeout: 15_000 });
    await expect(editor(member)).toContainText('Hi from Nina');

    await memberContext.close();
    await ownerContext.close();
  });

  test('Markdown shortcuts and the slash menu create blocks', async ({ page }) => {
    await login(page, admin);
    await page.goto(pageUrl);
    await startTyping(page);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Plan');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/todo');
    await expect(page.getByRole('listbox', { name: 'Insert a block' })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ship M3');
    const body = editor(page);
    await expect(body.locator('[data-type="heading"][data-level="1"]')).toHaveText('Plan');
    await expect(body.locator('[data-type="bulletedItem"]')).toHaveCount(2);
    await expect(body.locator('[data-type="todo"]')).toHaveText('Ship M3');
    await body.locator('.ardoise-todo-box').click();
    await expect(body.locator('[data-type="todo"]')).toHaveAttribute('data-checked', 'true');
  });

  test('a locked page is read-only for collaborators', async ({ browser }) => {
    const { context: ownerContext, page: owner } = await openAs(browser, admin);
    const { context: memberContext, page: member } = await openAs(browser, invitee);
    await owner.goto(pageUrl);
    await member.goto(pageUrl);
    await expect(editor(member)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
    await owner.getByRole('button', { name: 'Page options' }).click();
    await owner.getByRole('menuitem', { name: 'Lock page' }).click();
    await expect(editor(member)).toHaveAttribute('contenteditable', 'false', { timeout: 15_000 });
    await expect(member.getByText('This page is locked', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Page options' }).click();
    await owner.getByRole('menuitem', { name: 'Unlock page' }).click();
    await expect(editor(member)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
    await memberContext.close();
    await ownerContext.close();
  });

  test('quick find and full-text search find the page', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, admin);
    await expect(page.getByTestId('search-button')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByLabel('Search pages…').fill('shared no');
    await page.getByRole('option', { name: /Shared notes/ }).click();
    await expect(page).toHaveURL(pageUrl);

    await page.goto(`${new URL(pageUrl).pathname.split('/p/')[0]}/search?q=gamma`);
    // Content is indexed a few seconds after it is stored: retry with reloads.
    const hit = page.getByTestId('search-results').getByText('Shared notes');
    await expect(async () => {
      await page.reload();
      await expect(hit).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(
      page.getByTestId('search-results').locator('mark', { hasText: 'gamma' }),
    ).toBeVisible();
  });
});
