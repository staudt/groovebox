// UI tests for the Phase 2 Sound screen (FM editor). Runs on the phone and desktop projects.
import { expect, test, type Page } from '@playwright/test';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await openBass(page);
});
test.afterEach(() => { expect(errors).toEqual([]); });

async function openBass(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Sound' }).click();
  await page.getByRole('button', { name: /^BASS/ }).click();
  await expect(page.getByTestId('alg-diagram')).toBeVisible();
}
const patchName = (page: Page) => page.getByTestId('patch-name');
const ops = (page: Page) => page.locator('[data-testid="alg-diagram"] .alg-op');

test('bottom nav opens Sound; BASS shows 6 operators', async ({ page }) => {
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-current', 'page');
  await expect(ops(page)).toHaveCount(6);
  await expect(patchName(page)).toContainText('Round Bass');
  await expect(page.getByTestId('alg-num')).toHaveText('05 / 32');
});

test('changing the algorithm redraws the diagram', async ({ page }) => {
  const before = await page.getByTestId('alg-diagram').innerHTML();
  await page.getByRole('button', { name: 'Next algorithm' }).click();
  await expect(page.getByTestId('alg-num')).toHaveText('06 / 32');
  await expect(page.getByTestId('alg-diagram')).toHaveAttribute('data-algorithm', '6');
  expect(await page.getByTestId('alg-diagram').innerHTML()).not.toBe(before);
  await expect(ops(page)).toHaveCount(6);
});

test('select an operator and change its level', async ({ page }) => {
  await page.getByRole('button', { name: 'OP3', exact: true }).click();
  await expect(page.getByTestId('op-title')).toHaveText('OP3');
  const level = page.getByTestId('level');
  const v0 = Number(await level.getAttribute('aria-valuenow'));
  await level.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(level).toHaveAttribute('aria-valuenow', String(v0 - 2));
  // The operator nav buttons switch operators without the (small, scaled) diagram.
  await page.getByRole('button', { name: 'Next operator' }).click();
  await expect(page.getByTestId('op-title')).toHaveText('OP4');
  await page.getByRole('button', { name: 'Previous operator' }).click();
  await expect(page.getByTestId('op-title')).toHaveText('OP3');
  await expect(level).toHaveAttribute('aria-valuenow', String(v0 - 2));
  // drag with the pointer
  const box = (await level.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await level.getAttribute('aria-valuenow'))).toBeGreaterThan(v0 - 2);
});

test('dragging an envelope point changes the value', async ({ page }) => {
  const atk = page.getByTestId('env-a');
  const before = await atk.textContent();
  const h = page.getByTestId('env-handle-0');
  const box = (await h.locator('circle').last().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 6 });
  await page.mouse.up();
  await expect(atk).not.toHaveText(before!);
  expect(Number(await atk.textContent())).toBeGreaterThan(Number(before));
});

test('Random renames the patch to "Random"', async ({ page }) => {
  await page.getByRole('button', { name: 'Random', exact: true }).click();
  await expect(patchName(page)).toContainText('Random');
});

test('save a patch, reload, find it in the browser', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Patch name').fill('My Bass');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(patchName(page)).toContainText('My Bass');
  await page.reload();
  await openBass(page);
  await patchName(page).click();
  await expect(page.getByRole('button', { name: 'Load My Bass' })).toBeVisible();
  // clean up so other runs start empty
  await page.getByRole('button', { name: 'Delete My Bass' }).click();
  await expect(page.getByRole('button', { name: 'Load My Bass' })).toHaveCount(0);
});

test('load a factory preset', async ({ page }) => {
  await patchName(page).click();
  await page.getByRole('button', { name: 'Load Bell' }).click();
  await expect(patchName(page)).toContainText('Bell');
  await expect(page.getByTestId('alg-num')).toHaveText('05 / 32');
  await patchName(page).click();
  await page.getByRole('button', { name: 'Load Brass' }).click();
  await expect(page.getByTestId('alg-num')).toHaveText('22 / 32');
});

test('undo with Ctrl+Z', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard shortcut');
  await page.getByRole('button', { name: 'Next algorithm' }).click();
  await expect(page.getByTestId('alg-num')).toHaveText('06 / 32');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('alg-num')).toHaveText('05 / 32');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('alg-num')).toHaveText('06 / 32');
});

test('drum track shows the drum panel', async ({ page }) => {
  await page.getByRole('button', { name: /^KICK/ }).click();
  await expect(page.getByRole('slider', { name: 'Drum tune' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Drum tone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'kick', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
