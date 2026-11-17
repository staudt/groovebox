// Project sheet: rename and New project (with undo from the toast).
import { expect, test, type Page } from '@playwright/test';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const isHit = async (page: Page, n: number) => (await step(page, n).getAttribute('data-on')) === '1' || (await step(page, n).evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(255, 181, 71)';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
});

test('rename the project from the name in the top bar; it survives reload', async ({ page }) => {
  await page.getByRole('button', { name: /^Project:/ }).click();
  const input = page.getByRole('textbox', { name: 'Project name' });
  await input.fill('Night drive');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Project: Night drive' })).toBeVisible();
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await expect(page.getByRole('button', { name: 'Project: Night drive' })).toBeVisible();
});

test('New project resets edits after confirming, and Undo brings them back', async ({ page }) => {
  // Make a mess: rename, change tempo, add a kick on step 2.
  expect(await isHit(page, 2)).toBe(false);
  await step(page, 2).click();
  await expect.poll(() => isHit(page, 2)).toBe(true);
  await page.getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Mess');
  await page.getByRole('button', { name: 'New project…' }).click();
  // Cancel first: nothing changes.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('button', { name: 'Project: Untitled groove' })).toBeVisible();
  await expect.poll(() => isHit(page, 2)).toBe(false);
  // Undo from the toast.
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => isHit(page, 2)).toBe(true);
  await expect(page.getByRole('button', { name: 'Project: Mess' })).toBeVisible();
});

test('the reset project is what loads after reload', async ({ page }) => {
  await step(page, 2).click();
  await page.getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(step(page, 1)).toBeVisible();
  expect(await isHit(page, 2)).toBe(false);
});
