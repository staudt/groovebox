// UI tests for the sampler panel on the Sound screen, the sample browser and mic recording.
import { expect, test, type Page } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  permissions: ['microphone'],
});

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
});
test.afterEach(() => { expect(errors).toEqual([]); });

async function openSound(page: Page, name: string) {
  await page.locator('.strip').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Sound' }).click();
}
const sampleName = (page: Page) => page.getByTestId('sample-name');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Samples' });

/** A 0.3 s 16-bit mono 44.1 kHz WAV with a 440 Hz tone. */
function wav(): Buffer {
  const rate = 44100;
  const n = Math.round(rate * 0.3);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000), 44 + i * 2);
  return b;
}

test('PERC shows the sampler panel with the tambourine kit sample and a waveform', async ({ page }) => {
  await openSound(page, 'PERC');
  await expect(sampleName(page)).toContainText('tambourine');
  await expect(page.getByTestId('waveform-canvas')).toHaveAttribute('data-loaded', '1');
  // the canvas actually has drawn pixels
  const drawn = await page.getByTestId('waveform-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return true;
    return false;
  });
  expect(drawn).toBe(true);
});

test('choosing kit clap changes the sample name', async ({ page }) => {
  await openSound(page, 'PERC');
  await sampleName(page).click();
  await sheet(page).getByRole('button', { name: 'Kit clap' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sampleName(page)).toContainText('clap');
});

test('dragging the Start handle changes start', async ({ page }) => {
  await openSound(page, 'PERC');
  const h = page.getByTestId('trim-start');
  await expect(h).toHaveAttribute('aria-valuenow', '0');
  const wf = (await page.getByTestId('waveform').boundingBox())!;
  const hb = (await h.boundingBox())!;
  const y = wf.y + wf.height / 2;
  await page.mouse.move(hb.x + hb.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(wf.x + wf.width * 0.3, y, { steps: 6 });
  await page.mouse.up();
  const v = Number(await h.getAttribute('aria-valuenow'));
  expect(v).toBeGreaterThan(0.2);
  expect(v).toBeLessThan(0.4);
  // keyboard nudges too
  await h.focus();
  await page.keyboard.press('ArrowRight');
  expect(Number(await h.getAttribute('aria-valuenow'))).toBeCloseTo(v + 0.01, 2);
});

test('Reverse and Chromatic toggles; chromatic shows the keyboard', async ({ page }) => {
  await openSound(page, 'PERC');
  await expect(page.locator('.kbd')).toHaveCount(0);
  const rev = page.getByRole('button', { name: 'Reverse', exact: true });
  await rev.click();
  await expect(rev).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Chromatic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chromatic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.kbd')).toBeVisible();
  await expect(page.getByTestId('s-root')).toBeVisible();
  await page.getByRole('button', { name: 'One-shot', exact: true }).click();
  await expect(page.locator('.kbd')).toHaveCount(0);
  await rev.click();
  await expect(rev).toHaveAttribute('aria-pressed', 'false');
});

test('importing a WAV creates a Your samples entry that survives reload', async ({ page }) => {
  await openSound(page, 'PERC');
  await sampleName(page).click();
  await sheet(page).locator('input[type=file]').setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(sheet(page).getByRole('button', { name: 'Use beep' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sampleName(page)).toContainText('beep');
  await page.reload();
  await openSound(page, 'PERC');
  await sampleName(page).click();
  await sheet(page).getByRole('tab', { name: 'Your samples' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Use beep' })).toBeVisible();
});

test('VOX shows the empty state', async ({ page }) => {
  await openSound(page, 'VOX');
  await expect(page.getByTestId('sampler-empty')).toBeVisible();
  await expect(page.getByTestId('waveform')).toHaveCount(0);
});

test('recording about one second creates a sample assigned to VOX', async ({ page }) => {
  await openSound(page, 'VOX');
  await page.getByTestId('sampler-empty').getByRole('button', { name: 'Record' }).click();
  await sheet(page).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(sheet(page).getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(1500);
  await sheet(page).getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByTestId('rec-saved')).toContainText('Recording 1');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sampleName(page)).toContainText('Recording 1');
  await expect(page.getByTestId('waveform-canvas')).toHaveAttribute('data-loaded', '1');
});
