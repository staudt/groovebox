// Phase 4 UI: pattern chips, the Song screen (arrangement, scenes) and the mixer view.
import { expect, test, type Page } from '@playwright/test';

const step = (page: Page, n: number) => page.getByRole('button', { name: `Step ${n}`, exact: true });
const hitSteps = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label^="Step "]'))
      .map((el, i) => (el.getAttribute('aria-pressed') === 'true' ? i + 1 : 0))
      .filter(Boolean),
  );
const chip = (page: Page, id: string) => page.getByRole('button', { name: `Pattern ${id}`, exact: true });
const nav = (page: Page, name: string) => page.locator('nav').getByRole('button', { name: new RegExp(`^${name}$`) });
const transportPlay = (page: Page) => page.locator('.app-top, .dsk-transport').getByRole('button', { name: 'Play', exact: true });
const sg = (page: Page) => page.locator('.sg');
const goSong = async (page: Page) => { await nav(page, 'Song').click(); await expect(sg(page)).toBeVisible(); };
const create = (page: Page) => sg(page).getByRole('button', { name: 'Create a song from the current loop' }).click();
const sec = (page: Page, name: string, bars: number) => sg(page).getByRole('button', { name: `Section ${name}, ${bars} bars` });
const cell = (page: Page, track: string, section: string) => sg(page).getByRole('button', { name: new RegExp(`^${track} in ${section}: `) });
const level = (page: Page, track: string) => page.getByRole('slider', { name: `Level ${track}` });

async function longPress(page: Page, loc: ReturnType<Page['locator']>) {
  const box = (await loc.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(step(page, 1)).toBeVisible();
});
test.afterEach(() => { expect(errors).toEqual([]); });

test.describe('pattern chips', () => {
  test('A-D switch the grid; B starts empty and A keeps its steps', async ({ page }) => {
    await expect(chip(page, 'A')).toHaveAttribute('aria-pressed', 'true');
    expect(await hitSteps(page)).toEqual([1, 7, 9]);
    await chip(page, 'B').click();
    await expect(chip(page, 'B')).toHaveAttribute('aria-pressed', 'true');
    expect(await hitSteps(page)).toEqual([]);
    await step(page, 3).click();
    expect(await hitSteps(page)).toEqual([3]);
    await chip(page, 'A').click();
    expect(await hitSteps(page)).toEqual([1, 7, 9]);
  });

  test('long-press B copies A into B for this track; confirms before replacing', async ({ page }) => {
    await longPress(page, chip(page, 'B'));
    await expect(page.getByRole('dialog', { name: 'Pattern B' })).toBeVisible();
    await page.getByRole('button', { name: /Copy pattern A → B \(KICK only\)/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await chip(page, 'B').click();
    expect(await hitSteps(page)).toEqual([1, 7, 9]);
    // B now has steps: copying again asks first.
    await chip(page, 'A').click();
    await longPress(page, chip(page, 'B'));
    await page.getByRole('button', { name: /Copy pattern A → B \(all tracks\)/ }).click();
    await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /Clear B \(KICK only\)/ }).click();
    await chip(page, 'B').click();
    expect(await hitSteps(page)).toEqual([]);
  });

  test('while playing a switch is queued until the next bar, then the pulse clears', async ({ page }) => {
    await transportPlay(page).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await chip(page, 'B').click();
    await expect(chip(page, 'B')).toHaveAttribute('data-queued', '');
    await expect(chip(page, 'B')).not.toHaveAttribute('data-queued', '', { timeout: 8000 });
    await page.getByRole('button', { name: 'Stop' }).click();
  });
});

test.describe('song arrangement', () => {
  test('empty state creates a song from the loop; add, rename, set bars, cycle a lane cell', async ({ page }) => {
    await goSong(page);
    await create(page);
    await expect(sec(page, 'Sec 1', 4)).toBeVisible();
    await sg(page).getByRole('button', { name: 'Add section' }).click();
    await expect(sec(page, 'Sec 2', 4)).toBeVisible();

    // Rename the selected section (Sec 2).
    const name = sg(page).getByRole('textbox', { name: 'Section name' });
    await expect(name).toHaveValue('Sec 2');
    await name.fill('Drop');
    await name.press('Enter');
    await expect(sec(page, 'Drop', 4)).toBeVisible();

    // Bars stepper.
    await sg(page).getByRole('button', { name: 'Bars up' }).click();
    await expect(sec(page, 'Drop', 5)).toBeVisible();
    await expect(sg(page).getByTestId('section-bars')).toHaveText('5');

    // Lane cell: A -> B -> C -> D -> silent.
    const kick = cell(page, 'KICK', 'Drop');
    await expect(kick).toHaveAttribute('data-p', 'A');
    for (const want of ['B', 'C', 'D', '-']) {
      await kick.click();
      await expect(kick).toHaveAttribute('data-p', want);
    }
    await expect(kick).toHaveText('–');
    await expect(cell(page, 'KICK', 'Sec 1')).toHaveAttribute('data-p', 'A');
  });

  test('move, duplicate and delete the selected section', async ({ page }) => {
    await goSong(page);
    await create(page);
    await sg(page).getByRole('button', { name: 'Add section' }).click();
    await sg(page).getByRole('button', { name: 'Move section left' }).click();
    const names = () => sg(page).locator('.sg-chain .sg-sec b').allTextContents();
    expect(await names()).toEqual(['Sec 2', 'Sec 1']);
    await sg(page).getByRole('button', { name: 'Duplicate section' }).click();
    expect(await names()).toEqual(['Sec 2', 'Sec 2 2', 'Sec 1']);
    await sg(page).getByRole('button', { name: 'Delete section' }).click();
    expect(await names()).toEqual(['Sec 2', 'Sec 1']);
  });

  test('Loop and Song toggle; playing in Song mode shows the bar readout', async ({ page }) => {
    await goSong(page);
    await create(page);
    await expect(page.getByRole('button', { name: 'Loop mode' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Song mode' }).click();
    await expect(page.getByRole('button', { name: 'Song mode' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Loop mode' })).toHaveAttribute('aria-pressed', 'false');
    await expect(sg(page).getByTestId('song-readout')).toHaveText('4 bars');
    await transportPlay(page).click();
    await expect(sg(page).getByTestId('song-readout')).toHaveText('bar 1 of 4', { timeout: 8000 });
    await expect(sg(page).locator('.sg-sec[data-active]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(sg(page).getByTestId('song-readout')).toHaveText('4 bars');
  });

  test('a song survives reload', async ({ page }) => {
    await goSong(page);
    await create(page);
    await sg(page).getByRole('button', { name: 'Add section' }).click();
    await cell(page, 'BASS', 'Sec 2').click();
    await page.waitForTimeout(3500); // autosave: debounce plus idle callback
    await page.reload();
    await goSong(page);
    await expect(sec(page, 'Sec 1', 4)).toBeVisible();
    await expect(sec(page, 'Sec 2', 4)).toBeVisible();
    await expect(cell(page, 'BASS', 'Sec 2')).toHaveAttribute('data-p', 'B');
  });
});

test.describe('scenes and mixer', () => {
  test('Mix: M and S toggle; fader drag changes level; pan double-tap centers', async ({ page }) => {
    await goSong(page);
    await page.getByRole('button', { name: 'Mix view' }).click();
    await expect(page.locator('.mx-strip')).toHaveCount(9);
    const mute = page.getByRole('button', { name: 'Mute KICK' });
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    const solo = page.getByRole('button', { name: 'Mixer solo SNARE' });
    await solo.click();
    await expect(solo).toHaveAttribute('aria-pressed', 'true');

    const f = level(page, 'KICK');
    await expect(f).toHaveAttribute('aria-valuenow', '80');
    const b = (await f.boundingBox())!;
    const thumbY = b.y + b.height - 11 - 0.8 * (b.height - 22);
    await page.mouse.move(b.x + b.width / 2, thumbY);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, thumbY - 15, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, thumbY - 30, { steps: 4 });
    await page.mouse.up();
    expect(Number(await f.getAttribute('aria-valuenow'))).toBeGreaterThan(85);

    const pan = page.getByRole('slider', { name: 'Pan KICK' });
    const pb = (await pan.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2 + 25, pb.y + pb.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(Number(await pan.getAttribute('aria-valuenow'))).toBeGreaterThan(10);
    await pan.dblclick();
    await expect(pan).toHaveAttribute('aria-valuenow', '0');

    // Master strip: the sidechain key defaults to KICK and cycles.
    const key = page.getByRole('button', { name: /^Sidechain key: KICK/ });
    await key.click();
    await expect(page.getByRole('button', { name: /^Sidechain key: SNARE/ })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Duck SNARE' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('a fader drag is one undo step (Ctrl+Z)', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'keyboard undo');
    await goSong(page);
    await page.getByRole('button', { name: 'Mix view' }).click();
    const f = level(page, 'KICK');
    const b = (await f.boundingBox())!;
    const thumbY = b.y + b.height - 11 - 0.8 * (b.height - 22);
    await page.mouse.move(b.x + b.width / 2, thumbY);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, thumbY - 10, { steps: 5 });
    await page.mouse.move(b.x + b.width / 2, thumbY - 40, { steps: 5 });
    await page.mouse.up();
    expect(Number(await f.getAttribute('aria-valuenow'))).toBeGreaterThan(85);
    await page.keyboard.press('Control+z');
    await expect(f).toHaveAttribute('aria-valuenow', '80');
  });

  test('scenes: a new scene saves the mutes, recall restores them', async ({ page }) => {
    await goSong(page);
    await page.getByRole('button', { name: 'Mix view' }).click();
    await page.getByRole('button', { name: 'Mute KICK' }).click();
    await page.getByRole('button', { name: 'Arrangement view' }).click();
    await page.getByRole('button', { name: 'Add scene' }).click();
    const scene = page.getByRole('button', { name: 'Recall Scene 1' });
    await expect(scene).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Mix view' }).click();
    await page.getByRole('button', { name: 'Mute KICK' }).click();
    await expect(page.getByRole('button', { name: 'Mute KICK' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Arrangement view' }).click();
    await expect(scene).toHaveAttribute('aria-pressed', 'false');
    await scene.click();
    await page.getByRole('button', { name: 'Mix view' }).click();
    await expect(page.getByRole('button', { name: 'Mute KICK' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('long-press a scene: save the current mutes into it, rename, delete', async ({ page }) => {
    await goSong(page);
    await page.getByRole('button', { name: 'Add scene' }).click(); // nothing muted
    await page.getByRole('button', { name: 'Mix view' }).click();
    await page.getByRole('button', { name: 'Mute SNARE' }).click();
    await page.getByRole('button', { name: 'Arrangement view' }).click();
    await longPress(page, page.getByRole('button', { name: 'Recall Scene 1' }));
    await page.getByRole('button', { name: 'Save current mutes into this scene' }).click();
    await page.getByRole('button', { name: 'Mix view' }).click();
    await page.getByRole('button', { name: 'Mute SNARE' }).click();
    await page.getByRole('button', { name: 'Arrangement view' }).click();
    await page.getByRole('button', { name: 'Recall Scene 1' }).click();
    await page.getByRole('button', { name: 'Mix view' }).click();
    await expect(page.getByRole('button', { name: 'Mute SNARE' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Arrangement view' }).click();
    await longPress(page, page.getByRole('button', { name: 'Recall Scene 1' }));
    await page.getByRole('button', { name: 'Delete scene' }).click();
    await expect(page.getByRole('button', { name: 'Recall Scene 1' })).toHaveCount(0);
  });
});

test('desktop: the top section chain is live (tap selects) and Song replaces the matrix', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'desktop project only');
  await goSong(page);
  await expect(page.locator('.dsk-matrix')).toHaveCount(0);
  await create(page);
  await sg(page).getByRole('button', { name: 'Add section' }).click();
  const top = page.locator('.dsk-main > .dsk-chain');
  await expect(top.locator('.dsk-sec')).toHaveCount(2);
  await top.getByRole('button', { name: 'Section Sec 1, 4 bars' }).click();
  await expect(sg(page).getByRole('textbox', { name: 'Section name' })).toHaveValue('Sec 1');
  await nav(page, 'Play').click();
  await expect(page.locator('.dsk-matrix')).toBeVisible();
  await expect(top.locator('.dsk-sec')).toHaveCount(2);
});
