// Renders the real AudioWorklet in headless Chromium and checks timing, clicks and the ceiling.
import { expect, test } from '@playwright/test';
import { detectClicks, detectOnsets, peak } from '../audio/analysis';
import { projectCommands } from '../unit/render';
import { defaultProject } from '../../src/store/defaults';
import type { EngineCommand } from '../../src/engine/protocol';

// Runs only in the desktop project (see playwright.config.ts).

async function renderInPage(page: import('@playwright/test').Page, cmds: EngineCommand[], seconds: number, sr: number) {
  await page.goto('render.html');
  await expect(page).toHaveTitle('ready');
  const chans = await page.evaluate(
    ([c, s, r]) => (window as unknown as { renderEngine: (c: unknown, s: number, r: number) => Promise<number[][]> }).renderEngine(c, s, r),
    [cmds, seconds, sr] as const,
  );
  return chans.map((c) => Float32Array.from(c));
}

test('default beat renders in the worklet: non-silent, no clicks, under 0 dBFS', async ({ page }) => {
  const sr = 48000;
  const [l, r] = await renderInPage(page, [...projectCommands(defaultProject()), { type: 'transport', playing: true }], 6, sr);
  expect(peak(l!)).toBeGreaterThan(0.1);
  expect(peak(l!)).toBeLessThan(1);
  expect(peak(r!)).toBeLessThan(1);
  expect(detectClicks(l!, sr)).toEqual([]);
});

for (const bpm of [60, 140, 200]) {
  test(`worklet onsets within 1 ms of the grid at ${bpm} BPM`, async ({ page }) => {
    const sr = 44100;
    const cmds: EngineCommand[] = [
      { type: 'tempo', bpm, swing: 50 },
      { type: 'trackKind', track: 0, kind: 'drum' },
      { type: 'drumParams', track: 0, params: { model: 'perc', tune: 0, decay: 0, tone: 0, level: 0.8, drive: 0 } },
      { type: 'pattern', track: 0, pattern: { length: 16, steps: Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? { t: 'hit', vel: 100 } : { t: 'rest' })) } },
      { type: 'transport', playing: true },
    ];
    const beat = 60 / bpm;
    const [l] = await renderInPage(page, cmds, beat * 8 - 0.01, sr);
    const onsets = detectOnsets(l!, sr);
    expect(onsets.length).toBe(8);
    const latency = onsets[0]!; // engine latency (limiter lookahead) + render start
    onsets.forEach((t, k) => expect(Math.abs(t - latency - k * beat) * 1000).toBeLessThan(1));
  });
}
