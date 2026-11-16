import { describe, expect, it } from 'vitest';
import { Limiter } from '../../src/engine/limiter';
import { detectClicks } from '../audio/analysis';
import { Noise } from '../../src/engine/dsp';

function run(sig: Float32Array, block = 128) {
  const lim = new Limiter(48000);
  const out = new Float32Array(sig.length);
  const l = new Float32Array(block);
  const r = new Float32Array(block);
  for (let o = 0; o < sig.length; o += block) {
    const n = Math.min(block, sig.length - o);
    l.fill(0);
    r.fill(0);
    l.set(sig.subarray(o, o + n));
    r.set(sig.subarray(o, o + n));
    lim.process(l, r, block);
    out.set(l.subarray(0, n), o);
  }
  return { out, lim };
}

describe('limiter', () => {
  it('holds the ceiling on its own (safety clamp never engages) for random bursts up to +12 dB', () => {
    const nz = new Noise(7);
    const sig = new Float32Array(48000 * 4);
    let amp = 0.3;
    for (let i = 0; i < sig.length; i++) {
      if (i % 3000 === 0) amp = 0.2 + nz.unit() * 3.8;
      // Single-sample spikes too.
      sig[i] = (i % 7919 === 0 ? 4 : amp) * Math.sin(i * 0.05 + nz.unit() * 0.01) * (0.5 + 0.5 * nz.unit());
    }
    const { out, lim } = run(sig);
    let pk = 0;
    for (const v of out) pk = Math.max(pk, Math.abs(v));
    expect(pk).toBeLessThanOrEqual(0.98 * 1.000001);
    expect(lim.clamped).toBe(0);
  });

  it('is transparent below the ceiling (pure delay)', () => {
    const sig = new Float32Array(4800).map((_, i) => 0.5 * Math.sin(i * 0.03));
    const { out, lim } = run(sig);
    const n = lim.latency;
    for (let i = n; i < sig.length; i++) expect(out[i]).toBeCloseTo(sig[i - n]!, 6);
  });

  it('gain changes do not click on a loud sine', () => {
    // Smooth 5 ms envelope steps 0.4 -> 2.5 -> 0.4, so any click would come from the limiter itself.
    const env = (i: number) => {
      const up = Math.min(1, Math.max(0, (i - 12000) / 240));
      const down = Math.min(1, Math.max(0, (i - 30000) / 240));
      return 0.4 + 2.1 * (up - down);
    };
    const sig = new Float32Array(48000).map((_, i) => env(i) * Math.sin(i * 0.02));
    const { out } = run(sig);
    expect(detectClicks(out, 48000)).toEqual([]);
  });
});
