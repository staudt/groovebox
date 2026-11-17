// UI tests for Phase 2 melodic editing (step grid, keyboard drawer, picker). Phone and desktop projects.
import { expect, test, type Page } from '@playwright/test';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const key = (page: Page, name: string) => page.getByRole('button', { name: `Key ${name}`, exact: true });
const center = async (page: Page, n: number) => {
  const b = (await step(page, n).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function dragSteps(page: Page, from: number, to: number) {
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}
async function longPress(page: Page, n: number) {
  const c = await center(page, n);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}
const select = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) }).click();

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('BASS shows the default bass line with a hold after G1', async ({ page }) => {
  await select(page, 'BASS');
  await expect(page.getByTestId('track-title')).toHaveText(/^BASS/);
  await expect(step(page, 1)).toContainText('C2');
  await expect(step(page, 6)).toContainText('Eb2');
  await expect(step(page, 9)).toContainText('Ab1');
  await expect(step(page, 14)).toContainText('G1');
  await expect(step(page, 15)).toContainText('hold');
  // Phones default to the scale layout; the desktop keyboard is the piano with computer-key labels.
  const isMobile = (page.viewportSize()?.width ?? 0) < 1024;
  await expect(page.getByRole('button', { name: isMobile ? 'Scale' : 'Piano', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('PAD shows Cm chord then holds', async ({ page }) => {
  await select(page, 'PAD');
  await expect(step(page, 1)).toContainText('Cm');
  await expect(step(page, 1)).toContainText('chord');
  await expect(step(page, 2)).toContainText('hold');
  await expect(step(page, 9)).toContainText('Ab');
});

test('drum tracks have no keyboard drawer', async ({ page }) => {
  await expect(page.getByLabel('Keyboard')).toHaveCount(0);
  await select(page, 'BASS');
  await expect(page.getByLabel('Keyboard')).toBeVisible();
});

test('tap a rest adds a note and selects it; tap again removes it', async ({ page }) => {
  await select(page, 'KEYS');
  await expect(step(page, 1)).not.toContainText(/[A-G]/);
  await step(page, 1).click();
  await expect(step(page, 1)).toContainText('C3');
  await expect(step(page, 1)).toHaveAttribute('data-sel', '');
  await step(page, 1).click();
  await expect(step(page, 1)).not.toContainText('C3');
  await expect(step(page, 1)).not.toHaveAttribute('data-sel', '');
});

test('piano key writes into the selected step; octave is remembered per track', async ({ page }) => {
  await select(page, 'KEYS');
  await page.getByRole('button', { name: 'Piano', exact: true }).click();
  await step(page, 3).click();
  await key(page, 'G3').click();
  await expect(step(page, 3)).toContainText('G3');
  await expect(step(page, 3)).toHaveAttribute('data-sel', '');
  await key(page, 'Eb3').click();
  await expect(step(page, 3)).toContainText('Eb3');
  // Octave up changes the notes, and is per track.
  await page.getByRole('button', { name: 'Octave up' }).click();
  await expect(page.getByLabel('Octave', { exact: true })).toHaveText('C4');
  await key(page, 'C4').click();
  await expect(step(page, 3)).toContainText('C4');
  await select(page, 'BASS');
  await expect(page.getByLabel('Octave', { exact: true })).toHaveText('C3');
});

test('scale layout has 8 pads for the minor scale', async ({ page }) => {
  await select(page, 'BASS');
  await page.getByRole('button', { name: 'Scale', exact: true }).click(); // the desktop default is Piano
  await expect(page.locator('.kbd-pad')).toHaveCount(8);
  await expect(key(page, 'Eb3')).toBeVisible();
  await expect(key(page, 'C4')).toBeVisible();
});

test('drag right from a note creates holds; drag back shortens; one undo', async ({ page, isMobile }) => {
  await select(page, 'KEYS');
  await step(page, 1).click();
  await dragSteps(page, 1, 4);
  for (const n of [2, 3, 4]) await expect(step(page, n)).toContainText('hold');
  await expect(step(page, 5)).not.toContainText('hold');
  await dragSteps(page, 1, 2);
  await expect(step(page, 2)).toContainText('hold');
  await expect(step(page, 3)).not.toContainText('hold');
  if (!isMobile) {
    await page.keyboard.press('Control+z');
    await expect(step(page, 4)).toContainText('hold');
    await page.keyboard.press('Control+z');
    await expect(step(page, 2)).not.toContainText('hold');
    await expect(step(page, 1)).toContainText('C3');
  }
});

test('drag works across grid rows', async ({ page }) => {
  await select(page, 'KEYS');
  await step(page, 3).click();
  await dragSteps(page, 3, 6);
  for (const n of [4, 5, 6]) await expect(step(page, n)).toContainText('hold');
  await expect(step(page, 7)).not.toContainText('hold');
});

test('tapping a note removes its holds', async ({ page }) => {
  await select(page, 'PAD');
  await step(page, 1).click();
  await expect(step(page, 1)).not.toContainText('Cm');
  for (const n of [2, 3, 4, 5, 6, 7, 8]) await expect(step(page, n)).not.toContainText('hold');
  await expect(step(page, 9)).toContainText('Ab');
});

test('long-press opens the picker; picking a chord shows it and keeps holds', async ({ page }) => {
  await select(page, 'KEYS');
  await step(page, 5).click();
  await dragSteps(page, 5, 7);
  await longPress(page, 5);
  const dialog = page.getByRole('dialog', { name: 'Step 5' });
  await expect(dialog).toBeVisible();
  await expect(step(page, 5)).toContainText('C3'); // long-press itself changes nothing
  await dialog.getByRole('button', { name: 'Chord', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fm', exact: true }).click();
  await expect(step(page, 5)).toContainText('Fm');
  await expect(step(page, 5)).toContainText('chord');
  await expect(step(page, 6)).toContainText('hold');
  await dialog.getByRole('button', { name: '7ths' }).click();
  await expect(dialog.getByRole('button', { name: 'Fm7', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Note', exact: true }).click();
  await dialog.getByRole('button', { name: 'Chromatic' }).click();
  await dialog.getByRole('button', { name: 'F#3', exact: true }).or(dialog.getByRole('button', { name: 'Gb3', exact: true })).click();
  await expect(step(page, 5)).toContainText('Gb3');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});

test('desktop: musical typing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'computer keyboard');
  await select(page, 'KEYS');
  // No selected step: typing must not change the pattern.
  await page.keyboard.press('a');
  await expect(page.locator('button[aria-label^="Step "][aria-pressed="true"]')).toHaveCount(0);
  // Typing writes to the selected step, octave keys move the octave.
  await step(page, 2).click();
  await page.keyboard.press('d');
  await expect(step(page, 2)).toContainText('E3');
  await page.keyboard.press('x');
  await expect(page.getByLabel('Octave', { exact: true })).toHaveText('C4');
  await page.keyboard.press('w');
  await expect(step(page, 2)).toContainText('Db4');
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await expect(page.getByLabel('Octave', { exact: true })).toHaveText('C2');
  // Tab still switches track, Hold toggles with backtick.
  await page.keyboard.press('Backquote');
  await expect(page.getByRole('button', { name: 'Hold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Backquote');
  await expect(page.getByRole('button', { name: 'Hold', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('track-title')).toHaveText(/^PAD/);
});

test('hold latches keys', async ({ page }) => {
  await select(page, 'KEYS');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await key(page, 'C3').click();
  await expect(key(page, 'C3')).toHaveAttribute('data-lit', '');
  await key(page, 'C3').click();
  await expect(key(page, 'C3')).not.toHaveAttribute('data-lit', '');
  await key(page, 'D3').click();
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(key(page, 'D3')).not.toHaveAttribute('data-lit', '');
});
