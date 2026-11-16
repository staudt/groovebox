import { describe, expect, it } from 'vitest';
import { drumTrack, render, sparseOnsets } from './render';

const START = { type: 'transport', playing: true } as const;
const tempo = (bpm: number, swing = 50) => ({ type: 'tempo', bpm, swing }) as const;
// Short pure-sine ping (perc model, no FM, shortest decay): deterministic attack and silent gaps
// between hits even at 200 BPM, so the first sample over threshold is an exact onset.
const HAT = { decay: 0, tone: 0 };

describe('engine clock', () => {
  for (const sr of [44100, 48000]) {
    for (const bpm of [60, 92, 120, 177, 200]) {
      it(`quarter-note hits land within 1 ms of the grid at ${bpm} BPM, ${sr} Hz`, () => {
        const r = render([tempo(bpm), ...drumTrack(0, 'perc', 'x . . . x . . . x . . . x . . .', HAT), START], (60 / bpm) * 8, { sr });
        const lat = r.engine.latency;
        const onsets = sparseOnsets(r.left, sr);
        expect(onsets.length).toBe(8);
        onsets.forEach((o, k) => {
          const expected = k * (sr * 60) / bpm + lat;
          expect(Math.abs(o - expected) / sr).toBeLessThan(0.001);
        });
      });
    }
  }

  it('does not drift over 64 bars at 133 BPM', () => {
    const bpm = 133;
    const sr = 48000;
    const r = render([tempo(bpm), ...drumTrack(0, 'perc', 'x . . . . . . . . . . . . . . .', HAT), START], (60 / bpm) * 4 * 64 - 0.05, { sr });
    const onsets = sparseOnsets(r.left, sr);
    expect(onsets.length).toBe(64);
    const last = onsets[63]!;
    expect(Math.abs(last - (63 * 4 * sr * 60) / bpm - r.engine.latency)).toBeLessThan(2);
  });

  it('is independent of block size', () => {
    const cmds = [tempo(97), ...drumTrack(0, 'perc', 'x . x . . x . . x . . . x . x .', HAT), START];
    const a = sparseOnsets(render(cmds, 3, { block: 128 }).left, 48000);
    const b = sparseOnsets(render(cmds, 3, { block: 512 }).left, 48000);
    const c = sparseOnsets(render(cmds, 3, { block: 37 }).left, 48000);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('applies swing to odd 16ths: 66 % puts the off-16th at 2/3 of the 8th', () => {
    const bpm = 100;
    const sr = 48000;
    const r = render([tempo(bpm, 66), ...drumTrack(0, 'perc', 'x x . . . . . . . . . . . . . .', HAT), START], 0.5, { sr });
    const [a, b] = sparseOnsets(r.left, sr);
    const step = (sr * 60) / bpm / 4;
    expect(Math.abs(b! - a! - step * 2 * 0.66)).toBeLessThan(2);
  });

  it('keeps a steady grid across a tempo change', () => {
    const sr = 48000;
    const r = render([tempo(120), ...drumTrack(0, 'perc', 'x . . . x . . . x . . . x . . .', HAT), START], 4, {
      sr,
      at: [{ time: 1.01, cmd: tempo(180) }],
    });
    const on = sparseOnsets(r.left, sr).map((o) => o / sr);
    const iois = on.slice(1).map((t, i) => t - on[i]!);
    // Before the change: 0.5 s; after it settles: 1/3 s. Every interval is one or the other (or the one transition).
    const odd = iois.filter((d) => Math.abs(d - 0.5) > 0.001 && Math.abs(d - 1 / 3) > 0.001);
    expect(odd.length).toBeLessThanOrEqual(1);
    expect(iois.at(-1)!).toBeCloseTo(1 / 3, 3);
  });

  it('honors nudge (late by a quarter step)', () => {
    const sr = 48000;
    const r = render(
      [
        tempo(120),
        ...drumTrack(0, 'perc', '. . . .', HAT),
        { type: 'pattern', track: 0, pattern: { length: 16, steps: [{ t: 'hit', vel: 100, nudge: 0.25 }, ...Array(15).fill({ t: 'rest' })] } },
        START,
      ],
      0.3,
      { sr },
    );
    const [o] = sparseOnsets(r.left, sr);
    expect(Math.abs(o! - 0.25 * (sr * 60) / 120 / 4 - r.engine.latency)).toBeLessThan(2);
  });

  it('emits one step event per step with increasing times', () => {
    const r = render([tempo(120), ...drumTrack(0, 'kick', 'x'), START], 1);
    const steps = r.events.filter((e) => e.type === 'step');
    expect(steps.length).toBeGreaterThanOrEqual(8);
    steps.forEach((e, i) => {
      if (e.type !== 'step') return;
      expect(e.step).toBe(i);
      if (i > 0) expect(e.time).toBeGreaterThan((steps[i - 1] as { time: number }).time);
    });
  });
});

describe('engine output', () => {
  it('is silent when stopped', () => {
    const r = render([...drumTrack(0, 'kick', 'x x x x x x x x x x x x x x x x')], 1);
    expect(r.left.every((v) => v === 0)).toBe(true);
  });

  it('never exceeds 0 dBFS with every track maxed and driven', () => {
    const cmds = [tempo(180)];
    const models = ['kick', 'snare', 'hat', 'perc', 'kick', 'snare', 'hat', 'perc'] as const;
    models.forEach((m, t) => cmds.push(...(drumTrack(t, m, 'x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127 x127', { level: 1, drive: 1, decay: 1 }) as never[])));
    const r = render([...cmds, START], 3);
    let peak = 0;
    for (const v of r.left) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1);
  });

  it('every drum model makes sound and decays to silence', () => {
    for (const m of ['kick', 'snare', 'hat', 'perc'] as const) {
      const r = render([tempo(60), ...drumTrack(0, m, 'x'), START], 3);
      let peak = 0;
      for (let i = 0; i < 4800; i++) peak = Math.max(peak, Math.abs(r.left[i]!));
      expect(peak, m).toBeGreaterThan(0.05);
      // Tail is gone well before the next bar (4 s at 60 BPM).
      const tail = r.left.subarray(Math.round(2.5 * 48000));
      expect(tail.every((v) => Math.abs(v) < 1e-4), m).toBe(true);
    }
  });

  it('mute silences the track', () => {
    const r = render([tempo(120), ...drumTrack(0, 'kick', 'x . . . x . . . x . . . x . . .'), START], 2, {
      at: [{ time: 0.9, cmd: { type: 'mute', track: 0, mute: true } }],
    });
    const after = r.left.subarray(Math.round(1.1 * 48000));
    expect(after.every((v) => Math.abs(v) < 1e-5)).toBe(true);
  });
});
