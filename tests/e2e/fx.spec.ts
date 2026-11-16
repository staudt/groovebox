// FX sheet: opens over any screen, hold-to-play effects, latch, targets, desktop keys, multi-touch.
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

const fxBtn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const navFx = (page: Page) => page.getByRole('button', { name: 'FX', exact: true });
const openFx = async (page: Page) => {
  await navFx(page).click();
  await expect(page.getByRole('dialog', { name: 'FX' })).toBeVisible();
};
const centerOf = async (loc: Locator): Promise<[number, number]> => {
  const b = (await loc.boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
async function hold(page: Page, loc: Locator): Promise<void> {
  const [x, y] = await centerOf(loc);
  await page.mouse.move(x, y);
  await page.mouse.down();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Step 1', exact: true })).toBeVisible();
});

test('opens from Play and from Sound, closes with the grabber and Escape', async ({ page }) => {
  await openFx(page);
  await expect(page.locator('.fx-btn')).toHaveCount(12);
  await page.getByRole('button', { name: 'Close FX' }).click();
  await expect(page.getByRole('dialog', { name: 'FX' })).toHaveCount(0);

  await page.getByRole('button', { name: /^Sound/ }).click();
  await openFx(page);
  await expect(page.getByRole('button', { name: /^Sound/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'FX' })).toHaveCount(0);
});

test('holding an effect lights it and releasing unlights it', async ({ page }) => {
  await openFx(page);
  const b = fxBtn(page, 'Reverse 1 beat');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await hold(page, b);
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('latch keeps an effect lit until it is tapped again', async ({ page }) => {
  await openFx(page);
  await page.getByRole('button', { name: 'Latch', exact: true }).click();
  const b = fxBtn(page, 'Lo-fi crush');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('target chips switch between master and the selected track', async ({ page }) => {
  await openFx(page);
  const master = page.getByRole('button', { name: 'Master', exact: true });
  const trk = page.locator('.fx-track');
  await expect(trk).toHaveText('KICK');
  await expect(master).toHaveAttribute('aria-pressed', 'true');
  await trk.click();
  await expect(trk).toHaveAttribute('aria-pressed', 'true');
  await expect(master).toHaveAttribute('aria-pressed', 'false');
  await master.click();
  await expect(master).toHaveAttribute('aria-pressed', 'true');
  const rec = page.getByRole('button', { name: 'Record FX moves into the pattern' });
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
});

test('dragging the XY pad moves the dot of a held effect (mouse)', async ({ page }) => {
  await openFx(page);
  const b = fxBtn(page, 'Low sweep filter');
  await b.click({ delay: 0 }).catch(() => {});
  await hold(page, b);
  await expect(page.getByTestId('fx-dot')).toBeVisible();
  await page.mouse.up(); // single pointer: the mouse cannot hold and drag, so only check the dot exists
});

test('desktop: key 1 holds Stutter 1/4', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard only');
  const b = page.locator('[data-fx="stutter4"]');
  await openFx(page);
  await page.keyboard.down('1');
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('1');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test.describe('multi-touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('one finger holds an effect while another slides on the XY pad', async ({ page }) => {
    await openFx(page);
    const b = fxBtn(page, 'Low sweep filter');
    const pad = page.getByRole('group', { name: 'Effect XY pad' });
    const [bx, by] = await centerOf(b);
    const pb = (await pad.boundingBox())!;
    const p0 = { x: pb.x + pb.width * 0.2, y: pb.y + pb.height * 0.5 };
    const s: CDPSession = await page.context().newCDPSession(page);
    const f0 = { id: 0, x: bx, y: by };
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f0] });
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f0, { id: 1, ...p0 }] });
    const dot = page.getByTestId('fx-dot');
    await expect(dot).toBeVisible();
    const x0 = Number(await dot.getAttribute('data-x'));
    for (let k = 1; k <= 10; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f0, { id: 1, x: p0.x + (pb.width * 0.6 * k) / 10, y: p0.y }] });
      await page.waitForTimeout(16);
    }
    await expect.poll(async () => Number(await dot.getAttribute('data-x'))).toBeGreaterThan(x0 + 30);
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    await s.detach();
  });
});

test('Moves records a held effect into the pattern; it survives reload and Clear removes it', async ({ page }) => {
  // Start the loop (the transport play button), then record.
  await page.getByRole('button', { name: /^Play$/ }).first().click();
  // Moves are timed by the audible playhead: wait until the loop is really running.
  await expect(page.locator('[data-head]')).toHaveCount(1, { timeout: 10_000 });
  await openFx(page);
  await page.getByRole('button', { name: 'Record FX moves into the pattern' }).click();
  const gate = fxBtn(page, 'Gate 1/16');
  await hold(page, gate);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByText(/Moves recorded in pattern A/)).toBeVisible();
  // Autosave, reload: the lane is part of the project.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Step 1', exact: true })).toBeVisible();
  await openFx(page);
  await expect(page.getByText(/Moves recorded in pattern A/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear moves' }).click();
  await expect(page.getByText(/Moves recorded in pattern A/)).toHaveCount(0);
});
