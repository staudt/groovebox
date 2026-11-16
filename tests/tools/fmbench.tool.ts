// `TOOLS=1 vitest run fmbench --silent=false`: cost of 8 sounding FM voices (all 6 operators active).
import { it } from 'vitest';
import { Engine } from '../../src/engine/core';
import { presetByName } from '../../src/store/fmPresets';

it('fmbench', () => {
  const sr = 48000;
  for (const name of ['Electric Piano', 'Pluck Lead']) {
    const e = new Engine(sr);
    e.command({ type: 'trackKind', track: 0, kind: 'fm' });
    e.command({ type: 'fmPatch', track: 0, patch: { ...presetByName(name), ops: presetByName(name).ops.map((o) => ({ ...o, s: 1, d: 1 })) as never } });
    for (let n = 0; n < 8; n++) e.command({ type: 'noteOn', track: 0, note: 48 + n * 3, vel: 100 });
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    for (let i = 0; i < 2000; i++) e.process(l, r, 128);
    const blocks = Math.round((20 * sr) / 128);
    const t0 = performance.now();
    for (let i = 0; i < blocks; i++) e.process(l, r, 128);
    const ms = performance.now() - t0;
    console.log(`${name}: 8 FM voices = ${((ms / 1000 / 20) * 100).toFixed(2)}% of one core (desktop)`);
  }
});
