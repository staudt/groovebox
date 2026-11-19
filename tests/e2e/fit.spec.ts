// Every screen fits the phone without scrolling, with usable touch targets.
// 360x640 is a Samsung S22 in Chrome with the address bar showing (the tightest common case);
// 360x700 the same phone as an installed app; 390x844 the design frame; 412x915 a large Android.
import { expect, test, type Page } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'phone layouts');

// The assistant is hidden (no proxy, like GitHub Pages), so these are the layouts users see there.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/assist/health', (r) => r.fulfill({ status: 404, body: 'no' }));
});

const SIZES: [number, number][] = [
  [360, 640],
  [360, 700],
  [390, 844],
  [412, 915],
];

type Case = { name: string; track: string; screen: 'Play' | 'Sound' | 'Perform' | 'Song'; setup?: (page: Page) => Promise<void> };

const openKeys = async (page: Page) => {
  // Make sure the keyboard drawer is expanded (it is the part that used to get cut off).
  const toggle = page.getByRole('button', { name: /^Keys/ });
  if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
};

const songWith = (mix: boolean) => async (page: Page) => {
  await page.getByRole('button', { name: 'Create a song from the current loop' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('button', { name: 'Add scene' }).click();
  await page.getByRole('button', { name: 'Add scene' }).click();
  if (mix) await page.getByRole('button', { name: 'Mix view' }).click();
};

const CASES: Case[] = [
  { name: 'Play drum', track: 'KICK', screen: 'Play' },
  { name: 'Play melodic with keyboard', track: 'BASS', screen: 'Play', setup: openKeys },
  { name: 'Play one-shot sampler', track: 'PERC', screen: 'Play' },
  { name: 'Perform melodic', track: 'KEYS', screen: 'Perform' },
  { name: 'Perform drum', track: 'KICK', screen: 'Perform' },
  { name: 'Sound FM with keyboard', track: 'BASS', screen: 'Sound', setup: openKeys },
  { name: 'Sound drum', track: 'KICK', screen: 'Sound' },
  { name: 'Sound sampler', track: 'PERC', screen: 'Sound' },
  { name: 'Song arrangement', track: '', screen: 'Song', setup: songWith(false) },
  { name: 'Song mix', track: '', screen: 'Song', setup: songWith(true) },
];

async function go(page: Page, c: Case): Promise<void> {
  if (c.track) await page.locator('.strip').getByRole('button', { name: new RegExp(`^${c.track}`) }).click();
  await page.locator('nav').getByRole('button', { name: new RegExp(`^${c.screen}$`) }).click();
  if (c.setup) await c.setup(page);
  await page.waitForTimeout(100);
}

const overflow = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('.app-main')!;
    const doc = document.scrollingElement!;
    return { main: main.scrollHeight - main.clientHeight, doc: doc.scrollHeight - window.innerHeight };
  });

/** Smallest height among the given interactive elements that are visible. */
const minHeight = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    let m = Infinity;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) m = Math.min(m, r.height);
    }
    return m;
  }, selector);

for (const [w, h] of SIZES) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    for (const c of CASES) {
      test(`${c.name} fits without scrolling`, async ({ page }) => {
        await page.goto('/');
        await go(page, c);
        const o = await overflow(page);
        expect(o.main, 'main area overflow (px)').toBeLessThanOrEqual(1);
        expect(o.doc, 'page overflow (px)').toBeLessThanOrEqual(1);
        // Touch targets stay usable after shrinking.
        expect(await minHeight(page, '.step, [aria-label^="Step "]'), 'steps').toBeGreaterThanOrEqual(c.screen === 'Play' ? 40 : 0);
        expect(await minHeight(page, '.kbd-pad, .kbd-white'), 'keys').toBeGreaterThanOrEqual(44);
        expect(await minHeight(page, '.sg-cell'), 'lane cells').toBeGreaterThanOrEqual(c.screen === 'Song' ? 14 : 0);
        expect(await minHeight(page, '.mx-ms button, .mx-fader'), 'mixer controls').toBeGreaterThanOrEqual(c.screen === 'Song' ? 36 : 0);
        expect(await minHeight(page, '.perf-pads button'), 'pads').toBeGreaterThanOrEqual(c.screen === 'Perform' ? 44 : 0);
      });
    }
  });
}

// Capture and Place are full-screen overlays on phones; their content must fit too.
const overlayOverflow = (page: Page) =>
  page.evaluate(() => {
    const cap = document.querySelector('.cap')!;
    const doc = document.scrollingElement!;
    return { cap: cap.scrollHeight - cap.clientHeight, doc: doc.scrollHeight - window.innerHeight };
  });

for (const [w, h] of SIZES) {
  test.describe(`${w}x${h} capture`, () => {
    test.use({ viewport: { width: w, height: h } });
    test('Capture fits without scrolling', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Capture', exact: true }).click();
      await page.waitForTimeout(100);
      const o = await overlayOverflow(page);
      expect(o.cap, 'capture overflow (px)').toBeLessThanOrEqual(1);
      expect(o.doc).toBeLessThanOrEqual(1);
      expect(await minHeight(page, '.cap-rec, .cap-icon, .cap-small, .cap-src'), 'touch targets').toBeGreaterThanOrEqual(44);
    });
    test('Place fits without scrolling', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => (window as unknown as { __groovebox: { place(n: unknown, bars: number): void } }).__groovebox.place([
        { start: 0.0, end: 0.6, midi: 57 }, { start: 0.65, end: 1.2, midi: 60 }, { start: 1.3, end: 1.9, midi: 59 }, { start: 2.0, end: 2.5, midi: 52 },
      ], 2));
      await expect(page.getByRole('dialog', { name: 'Place a melody' })).toBeVisible();
      await page.waitForTimeout(100);
      const o = await overlayOverflow(page);
      expect(o.cap, 'place overflow (px)').toBeLessThanOrEqual(1);
      expect(o.doc).toBeLessThanOrEqual(1);
      expect(await minHeight(page, '.pl-actions button, .pl-fitchip, .pl-mode, .cap-icon'), 'touch targets').toBeGreaterThanOrEqual(44);
      // The Harmony card and both action buttons are fully on screen.
      const box = await page.getByRole('button', { name: /^Place in/ }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(h);
    });
  });
}

// With the assistant on (local dev server with a key), the Ask bar and Describe card must still fit.
for (const [w, h] of [[360, 640], [390, 844]] as [number, number][]) {
  test.describe(`assistant on, ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    for (const c of CASES.filter((x) => ['Play melodic with keyboard', 'Play drum', 'Sound FM with keyboard'].includes(x.name))) {
      test(`${c.name} fits with the assistant on`, async ({ page }) => {
        await page.route('**/api/assist/health', (r) => r.fulfill({ json: { ok: true, model: 'claude-haiku-5-5' } }));
        await page.goto('/');
        await go(page, c);
        const shortWithKeys = h <= 700 && c.name === 'Play melodic with keyboard';
        if (shortWithKeys) {
          // No room on short phones with the keyboard open: the Ask bar steps aside until it is collapsed.
          await expect(page.locator('[data-ask-input]')).toBeHidden();
        } else {
          await expect(page.locator('[data-ask-input]').or(page.getByRole('textbox', { name: /Describe a sound/i })).first()).toBeVisible();
        }
        const o = await overflow(page);
        expect(o.main, 'main area overflow (px)').toBeLessThanOrEqual(1);
        expect(o.doc, 'page overflow (px)').toBeLessThanOrEqual(1);
        if (shortWithKeys) {
          await page.getByRole('button', { name: /^Keys/ }).click(); // collapse the keyboard
          await expect(page.locator('[data-ask-input]')).toBeVisible();
          expect((await overflow(page)).main).toBeLessThanOrEqual(1);
        }
      });
    }
    test('the no-key hint fits too', async ({ page }) => {
      await page.route('**/api/assist/health', (r) => r.fulfill({ json: { ok: false, reason: 'no-key' } }));
      await page.goto('/');
      await go(page, CASES.find((x) => x.name === 'Play melodic with keyboard')!);
      const o = await overflow(page);
      expect(o.main).toBeLessThanOrEqual(1);
    });
  });
}
