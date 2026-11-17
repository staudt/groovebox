// Patterns longer than 16 steps show page tabs; each page is editable.
import { expect, test, type Page } from '@playwright/test';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });

test('a 2-bar placed melody makes a 32-step pattern with two pages', async ({ page }) => {
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
  // No tabs for a 16-step pattern.
  await expect(page.getByRole('tablist', { name: 'Pattern pages' })).toHaveCount(0);
  // Place a 2-bar melody (test hook; same path as a real capture).
  await page.evaluate(() =>
    (window as unknown as { __groovebox: { place(n: unknown, bars: number): void } }).__groovebox.place(
      [{ start: 0.0, end: 0.6, midi: 57 }, { start: 1.3, end: 1.9, midi: 59 }, { start: 3.0, end: 3.6, midi: 60 }, { start: 4.2, end: 4.8, midi: 62 }],
      2,
    ),
  );
  const dialog = page.getByRole('dialog', { name: 'Place a melody' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Place/ }).first().click();
  await expect(dialog).toHaveCount(0);
  // Play now shows the target track (KEYS by default) with a 32-step pattern.
  await page.locator('.strip').getByRole('button', { name: /^KEYS/ }).click();
  const tabs = page.getByRole('tablist', { name: 'Pattern pages' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(step(page, 1)).toBeVisible();
  await tabs.getByRole('tab', { name: '17–32' }).click();
  await expect(step(page, 17)).toBeVisible();
  await expect(step(page, 1)).toHaveCount(0);
  // Page 2 holds notes from the second bar.
  expect(await page.locator('[aria-label^="Step "]').filter({ hasText: /[A-G]b?\d/ }).count()).toBeGreaterThan(0);
});
