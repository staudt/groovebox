// `pnpm bench`: engine CPU cost as a fraction of real time (desktop Node; a mid-range phone is ~4-8x slower).
import { it } from 'vitest';
import { Engine } from '../../src/engine/core';
import { defaultProject } from '../../src/store/defaults';
import { parsePattern } from '../../src/store/notation';
import { projectCommands } from '../unit/render';

it('bench', () => {
  const sr = 48000;
  const e = new Engine(sr);
  const p = defaultProject();
  for (const c of projectCommands(p)) e.command(c);
  // Worst case for Phase 1: every drum track on every 16th with long decays.
  for (const t of [0, 1, 2, 6]) {
    e.command({ type: 'pattern', track: t, pattern: parsePattern(Array(16).fill('x').join(' ')) });
  }
  e.command({ type: 'tempo', bpm: 200, swing: 50 });
  e.command({ type: 'transport', playing: true });
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  for (let i = 0; i < 2000; i++) e.process(l, r, 128); // warm up JIT
  const seconds = 30;
  const blocks = Math.round((seconds * sr) / 128);
  const t0 = performance.now();
  for (let i = 0; i < blocks; i++) e.process(l, r, 128);
  const ms = performance.now() - t0;
  console.log(`rendered ${seconds}s in ${ms.toFixed(0)} ms = ${((ms / 1000 / seconds) * 100).toFixed(2)}% of one core (desktop)`);
});
