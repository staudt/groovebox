import { expect, test } from '@playwright/test';

test('solo isolates the selected track and follows the selection', async ({ page }) => {
  await page.goto('/');
  const solo = page.getByRole('button', { name: 'Solo the selected track' });
  await expect(solo).toHaveAttribute('aria-pressed', 'false');
  await solo.click();
  await expect(solo).toHaveAttribute('aria-pressed', 'true');
  const strip = page.locator('.strip');
  // KICK selected: the other playable tracks read "muted".
  await expect(strip.getByRole('button', { name: /SNARE/ })).toContainText('muted');
  await expect(strip.getByRole('button', { name: /KICK/ })).not.toContainText('muted');
  await strip.getByRole('button', { name: /BASS/ }).click();
  await expect(strip.getByRole('button', { name: /KICK/ })).toContainText('muted');
  await expect(strip.getByRole('button', { name: /BASS/ })).not.toContainText('muted');
  await solo.click();
  await expect(strip.getByRole('button', { name: /KICK/ })).not.toContainText('muted');
});
