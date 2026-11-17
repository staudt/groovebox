// Capture and Place flows with Chromium's fake microphone fed from a WAV (synthetic hummed melody).
import { expect, test, type Page } from '@playwright/test';
import { fakeMic, files } from './fakeMic';

const isDesktop = () => test.info().project.name === 'desktop';
const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const recBtn = (page: Page) => page.getByRole('dialog', { name: 'Capture a melody' }).getByRole('button', { name: 'Record' });
const NOTE_RE = /[A-G][b#]?\d/;

async function openCapture(page: Page) {
  if (isDesktop()) await page.getByRole('button', { name: /^Capture/ }).first().click();
  else await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Capture a melody' })).toBeVisible();
}

/** Step labels (main text) of the selected track's grid, first 16 steps. */
const labels = (page: Page) =>
  page.evaluate(() => Array.from({ length: 16 }, (_, i) => document.querySelector(`button[aria-label="Step ${i + 1}"]`)?.textContent ?? ''));

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test.use({ launchOptions: fakeMic(files.melody), permissions: ['microphone'] });

test.describe('record a hummed melody', () => {
  test('Capture -> Place -> fit, harmony, parts, undo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    await openCapture(page);

    // Settings: no count-in, 1 bar.
    await page.getByRole('button', { name: /^Count-in/ }).click(); // 1 -> 2
    await page.getByRole('button', { name: /^Count-in/ }).click(); // 2 -> off
    await expect(page.getByRole('button', { name: 'Count-in: off' })).toBeVisible();
    await page.getByRole('button', { name: /^Length/ }).click(); // 2 -> 4
    await page.getByRole('button', { name: /^Length/ }).click(); // 4 -> 8
    await page.getByRole('button', { name: /^Length/ }).click(); // 8 -> 1
    await expect(page.getByRole('button', { name: 'Length: 1 bar' })).toBeVisible();

    await recBtn(page).click();
    await expect(page.getByTestId('cap-status')).toContainText(/Recording bar 1 of 1/);
    // The live readout shows a note name while the tone plays.
    await expect(page.getByTestId('note-readout')).toHaveText(NOTE_RE, { timeout: 8000 });

    // Place screen appears after the transcription.
    await expect(page.getByRole('dialog', { name: 'Place a melody' })).toBeVisible({ timeout: 90_000 });
    const notes = page.getByTestId('melody-note');
    expect(await notes.count()).toBeGreaterThanOrEqual(3);
    // The final transcription really ran Basic Pitch in the browser (no silent tracker fallback).
    await expect(page.getByTestId('place-sub')).toContainText('transcribed');

    // Auto-fit: A minor hummed -> C minor song key, all notes in key, chip is the cyan state.
    const chip = page.getByTestId('fit-chip');
    await expect(chip).not.toHaveAttribute('data-warn', '');
    await expect(chip).toContainText(/hummed A min → song key C min/);
    const midis = async () => (await notes.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-midi')))));
    const inKey = (m: number) => [0, 2, 3, 5, 7, 8, 10].includes(((m % 12) + 12) % 12);
    expect((await midis()).every(inKey)).toBe(true);

    // One semitone off the song key: warning state; tapping the chip fits again.
    await page.getByRole('button', { name: 'Transpose up' }).click();
    await expect(chip).toHaveAttribute('data-warn', '');
    await expect(page.locator('[data-testid="melody-note"][data-out]').first()).toBeVisible();
    await chip.click();
    await expect(chip).not.toHaveAttribute('data-warn', '');

    // In key mode: shifting by scale steps keeps every note in key.
    await page.getByRole('button', { name: 'Chromatic', exact: true }).click();
    await expect(page.getByRole('button', { name: 'In key', exact: true })).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Transpose up' }).click();
      expect((await midis()).every(inKey)).toBe(true);
    }
    await expect(chip).toContainText('+3 scale steps');
    await page.getByRole('button', { name: 'In key', exact: true }).click(); // back to chromatic
    await chip.click();
    const finalMidis = await midis();

    // Raw trace overlay
    await page.getByRole('button', { name: 'Show capture' }).click();
    await expect(page.getByTestId('raw-trace')).toBeAttached();

    // Harmony: different takes give different chord summaries; parts toggle.
    const a = await page.getByTestId('chords-A').textContent();
    const c = await page.getByTestId('chords-C').textContent();
    expect(a).toBeTruthy();
    expect(c).not.toEqual(a);
    await page.getByRole('button', { name: /^Harmony B/ }).click();
    await expect(page.getByRole('button', { name: /^Harmony B/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Bass$/ }).click();
    await page.getByRole('button', { name: /Pad$/ }).click();

    // Place in A on KEYS: one undo step (desktop checks it).
    await expect(page.getByTestId('chip-track')).toHaveText('Track: KEYS');
    await expect(page.getByRole('button', { name: 'Place in A' })).toBeVisible();
    await page.getByRole('button', { name: 'Place in A' }).click();
    await expect(page.getByRole('dialog', { name: 'Place a melody' })).toHaveCount(0);

    // KEYS pattern A now holds the melody (step labels are note names).
    const keys = (await labels(page)).map((t) => t.match(NOTE_RE)?.[0]).filter(Boolean);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    const names = new Set(finalMidis.map((m) => ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][m % 12]! + (Math.floor(m / 12) - 1)));
    for (const k of keys) expect(names.has(k!)).toBe(true);

    // BASS and PAD got patterns from take B.
    await page.locator('.strip').getByRole('button', { name: /^PAD/ }).click();
    await expect(step(page, 1)).toContainText('chord');
    await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
    const bass = (await labels(page)).filter((t) => NOTE_RE.test(t));
    expect(bass.length).toBeGreaterThanOrEqual(1);
    expect(bass.every((t) => /[A-G][b#]?[12]/.test(t))).toBe(true); // roots in octave 1-2

    if (isDesktop()) {
      // One undo restores KEYS, PAD and BASS together.
      await page.keyboard.press('Control+z');
      await page.locator('.strip').getByRole('button', { name: /^KEYS/ }).click();
      expect((await labels(page)).filter((t) => NOTE_RE.test(t))).toHaveLength(0);
      await page.locator('.strip').getByRole('button', { name: /^BASS/ }).click();
      await expect(step(page, 1)).toContainText('C2');
      await expect(step(page, 6)).toContainText('Eb2');
    }
  });
});

test.describe('microphone problems', () => {
  test('a denied microphone gives a friendly message', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.goto('/');
    await openCapture(page);
    await recBtn(page).click();
    await expect(page.getByRole('alert')).toContainText(/Microphone access is blocked/);
    await expect(recBtn(page)).toBeEnabled();
  });
});

test('R opens Capture on desktop and Escape closes it', async ({ page }) => {
  test.skip(!isDesktop(), 'keyboard shortcut is desktop only');
  await page.goto('/');
  await expect(page.locator('.dsk-row')).toHaveCount(8);
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog', { name: 'Capture a melody' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Capture a melody' })).toHaveCount(0);
});
