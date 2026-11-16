// Perform screen: pads from the key, Chords toggle, key sheet, XY pad macros, drum pads, quick FX.
import { expect, test, type Page } from '@playwright/test';

const pads = (page: Page) => page.locator('.perf-pad');
const padLabels = (page: Page) => pads(page).locator('.perf-pad-label').allTextContents();

async function openPerform(page: Page, track: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Step 1', exact: true })).toBeVisible();
  await page.locator('.strip').getByRole('button', { name: new RegExp(`^${track}`) }).click();
  await page.getByRole('button', { name: /^Perform/ }).click();
  await expect(page.getByRole('group', { name: 'XY pad' })).toBeVisible();
}

test('16 pads with chord labels from the key, then note names', async ({ page }) => {
  await openPerform(page, 'KEYS');
  await expect(pads(page)).toHaveCount(16);
  const labels = await padLabels(page);
  expect(labels.slice(0, 8)).toEqual(['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm7']);
  expect(labels.slice(8)).toEqual(['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb', 'C↑']);

  await page.getByRole('button', { name: 'Chords', exact: true }).click();
  const notes = await padLabels(page);
  expect(notes).toHaveLength(16);
  expect(notes.slice(0, 8)).toEqual(['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb', 'C↑']);
});

test('changing the key to D major updates the pad labels', async ({ page }) => {
  await openPerform(page, 'KEYS');
  await page.getByRole('button', { name: /^Key:/ }).click();
  await page.getByRole('group', { name: 'Key' }).getByRole('button', { name: 'D', exact: true }).click();
  await page.getByRole('group', { name: 'Scale' }).getByRole('button', { name: 'major', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Key: D major' })).toBeVisible();
  const labels = await padLabels(page);
  expect(labels.slice(0, 8)).toEqual(['D', 'Em', 'Gbm', 'G', 'A', 'Bm', 'Dbdim', 'Dmaj7']);
});

test('pads light while pressed', async ({ page }) => {
  await openPerform(page, 'KEYS');
  const b = (await pads(page).first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(pads(page).first()).toHaveAttribute('data-lit', '');
  await page.mouse.up();
  await expect(pads(page).first()).not.toHaveAttribute('data-lit', '');
});

test('dragging the XY pad sets Tone (X) and Space (Y)', async ({ page }) => {
  await openPerform(page, 'KEYS');
  const xy = page.getByRole('group', { name: 'XY pad' });
  const b = (await xy.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.25, { steps: 8 });
  await page.mouse.up();
  const tone = Number(await xy.getAttribute('data-tone'));
  const space = Number(await xy.getAttribute('data-space'));
  expect(tone).toBeGreaterThan(70);
  expect(tone).toBeLessThan(90);
  expect(space).toBeGreaterThan(65);
  expect(space).toBeLessThan(85);
  // One drag is one undo step.
  await page.keyboard.press('Control+z');
  await expect(xy).toHaveAttribute('data-tone', '50');
});

test('drum tracks get finger-drum pads', async ({ page }) => {
  await openPerform(page, 'KICK');
  await expect(pads(page)).toHaveCount(16);
  expect((await padLabels(page)).slice(0, 3)).toEqual(['KICK', 'SNARE', 'HATS']);
  await expect(page.getByRole('button', { name: 'Chords', exact: true })).toHaveCount(0);
});

test('quick FX hold lights the button', async ({ page }) => {
  await openPerform(page, 'KEYS');
  const b = page.getByRole('button', { name: 'Stutter', exact: true });
  const bb = (await b.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});
