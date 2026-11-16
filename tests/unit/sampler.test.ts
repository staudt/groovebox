import { describe, expect, it } from 'vitest';
import { cents, detectClicks, estimatePitchHz, peak, rms } from '../audio/analysis';
import type { EngineCommand } from '../../src/engine/protocol';
import { projectCommands, render, samplerTrack } from './render';
import { defaultProject } from '../../src/store/defaults';

const SR = 48000;
const START: EngineCommand = { type: 'transport', playing: true };
const tempo = (bpm = 120): EngineCommand => ({ type: 'tempo', bpm, swing: 50 });

/** A sine sample at its own sample rate; `cut` ends it abruptly mid-cycle (worst case for clicks). */
function sine(hz: number, seconds: number, rate = 44100, cut = false): { l: Float32Array; rate: number } {
  const n = Math.round(seconds * rate) + (cut ? 7 : 0);
  return { l: Float32Array.from({ length: n }, (_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / rate)), rate };
}

describe('sampler', () => {
  it('one-shot plays at the original pitch across sample rates, and pitch shifts by semitones', () => {
    for (const [pitch, hz] of [[0, 440], [12, 880], [-7, 440 * Math.pow(2, -7 / 12)]] as const) {
      const r = render([tempo(), ...samplerTrack(0, sine(440, 1), { pitch }, 'x'), START], 0.6).left;
      const f = estimatePitchHz(r, SR, 0.05 * SR, 0.3 * SR);
      expect(Math.abs(cents(f, hz)), `pitch ${pitch}`).toBeLessThan(5);
    }
  });

  it('chromatic mode transposes from the root and holds set the length', () => {
    const s = sine(220, 2);
    const r = render([tempo(), ...samplerTrack(0, s, { mode: 'chromatic', root: 57, release: 0 }, 'A4 ~ ~ ~ . . . .'), START], 1).left;
    // A4 (69) from root A3 (57) = one octave up.
    expect(Math.abs(cents(estimatePitchHz(r, SR, 0.05 * SR, 0.4 * SR), 440))).toBeLessThan(5);
    const step = 0.125;
    expect(rms(r, 0.3 * SR, 0.45 * SR)).toBeGreaterThan(0.1); // during the holds
    expect(rms(r, (4 * step + 0.08) * SR, 0.9 * SR)).toBeLessThan(1e-3); // released after the last hold
  });

  it('reverse plays the sample backwards', () => {
    // A rising ramp sample: forwards the output rises, reversed it falls.
    const ramp = { l: Float32Array.from({ length: 22050 }, (_, i) => (i / 22050) * 0.8), rate: 44100 };
    const fwd = render([tempo(), ...samplerTrack(0, ramp, {}, 'x'), START], 0.4).left;
    const rev = render([tempo(), ...samplerTrack(0, ramp, { reverse: true }, 'x'), START], 0.4).left;
    const at = (b: Float32Array, t: number) => b[Math.round(t * SR)]!;
    expect(at(fwd, 0.4 * 0.5)).toBeGreaterThan(at(fwd, 0.1));
    expect(at(rev, 0.4 * 0.5)).toBeLessThan(at(rev, 0.1));
  });

  it('trim plays only the selected region', () => {
    const s = sine(440, 1); // 1 s
    const r = render([tempo(60), ...samplerTrack(0, s, { start: 0.25, end: 0.5 }, 'x'), START], 1).left;
    // 0.25 s of audio, then silence.
    expect(rms(r, 0.05 * SR, 0.2 * SR)).toBeGreaterThan(0.1);
    expect(peak(r.subarray(Math.round(0.27 * SR)))).toBeLessThan(1e-3);
  });

  it('abrupt sample ends, fast retriggers and steals do not click', () => {
    const s = sine(330, 0.2, 44100, true);
    const r = render([tempo(240), ...samplerTrack(0, s, {}, 'x x x x x x x x x x x x x x x x'), START], 2).left;
    expect(peak(r)).toBeLessThan(1);
    expect(detectClicks(r, SR)).toEqual([]);
    const c = render([tempo(240), ...samplerTrack(0, sine(330, 2, 44100, true), { mode: 'chromatic', root: 60 }, 'C4 E4 G4 C5 C4 E4 G4 C5 C4 E4 G4 C5 C4 E4 G4 C5'), START], 2).left;
    expect(detectClicks(c, SR)).toEqual([]);
  });

  it('replacing a sample while it plays does not click', () => {
    const r = render([tempo(), ...samplerTrack(0, sine(220, 2), {}, 'x'), START], 1, {
      at: [{ time: 0.31, cmd: { type: 'sample', id: 'test', l: sine(550, 1).l, rate: 44100 } }],
    }).left;
    expect(detectClicks(r, SR)).toEqual([]);
  });

  it('resample captures the master from the next bar, matching the output', () => {
    const p = defaultProject();
    const cmds = [...projectCommands(p), START];
    const frames = Math.round(((SR * 60) / p.bpm) * 4); // one bar
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    const out = render(cmds, 6, { at: [{ time: 0.5, cmd: { type: 'resample', id: 'x', source: -1, l, r } }] });
    const done = out.events.find((e) => e.type === 'resampled');
    expect(done).toBeTruthy();
    // Started at bar 2 (the first bar boundary after 0.5 s); equals the pre-limiter output there.
    const bar = Math.round(((SR * 60) / p.bpm) * 4);
    const lat = out.engine.latency;
    let maxErr = 0;
    for (let i = 0; i < frames; i++) maxErr = Math.max(maxErr, Math.abs(l[i]! - out.left[bar + lat + i]!));
    expect(peak(l)).toBeGreaterThan(0.05);
    expect(maxErr).toBeLessThan(0.02); // the limiter may shave peaks slightly
  });

  it('resample of one track captures only that track', () => {
    const p = defaultProject();
    const frames = 24000;
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    const out = render(projectCommands(p), 1, { at: [{ time: 0, cmd: { type: 'trigger', track: 0, vel: 100 } }, { time: 0, cmd: { type: 'resample', id: 'k', source: 0, l, r } }] });
    expect(out.events.some((e) => e.type === 'resampled')).toBe(true);
    expect(peak(l)).toBeGreaterThan(0.1); // the kick
  });
});
