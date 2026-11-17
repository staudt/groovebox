// Desktop shell (>= 1024 px): all-tracks step matrix, sound panel, labeled on-screen keys.
import { expect, test, type Page } from '@playwright/test';


const cell = (page: Page, row: number, n: number) => page.getByRole('button', { name: `Row ${row} step ${n}`, exact: true });
const key = (page: Page, name: string) => page.getByRole('button', { name: `Key ${name}`, exact: true });
const onSteps = (page: Page, row: number) =>
  page.evaluate((r) =>
    Array.from(document.querySelectorAll(`button[aria-label^="Row ${r} step "]`))
      .map((el, i) => (el.getAttribute('aria-pressed') === 'true' ? i + 1 : 0))
      .filter(Boolean), row);

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  test.skip(test.info().project.name !== 'desktop', 'desktop project only');
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(page.locator('.dsk-row')).toHaveCount(8);
});
test.afterEach(() => { expect(errors).toEqual([]); });

const noScroll = (page: Page) =>
  page.evaluate(() => ({
    h: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    bh: document.body.scrollHeight - window.innerHeight,
  }));

test('matrix shows 8 rows with the default patterns; clicking a cell toggles a hit', async ({ page }) => {
  const names = ['KICK', 'SNARE', 'HATS', 'BASS', 'KEYS', 'PAD', 'PERC', 'VOX'];
  for (const [i, n] of names.entries()) await expect(page.locator('.dsk-name').nth(i)).toContainText(n);
  expect(await onSteps(page, 1)).toEqual([1, 7, 9]);
  await cell(page, 1, 2).click();
  expect(await onSteps(page, 1)).toEqual([1, 2, 7, 9]);
  await cell(page, 1, 2).click();
  expect(await onSteps(page, 1)).toEqual([1, 7, 9]);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.dsk-matrix')).toBeVisible();
});

test('melodic cells add and remove the default note; one undo', async ({ page }) => {
  await cell(page, 5, 1).click();
  await expect(cell(page, 5, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^KEYS/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Step 1', exact: true })).toContainText('C3');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 5, 1)).toHaveAttribute('aria-pressed', 'false');
});

test('clicking a track name selects it; the sound panel follows; Shift+Tab goes back', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^KICK/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^BASS/ }).click();
  await expect(page.getByRole('button', { name: /^BASS/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dsk-sound')).toContainText('FM 6-op');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: /^HATS/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^BASS/ })).toHaveAttribute('aria-pressed', 'true');
});

test('section chain falls back to a single loop chip; capture card is active; no assistant panel', async ({ page }) => {
  await expect(page.getByLabel('Section chain')).toContainText('Loop · pattern A');
  await expect(page.locator('.dsk-capture').getByRole('button', { name: /^Capture/ })).toBeEnabled();
  await expect(page.getByText('Up next')).toHaveCount(0);
});

test('on-screen keys are labeled with computer keys and light while held', async ({ page }) => {
  await page.getByRole('button', { name: /^BASS/ }).click();
  await expect(page.getByLabel('Keyboard')).toHaveCount(1);
  await page.getByRole('button', { name: 'Piano', exact: true }).click();
  const labels = await page.locator('.dsk-piano .kbd-white b').allTextContents();
  expect(labels).toEqual(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K']);
  expect(await page.locator('.dsk-piano .kbd-black b').allTextContents()).toEqual(['W', 'E', 'T', 'Y', 'U']);
  await page.keyboard.down('a');
  await expect(key(page, 'C3')).toHaveAttribute('data-lit', '');
  await expect(key(page, 'C3')).toContainText('A');
  await page.keyboard.up('a');
  await expect(key(page, 'C3')).not.toHaveAttribute('data-lit', '');
});

test('playhead outline moves while playing', async ({ page }) => {
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const head = () => page.evaluate(() => Array.from(document.querySelectorAll('.dsk-row:first-child .dsk-cell')).findIndex((e) => e.hasAttribute('data-ph')));
  await expect.poll(head).toBeGreaterThanOrEqual(0);
  const a = await head();
  await expect.poll(head, { timeout: 5000 }).not.toBe(a);
  await page.keyboard.press('Space');
  await expect.poll(head).toBe(-1);
});

test('no scroll at 1280x800', async ({ page }) => {
  expect(await noScroll(page)).toEqual({ h: 0, v: 0, bh: 0 });
  for (const n of ['BASS', 'SNARE']) {
    await page.getByRole('button', { name: new RegExp(`^${n}`) }).click();
    expect(await noScroll(page)).toEqual({ h: 0, v: 0, bh: 0 });
  }
  await page.getByRole('button', { name: /^Perform/ }).click();
  await expect(page.getByRole('group', { name: 'XY pad' })).toBeVisible();
  expect(await noScroll(page)).toEqual({ h: 0, v: 0, bh: 0 });
});

test('1024x700: still no page scroll; matrix and keys reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByRole('button', { name: /^BASS/ }).click();
  expect(await noScroll(page)).toEqual({ h: 0, v: 0, bh: 0 });
  await expect(page.locator('.dsk-matrix')).toBeVisible();
  await expect(page.getByLabel('Keyboard')).toBeVisible();
  await page.setViewportSize({ width: 1023, height: 700 }); // phone shell below the breakpoint
  await expect(page.locator('.app')).toBeVisible();
});
