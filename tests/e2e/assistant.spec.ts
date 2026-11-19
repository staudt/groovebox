// Phase 6 assistant UI. The proxy is mocked with page.route (health and answers), so no real API is called.
import { expect, test, type Page, type Route } from '@playwright/test';
import { fakeMic, files } from './fakeMic';

const isDesktop = () => test.info().project.name === 'desktop';
const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const hitSteps = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label^="Step "]'))
      .map((el, i) => (el.getAttribute('aria-pressed') === 'true' ? i + 1 : 0))
      .filter(Boolean),
  );
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}$`) });
const strip = (page: Page, name: string) => page.locator('.strip').getByRole('button', { name: new RegExp(`^${name}`) });
const askInput = (page: Page) => page.getByRole('textbox', { name: 'Ask the assistant' });

type Body = Record<string, unknown>;
type Answer = unknown | 'abort' | 'error';
type Answers = Partial<Record<'sound' | 'place' | 'jam' | 'ask', (body: Body, n: number) => Answer>>;

/** Health says the assistant is on; POST answers come from `answers` (per feature, with a call counter). */
async function mockAssist(page: Page, answers: Answers, health: Record<string, unknown> | number = { ok: true, model: 'claude-haiku-5-5' }) {
  const calls: Record<string, number> = {};
  await page.route('**/api/assist/health', (r: Route) => (typeof health === 'number' ? r.fulfill({ status: health, body: 'no' }) : r.fulfill({ json: health })));
  await page.route('**/api/assist', async (r: Route) => {
    const body = r.request().postDataJSON() as Body;
    const f = String(body['feature']) as keyof Answers;
    calls[f] = (calls[f] ?? 0) + 1;
    const a = answers[f]?.(body, calls[f]!);
    if (a === 'abort') return r.abort();
    if (a === 'error' || a === undefined) return r.fulfill({ status: 500, body: 'x' });
    return r.fulfill({ json: { feature: f, result: a } });
  });
  return calls;
}

const cmd = (o: Record<string, unknown>) => ({ track: null, slot: null, to: null, pattern: null, param: null, value: null, text: null, ...o });

test.use({ launchOptions: fakeMic(files.melody), permissions: ['microphone'] });

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test.describe('assistant availability', () => {
  test('no proxy (like GitHub Pages): every assistant control is hidden, no hint', async ({ page }) => {
    await mockAssist(page, {}, 404);
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    await expect(askInput(page)).toHaveCount(0);
    await expect(page.getByTestId('assist-hint')).toHaveCount(0);
    await nav(page, 'Sound').click();
    await strip(page, 'BASS').click();
    await expect(page.getByTestId('alg-diagram')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Describe a sound' })).toHaveCount(0);
    await nav(page, 'Song').click();
    await expect(page.getByRole('button', { name: 'Jam mode' })).toHaveCount(0);
  });

  test('default preview server (no key): only the muted hint, nothing else', async ({ page }) => {
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    await expect(page.getByTestId('assist-hint')).toHaveText('Assistant: add ANTHROPIC_API_KEY to .env and restart the dev server');
    await expect(askInput(page)).toHaveCount(0);
    await nav(page, 'Sound').click();
    await strip(page, 'BASS').click();
    await expect(page.getByRole('textbox', { name: 'Describe a sound' })).toHaveCount(0);
    await nav(page, 'Song').click();
    await expect(page.getByRole('button', { name: 'Jam mode' })).toHaveCount(0);
  });
});

test.describe('Ask bar', () => {
  const answer = {
    summary: 'Faster, with the kick muted.',
    commands: [
      cmd({ op: 'set_bpm', value: 100 }),
      cmd({ op: 'set_mute', track: 'KICK', value: 1 }),
      cmd({ op: 'set_mute', track: 'SNARE', value: 1 }),
      cmd({ op: 'set_mute', track: 'NOPE', value: 1 }), // invalid: dropped
    ],
  };
  const ask = async (page: Page, text = 'make it faster') => {
    await askInput(page).fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
  };

  test('proposals with checkboxes; Apply changes exactly the checked ones; one undo step', async ({ page }) => {
    const calls = await mockAssist(page, { ask: () => answer });
    await page.goto('/');
    await ask(page);
    const card = page.getByRole('dialog', { name: 'Assistant suggestion' });
    await expect(card.getByTestId('ask-summary')).toHaveText('Faster, with the kick muted.');
    const boxes = card.getByRole('checkbox');
    await expect(boxes).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).toBeChecked();
    await expect(card).toContainText('Tempo 100 BPM');
    // Nothing has changed yet.
    await expect(page.getByRole('button', { name: '92 BPM' })).toBeVisible();
    await boxes.nth(2).uncheck(); // SNARE stays unmuted
    await card.getByRole('button', { name: 'Apply' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('button', { name: '100 BPM' })).toBeVisible();
    expect(calls['ask']).toBe(1);
    await nav(page, 'Song').click();
    await page.getByRole('button', { name: 'Mix view' }).click();
    await expect(page.getByRole('button', { name: 'Mute KICK' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Mute SNARE' })).toHaveAttribute('aria-pressed', 'false');
    if (isDesktop()) {
      await page.keyboard.press('Control+z'); // BPM and mute come back together
      await expect(page.getByRole('button', { name: '92 BPM' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mute KICK' })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('Skip changes nothing', async ({ page }) => {
    await mockAssist(page, { ask: () => answer });
    await page.goto('/');
    await ask(page);
    const card = page.getByRole('dialog', { name: 'Assistant suggestion' });
    await card.getByRole('button', { name: 'Skip' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('button', { name: '92 BPM' })).toBeVisible();
    await nav(page, 'Song').click();
    await page.getByRole('button', { name: 'Mix view' }).click();
    await expect(page.getByRole('button', { name: 'Mute KICK' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('a failed request or an empty answer shows "No suggestion this time." and changes nothing', async ({ page }) => {
    await mockAssist(page, { ask: (_b, n) => (n === 1 ? 'abort' : n === 2 ? 'error' : { summary: 'Cannot do that.', commands: [] }) });
    await page.goto('/');
    for (let i = 0; i < 3; i++) {
      await ask(page, `try ${i}`);
      await expect(page.getByText('No suggestion this time.')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Assistant suggestion' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '92 BPM' })).toBeVisible();
    }
  });

  test('Cancel aborts a pending request', async ({ page }) => {
    await page.route('**/api/assist/health', (r) => r.fulfill({ json: { ok: true, model: 'm' } }));
    await page.route('**/api/assist', () => { /* never answers */ });
    await page.goto('/');
    await ask(page);
    await expect(page.getByText('Thinking…')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(askInput(page)).toBeVisible();
    await expect(page.getByText('No suggestion this time.')).toHaveCount(0);
  });

  test('"/" focuses the Ask bar on desktop', async ({ page }) => {
    test.skip(!isDesktop(), 'keyboard shortcut');
    await mockAssist(page, {});
    await page.goto('/');
    await expect(askInput(page)).toBeVisible();
    await page.keyboard.press('/');
    await expect(askInput(page)).toBeFocused();
    await page.keyboard.type('a/b'); // typing "/" inside the field stays text
    await expect(askInput(page)).toHaveValue('a/b');
  });
});

// A made-up patch; the converter clamps and completes it.
const patch = (name: string, algorithm: number) => ({
  name,
  algorithm,
  feedback: 3,
  ops: Array.from({ length: 6 }, (_, i) => ({ ratio: i + 1, detune: 0, level: i === 0 ? 99 : 60, a: 0.1, d: 0.5, s: 0.5, r: 0.4, velSens: 2 })),
});

test('Describe a sound: three takes, tap B applies it, Original restores', async ({ page }) => {
  await mockAssist(page, {
    sound: () => ({ takes: [
      { description: 'Glassy and bright', patch: patch('Glass Bell', 5) },
      { description: 'Softer, slower attack', patch: patch('Soft Bell', 7) },
      { description: 'Metallic and hard', patch: patch('Iron Bell', 9) },
    ] }),
  });
  await page.goto('/');
  await nav(page, 'Sound').click();
  await strip(page, 'BASS').click();
  await expect(page.getByTestId('patch-name')).toContainText('Round Bass');
  await page.getByRole('textbox', { name: 'Describe a sound' }).fill('glassy bell');
  await page.getByRole('button', { name: 'Make' }).click();
  const takes = page.getByRole('group', { name: 'Takes' });
  await expect(takes.getByRole('button')).toHaveCount(4); // A, B, C, Original
  await expect(takes).toContainText('Glassy and bright');
  await expect(page.getByTestId('patch-name')).toContainText('Round Bass'); // nothing applied yet
  await takes.getByRole('button', { name: /^Take B/ }).click();
  await expect(page.getByTestId('patch-name')).toContainText('Soft Bell');
  await expect(page.getByTestId('alg-num')).toHaveText('07 / 32');
  await takes.getByRole('button', { name: /^Take C/ }).click();
  await expect(page.getByTestId('patch-name')).toContainText('Iron Bell');
  await takes.getByRole('button', { name: 'Original' }).click();
  await expect(page.getByTestId('patch-name')).toContainText('Round Bass');
  await expect(page.getByTestId('alg-num')).toHaveText('05 / 32');
  if (isDesktop()) {
    await page.keyboard.press('Control+z'); // one undo step per tap: back to Iron Bell
    await expect(page.getByTestId('patch-name')).toContainText('Iron Bell');
  }
});

test('Describe a sound: a failed request shows no takes', async ({ page }) => {
  await mockAssist(page, { sound: () => 'abort' });
  await page.goto('/');
  await nav(page, 'Sound').click();
  await strip(page, 'BASS').click();
  await page.getByRole('textbox', { name: 'Describe a sound' }).fill('x');
  await page.getByRole('button', { name: 'Make' }).click();
  await expect(page.getByText('No suggestion this time.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Takes' })).toHaveCount(0);
  await expect(page.getByTestId('patch-name')).toContainText('Round Bass');
});

test.describe('Place suggestion', () => {
  test('track, slot and octave arrive cyan with a reason; manual change clears; Other spot falls back on the same answer', async ({ page }) => {
    test.setTimeout(150_000);
    await mockAssist(page, {
      place: () => ({ track: 'BASS', slot: 'C', section: null, startStep: 0, repeats: 1, octaveShift: 1, reason: 'Low register suits the bass line' }),
    });
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    if (isDesktop()) await page.getByRole('button', { name: /^Capture/ }).first().click();
    else await page.getByRole('button', { name: 'Capture', exact: true }).click();
    const cap = page.getByRole('dialog', { name: 'Capture a melody' });
    await expect(cap).toBeVisible();
    await page.getByRole('button', { name: /^Count-in/ }).click();
    await page.getByRole('button', { name: /^Count-in/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await cap.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByRole('dialog', { name: 'Place a melody' })).toBeVisible({ timeout: 90_000 });

    const cyan = (id: string) => page.locator('.pl-step[data-sug]').filter({ has: page.getByTestId(id) });
    await expect(page.getByTestId('chip-track')).toHaveText('Track: BASS');
    await expect(page.getByTestId('chip-pattern')).toHaveText('Pattern: C');
    await expect(cyan('chip-track')).toContainText('suggested');
    await expect(cyan('chip-pattern')).toHaveCount(1);
    await expect(cyan('chip-octave')).toHaveCount(1);
    await expect(page.getByTestId('place-reason')).toHaveText('Low register suits the bass line');

    // A manual change clears only that control's cyan state.
    await page.getByRole('button', { name: 'Track up' }).click();
    await expect(cyan('chip-track')).toHaveCount(0);
    await expect(cyan('chip-pattern')).toHaveCount(1);
    await page.getByRole('button', { name: 'Pattern down' }).click();
    await expect(cyan('chip-pattern')).toHaveCount(0);

    // Other spot: asking again returns the same answer -> falls back to the next empty slot, no cyan.
    await page.getByRole('button', { name: 'Other spot' }).click();
    await expect(page.getByTestId('chip-pattern')).not.toHaveText('Pattern: C');
    await expect(cyan('chip-pattern')).toHaveCount(0);
  });

  test('a failed request leaves the defaults and shows nothing', async ({ page }) => {
    test.setTimeout(150_000);
    await mockAssist(page, { place: () => 'abort' });
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    if (isDesktop()) await page.getByRole('button', { name: /^Capture/ }).first().click();
    else await page.getByRole('button', { name: 'Capture', exact: true }).click();
    const cap = page.getByRole('dialog', { name: 'Capture a melody' });
    await page.getByRole('button', { name: /^Count-in/ }).click();
    await page.getByRole('button', { name: /^Count-in/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await page.getByRole('button', { name: /^Length/ }).click();
    await cap.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByRole('dialog', { name: 'Place a melody' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('chip-track')).toHaveText('Track: KEYS');
    await page.waitForTimeout(500);
    await expect(page.locator('.pl-step[data-sug]')).toHaveCount(0);
    await expect(page.getByTestId('place-reason')).toHaveCount(0);
  });
});

test.describe('Jam queue', () => {
  const kick = 'x . . . x . . . x . . . x . . .';
  test('variations appear while playing; Queue applies at the section boundary, Skip drops one', async ({ page }) => {
    test.setTimeout(90_000);
    const calls = await mockAssist(page, {
      jam: (_b, n) => (n === 1
        ? { variations: [
          { description: 'Four on the floor', changes: [{ track: 'KICK', slot: 'A', pattern: kick }] },
          { description: 'Busy hats', changes: [{ track: 'HATS', slot: 'A', pattern: 'x x x x x x x x x x x x x x x x' }] },
        ] }
        : { variations: [] }),
    });
    await page.goto('/');
    await expect(step(page, 1)).toBeVisible();
    expect(await hitSteps(page)).toEqual([1, 7, 9]); // KICK A before
    await strip(page, 'HATS').click();
    const hatsBefore = await hitSteps(page);
    await strip(page, 'KICK').click();
    await page.getByRole('button', { name: /BPM$/ }).click();
    await page.getByRole('dialog', { name: 'Tempo' }).getByRole('slider', { name: 'BPM' }).fill('240');
    await page.getByRole('dialog', { name: 'Tempo' }).getByRole('button', { name: 'Done' }).click();

    await nav(page, 'Song').click();
    await page.getByRole('button', { name: 'Create a song from the current loop' }).click();
    await page.getByRole('button', { name: 'Add section' }).click();
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Bars down' }).click();
      if (s === 0) await page.getByRole('button', { name: 'Section Sec 1, 4 bars' }).first().click();
    }
    await page.getByRole('button', { name: 'Song mode' }).click();
    const jam = page.getByRole('button', { name: 'Jam mode' });
    await expect(jam).toHaveText('Jam mode off');
    await jam.click();
    await expect(jam).toHaveText('Jam mode on');
    expect(calls['jam'] ?? 0).toBe(0);
    await page.locator('.app-top, .dsk-transport').getByRole('button', { name: 'Play', exact: true }).click();

    const four = page.locator('.jam-item', { hasText: 'Four on the floor' });
    const hats = page.locator('.jam-item', { hasText: 'Busy hats' });
    await expect(four).toBeVisible({ timeout: 15_000 });
    await expect(hats).toBeVisible();
    await expect(four).toContainText('KICK');
    await four.getByRole('button', { name: /^Queue/ }).click();
    await expect(four).toContainText('Queued');
    await hats.getByRole('button', { name: /^Skip/ }).click();
    await expect(hats).toContainText('Skipped');
    await expect(four).toContainText('Played', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Stop' }).click();
    await nav(page, 'Play').click();
    await strip(page, 'KICK').click();
    expect(await hitSteps(page)).toEqual([1, 5, 9, 13]);
    await strip(page, 'HATS').click();
    expect(await hitSteps(page)).toEqual(hatsBefore); // skipped: untouched
  });

  test('turning Jam off stops requests', async ({ page }) => {
    const calls = await mockAssist(page, { jam: () => ({ variations: [] }) });
    await page.goto('/');
    await nav(page, 'Song').click();
    const jam = page.getByRole('button', { name: 'Jam mode' });
    await jam.click();
    await jam.click();
    await expect(jam).toHaveText('Jam mode off');
    await page.locator('.app-top, .dsk-transport').getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(1500);
    expect(calls['jam'] ?? 0).toBe(0);
  });
});
