// Multiple projects, version history and audio export (phone and desktop).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { defaultProject } from '../../src/store/defaults';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const isHit = async (page: Page, n: number) => (await step(page, n).getAttribute('data-on')) === '1' || (await step(page, n).evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(255, 181, 71)';
const openSheet = (page: Page) => page.getByRole('button', { name: /^Project:/ }).click();

async function rename(page: Page, name: string) {
  const input = page.getByRole('textbox', { name: 'Project name' });
  await input.fill(name);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
});

test('two projects keep their own names and edits; delete one', async ({ page }) => {
  await step(page, 2).click();
  await expect.poll(() => isHit(page, 2)).toBe(true);
  await openSheet(page);
  await rename(page, 'First');
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Project: Untitled groove' })).toBeVisible();
  expect(await isHit(page, 2)).toBe(false);
  await step(page, 3).click();
  await openSheet(page);
  await rename(page, 'Second');
  await expect(page.getByRole('button', { name: /Projects \(2\)/ })).toBeVisible();
  // Switch back to First.
  await page.getByRole('button', { name: 'Open First' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Project: First' })).toBeVisible();
  await expect.poll(() => isHit(page, 2)).toBe(true);
  expect(await isHit(page, 3)).toBe(false);
  // And forth again; the edit of Second persisted.
  await openSheet(page);
  await page.getByRole('button', { name: 'Open Second' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => isHit(page, 3)).toBe(true);
  expect(await isHit(page, 2)).toBe(false);
  // Survives a reload (the open project is Second).
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Project: Second' })).toBeVisible();
  // Duplicate, then delete the copy and First.
  await openSheet(page);
  await page.getByRole('button', { name: 'Duplicate Second' }).click();
  await expect(page.getByRole('button', { name: /Projects \(3\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Second copy' }).click();
  await page.getByRole('alertdialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /Projects \(2\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete First' }).click();
  await page.getByRole('alertdialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /Projects \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open First' })).toHaveCount(0);
});

function parseWav(buf: Buffer) {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  const ch = buf.readUInt16LE(22);
  const sr = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  expect(buf.length).toBe(44 + dataBytes);
  let peak = 0;
  for (let o = 44; o < buf.length; o += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(o)));
  return { ch, sr, bits, seconds: dataBytes / (ch * 2) / sr, peak: peak / 32768 };
}

test('Export WAV (loop, 1 bar) downloads a valid, non-silent WAV of 1 bar + 2 s tail', async ({ page }) => {
  test.setTimeout(120_000);
  const bpm = defaultProject().bpm;
  await openSheet(page);
  await page.getByRole('button', { name: /^▸ Export|^▾ Export/ }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  const dl = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export WAV' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('Untitled_groove.wav');
  const w = parseWav(readFileSync((await d.path())!));
  expect(w.ch).toBe(2);
  expect(w.bits).toBe(16);
  expect([44100, 48000]).toContain(w.sr);
  expect(w.seconds).toBeCloseTo((60 / bpm) * 4 + 2, 2);
  expect(w.peak).toBeGreaterThan(0.05);
});

test('Export stems downloads a zip with one WAV per active track', async ({ page }) => {
  test.setTimeout(180_000);
  await openSheet(page);
  await page.getByRole('button', { name: /^▸ Export|^▾ Export/ }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  const dl = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Export stems' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('Untitled_groove-stems.zip');
  const z = readFileSync((await d.path())!);
  const eocd = z.length - 22;
  expect(z.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = z.readUInt16LE(eocd + 10);
  let o = z.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = z.readUInt16LE(o + 28);
    const name = z.toString('utf8', o + 46, o + 46 + len);
    names.push(name);
    const local = z.readUInt32LE(o + 42);
    const size = z.readUInt32LE(o + 24);
    const start = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
    expect(parseWav(z.subarray(start, start + size)).seconds).toBeGreaterThan(2);
    o += 46 + len;
  }
  expect(names).toContain('KICK.wav');
  expect(names.every((x) => x.endsWith('.wav'))).toBe(true);
});
