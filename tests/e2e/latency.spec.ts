// Latency calibration with a fake microphone that plays a click track.
import { expect, test, type Page } from '@playwright/test';
import { fakeMic, files } from './fakeMic';

test.use({ launchOptions: fakeMic(files.clicks), permissions: ['microphone'] });

async function openCapture(page: Page) {
  if (test.info().project.name === 'desktop') await page.getByRole('button', { name: /^Capture/ }).first().click();
  else await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Capture a melody' })).toBeVisible();
}

test.describe('latency calibration', () => {
  test('shows a measured round trip and keeps it', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await openCapture(page);
    await page.getByRole('button', { name: 'Calibrate latency' }).click();
    await expect(page.getByRole('dialog', { name: 'Calibrate latency' })).toContainText(/quiet room/i);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByTestId('latency-value')).toHaveText(/^\d+ ms$/, { timeout: 20_000 });
    const stored = await page.evaluate(() => localStorage.getItem('groovebox.latencyMs'));
    expect(Number(stored)).toBeGreaterThan(0);
  });
});

