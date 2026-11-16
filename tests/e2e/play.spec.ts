// UI tests for the Phase 1 Play screen. Runs on both the phone and desktop projects.
import { expect, test, type Page } from '@playwright/test';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const hitCount = (page: Page) => page.locator('button[aria-label^="Step "][aria-pressed="true"]').count();
const hitSteps = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label^="Step "]'))
      .map((el, i) => (el.getAttribute('aria-pressed') === 'true' ? i + 1 : 0))
      .filter(Boolean),
  );
const velBar = (page: Page, n: number) => step(page, n).locator('span > span').last();
const headSteps = (page: Page) => page.locator('button[aria-label^="Step "][data-head]');

async function longPress(page: Page, n: number) {
  const box = (await step(page, n).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
});

test('loads cleanly with 8 tracks, KICK selected', async ({ page }) => {
  const names = ['KICK', 'SNARE', 'HATS', 'BASS', 'KEYS', 'PAD', 'PERC', 'VOX'];
  for (const n of names) await expect(page.getByRole('button', { name: new RegExp(`^${n}`) })).toBeVisible();
  for (const n of ['VOX']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${n}`) })).toHaveAttribute('aria-disabled', 'true');
  }
  for (const n of ['KICK', 'SNARE', 'HATS', 'BASS', 'KEYS', 'PAD', 'PERC']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${n}`) })).toHaveAttribute('aria-disabled', 'false');
  }
  await expect(page.getByRole('button', { name: /^KICK/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('KICK · 16 steps')).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('tap toggles a step; Ctrl+Z restores', async ({ page, isMobile }) => {
  await expect(step(page, 2)).toHaveAttribute('aria-pressed', 'false');
  await step(page, 2).click();
  await expect(step(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await step(page, 2).click();
  await expect(step(page, 2)).toHaveAttribute('aria-pressed', 'false');
  if (!isMobile) {
    await step(page, 2).click();
    await expect(step(page, 2)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+z');
    await expect(step(page, 2)).toHaveAttribute('aria-pressed', 'false');
  }
});

test('selecting SNARE shows the snare pattern', async ({ page }) => {
  await page.getByRole('button', { name: /^SNARE/ }).click();
  await expect(page.getByText('SNARE · 16 steps')).toBeVisible();
  await expect.poll(() => hitSteps(page)).toEqual([5, 13, 16]);
  const full = await velBar(page, 5).evaluate((e) => parseFloat((e as HTMLElement).style.width));
  const soft = await velBar(page, 16).evaluate((e) => parseFloat((e as HTMLElement).style.width));
  expect(soft).toBeLessThan(full);
});

test('long-press opens the velocity/chance editor', async ({ page }) => {
  await expect(step(page, 1)).toHaveAttribute('aria-pressed', 'true');
  const before = await velBar(page, 1).evaluate((e) => parseFloat((e as HTMLElement).style.width));
  await longPress(page, 1);
  const dialog = page.getByRole('dialog', { name: 'Step 1' });
  await expect(dialog).toBeVisible();
  // Releasing a long press must not have toggled the step off.
  await dialog.getByRole('slider', { name: 'Velocity' }).fill('40');
  await expect.poll(() => velBar(page, 1).evaluate((e) => parseFloat((e as HTMLElement).style.width))).toBeLessThan(before);
  await dialog.getByRole('slider', { name: 'Chance' }).fill('50');
  await expect(step(page, 1)).toContainText('50%');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(step(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 1)).toContainText('50%');
});

test('Euclid applies 5 hits to HATS starting at step 1', async ({ page }) => {
  await page.getByRole('button', { name: /^HATS/ }).click();
  await expect(page.getByText('HATS · 16 steps')).toBeVisible();
  await page.getByRole('button', { name: 'Euclid', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Euclid' });
  await dialog.getByRole('button', { name: 'Hits up' }).click(); // default 4 -> 5
  await expect(dialog.getByLabel('Preview')).toHaveText(/^x[x.]{15}$/);
  await expect(dialog.getByLabel('Preview')).toHaveText(/^(?:[^x]*x){5}[^x]*$/);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => hitCount(page)).toBe(5);
  expect((await hitSteps(page))[0]).toBe(1);
});

test('BPM sheet: + raises BPM, swing changes', async ({ page }) => {
  await page.getByRole('button', { name: /BPM$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tempo' });
  await dialog.getByRole('button', { name: 'BPM up' }).click();
  await expect(dialog.getByRole('slider', { name: 'BPM' })).toHaveAttribute('aria-valuenow', '93');
  await dialog.getByRole('slider', { name: 'Swing' }).fill('60');
  await expect(dialog.getByText('60%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: '93 BPM' })).toBeVisible();
});

test('play shows a moving playhead; stop clears it; Space toggles (desktop)', async ({ page, isMobile }) => {
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(headSteps(page)).toHaveCount(1, { timeout: 5000 });
  const a = await headSteps(page).getAttribute('aria-label');
  await expect.poll(async () => headSteps(page).first().getAttribute('aria-label'), { timeout: 3000 }).not.toBe(a);
  await expect(headSteps(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(headSteps(page)).toHaveCount(0);

  if (!isMobile) {
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(headSteps(page)).toHaveCount(1, { timeout: 5000 });
    await page.keyboard.press('Space');
    await expect(headSteps(page)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('macro drag changes Tone', async ({ page }) => {
  const tone = page.getByRole('slider', { name: 'Tone' });
  await expect(tone).toHaveAttribute('aria-valuenow', '50');
  const box = (await tone.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await tone.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
});

test('no horizontal page scroll', async ({ page }) => {
  const ok = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
  expect(ok).toBe(true);
});
