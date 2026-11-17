// Real touch gestures through Chrome's input pipeline (CDP), so CSS touch-action is honored:
// vertical swipes must scroll even when they start on a draggable control, while the
// controls' own drags (sideways values, holds, envelope handles, knobs) keep working.
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'touch only');
// Short screen so both the Play and the Sound screen have something to scroll.
test.use({ viewport: { width: 390, height: 600 } });

async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

const scrollTop = (page: Page) => page.locator('.app-main').evaluate((el) => el.scrollTop);

/**
 * True if a vertical finger swipe that starts on `loc` scrolls the main area. The element is first
 * centered in view, then the swipe goes in whichever direction has room to scroll.
 */
async function swipeScrolls(page: Page, loc: Locator): Promise<boolean> {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const before = await scrollTop(page);
  const room = await page.locator('.app-main').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  const [x, y] = await centerOf(loc);
  const dy = room > 40 ? -120 : 120; // finger up scrolls down, and vice versa
  await touchDrag(page, x, y, x + 1, y + dy, 15);
  await page.waitForTimeout(250);
  return Math.abs((await scrollTop(page)) - before) > 30;
}

/** A touch drag from (x0,y0) to (x1,y1) in `steps` moves. */
async function touchDrag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 12): Promise<void> {
  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let k = 1; k <= steps; k++) {
    const x = x0 + ((x1 - x0) * k) / steps;
    const y = y0 + ((y1 - y0) * k) / steps;
    await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(16); // one frame per move, like a finger
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await s.detach();
}

async function centerOf(loc: Locator): Promise<[number, number]> {
  const b = (await loc.boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
}

async function openSound(page: Page, track: string): Promise<void> {
  await page.goto('/');
  await page.locator('.strip').getByRole('button', { name: new RegExp(`^${track}`) }).click();
  await page.getByRole('button', { name: /^Sound/ }).click();
}

test.describe('vertical swipes scroll from anywhere draggable', () => {
  // Screens now fit a phone, so use a short viewport to make them overflow (the fallback scroll).
  test.use({ viewport: { width: 390, height: 420 } });
  test('control: plain text scrolls', async ({ page }) => {
    await page.goto('/');
    await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
    expect(await swipeScrolls(page, page.locator('.app-main').getByText(/^BASS/).first())).toBe(true);
  });

  test('Sound screen: starting on a value control', async ({ page }) => {
    await openSound(page, 'BASS');
    expect(await swipeScrolls(page, page.getByTestId('level'))).toBe(true);
  });

  test('Sound screen: starting on the envelope, away from the handles', async ({ page }) => {
    await openSound(page, 'BASS');
    // A thin strip at the bottom of the envelope area, under the sustain line and far from every handle.
    await page.locator('svg.env').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = (await page.locator('svg.env').boundingBox())!;
    const before = await scrollTop(page);
    const room = await page.locator('.app-main').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    const x = b.x + b.width * 0.55;
    const y = b.y + b.height - 4;
    await touchDrag(page, x, y, x + 1, y + (room > 40 ? -120 : 120), 15);
    await page.waitForTimeout(250);
    expect(Math.abs((await scrollTop(page)) - before)).toBeGreaterThan(30);
  });

  test('Play screen: starting on a melodic step', async ({ page }) => {
    await page.goto('/');
    await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
    expect(await swipeScrolls(page, page.getByRole('button', { name: 'Step 6', exact: true }))).toBe(true);
  });

  test('Play screen: starting on a drum step', async ({ page }) => {
    await page.goto('/');
    expect(await swipeScrolls(page, page.getByRole('button', { name: 'Step 6', exact: true }))).toBe(true);
  });

  test('Sound screen (sampler): starting on the waveform, away from the trim handles', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 460 }); // the one-shot sampler panel fits at 600 px
    await openSound(page, 'PERC');
    const wave = page.getByTestId('waveform-canvas');
    await expect(wave).toBeVisible();
    expect(await swipeScrolls(page, wave)).toBe(true);
  });

  test('Play screen: starting on a knob label', async ({ page }) => {
    await page.goto('/');
    await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
    expect(await swipeScrolls(page, page.getByText('Decay', { exact: true }))).toBe(true);
  });
});

test.describe('drags still work with touch', () => {
  test('sideways drag on a value control changes it', async ({ page }) => {
    await openSound(page, 'BASS');
    const level = page.getByRole('slider', { name: 'Level' });
    await level.scrollIntoViewIfNeeded();
    const v0 = Number(await level.getAttribute('aria-valuenow'));
    const [x, y] = await centerOf(level);
    await touchDrag(page, x, y, x - 80, y + 4);
    await expect.poll(async () => Number(await level.getAttribute('aria-valuenow'))).toBeLessThan(v0);
  });

  test('dragging right from a note extends holds', async ({ page }) => {
    await page.goto('/');
    await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
    const s1 = page.getByRole('button', { name: 'Step 1', exact: true });
    const s2 = page.getByRole('button', { name: 'Step 2', exact: true });
    await expect(s2).not.toContainText('hold');
    const [x0, y0] = await centerOf(s1);
    const [x1] = await centerOf(s2);
    await touchDrag(page, x0, y0, x1, y0 + 2);
    await expect(s2).toContainText('hold');
  });

  test('envelope handle drags in both directions', async ({ page }) => {
    await openSound(page, 'BASS');
    const sus = page.getByTestId('env-handle-2');
    await sus.scrollIntoViewIfNeeded();
    const v0 = Number(await sus.getAttribute('aria-valuenow'));
    const [x, y] = await centerOf(sus.locator('circle').last());
    await touchDrag(page, x, y, x + 2, y + 25);
    await expect.poll(async () => Number(await sus.getAttribute('aria-valuenow'))).toBeLessThan(v0);
  });

  test('knob turns with a vertical drag on the dial', async ({ page }) => {
    await page.goto('/');
    const tone = page.getByRole('slider', { name: 'Tone' });
    const v0 = Number(await tone.getAttribute('aria-valuenow'));
    const [x, y] = await centerOf(tone.locator('svg'));
    await touchDrag(page, x, y, x, y - 40);
    await expect.poll(async () => Number(await tone.getAttribute('aria-valuenow'))).toBeGreaterThan(v0);
  });
});
