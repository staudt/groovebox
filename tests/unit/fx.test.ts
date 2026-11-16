// Punch-in FX and send effects, rendered offline and measured.
import { describe, expect, it } from 'vitest';
import { detectClicks, peak, rms } from '../audio/analysis';
import { initPatch } from '../../src/store/fmPresets';
import type { EngineCommand } from '../../src/engine/protocol';
import { FX_IDS, type FxId } from '../../src/engine/fx/ids';
import type { FmPatch } from '../../src/store/types';
import { drumTrack, fmTrack, projectCommands, render } from './render';
import { defaultProject } from '../../src/store/defaults';

const SR = 48000;
const BPM = 120;
const STEP = (SR * 60) / BPM / 4; // 6000 samples per 16th
const START: EngineCommand = { type: 'transport', playing: true };

/**
 * A sustained 1 kHz sine (FM track 3, one carrier, sustain 1) held from t=0.
 * 1 kHz at 48 kHz is exactly 48 samples per period, so 1 ms RMS windows read a steady level.
 */
function sinePad(): EngineCommand[] {
  const p: FmPatch = initPatch();
  p.ops[0] = { ...p.ops[0], ratio: 1000 / 440, a: 0, d: 0.5, s: 1, r: 0.2, velSens: 0 };
  return [...fmTrack(3, p, '.'), { type: 'noteOn', track: 3, note: 69, vel: 100 }];
}
const fx = (id: FxId, on: boolean, time: number, target = -1, x?: number, y?: number) => ({
  time,
  cmd: { type: 'fx', fx: id, on, target, ...(x !== undefined ? { x, y } : {}) } as EngineCommand,
});

describe('gate', () => {
  it('starts on the next 1/16 after the press and its edges sit on the grid (within 1 ms)', () => {
    const pressAt = 0.3; // between steps 2 (0.25 s) and 3 (0.375 s)
    const r = render([{ type: 'tempo', bpm: BPM, swing: 50 }, ...sinePad(), START], 1.2, { at: [fx('gate', true, pressAt, -1, 0.5, 1)] });
    const lat = r.engine.latency;
    const B = 3 * STEP; // next 16th boundary after 0.3 s
    const env = (i: number) => rms(r.left, i - 24, i + 24); // 1 ms window centered at i
    const open = env(B + lat + 1500);
    // Before the boundary the signal is untouched.
    expect(rms(r.left, Math.round(pressAt * SR) + lat + 500, B + lat - 500) / open).toBeGreaterThan(0.95);
    // Gate 1/16 at full depth: closes half a step after each boundary, reopens on the next boundary.
    for (let k = 0; k < 4; k++) {
      const close = B + k * STEP + STEP / 2 + lat;
      const reopen = B + (k + 1) * STEP + lat;
      const half = (from: number, dir: -1 | 1) => {
        for (let i = from - 48; i < from + 200; i += 4) {
          const v = env(i) / open;
          if (dir < 0 ? v < 0.5 : v > 0.5) return i;
        }
        return -1;
      };
      const c = half(close, -1);
      const o = half(reopen, 1);
      expect((c - close) / SR, `close ${k}`).toBeGreaterThanOrEqual(-0.0002);
      expect((c - close) / SR, `close ${k}`).toBeLessThan(0.001);
      expect((o - reopen) / SR, `reopen ${k}`).toBeGreaterThanOrEqual(-0.0002);
      expect((o - reopen) / SR, `reopen ${k}`).toBeLessThan(0.001);
    }
    expect(detectClicks(r.left, SR)).toEqual([]);
  });
});

describe('stutter', () => {
  it('captures from the next 1/16 boundary and repeats it exactly (sample-accurate loop)', () => {
    const cmds: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...drumTrack(0, 'hat', 'x x x x x x x x x x x x x x x x', { decay: 0.4 }), ...sinePad(), START];
    const dry = render(cmds, 2).left;
    const r = render(cmds, 2, { at: [fx('stutter8', true, 0.3, -1, 0, 0)] }).left; // 1/8 = 2 steps, no decay
    const lat = 72;
    const B = 3 * STEP + lat;
    const L = 2 * STEP;
    // Before the boundary: identical to the dry render.
    for (let i = 0; i < B - 1; i++) expect(Math.abs(r[i]! - dry[i]!)).toBeLessThan(1e-6);
    // The loop content is the dry audio starting exactly at B: every later repeat equals it
    // (skip the 5 ms press ramp and the 2 ms window edges).
    const edge = 96;
    for (let rep = 1; rep <= 3; rep++) {
      let maxErr = 0;
      for (let j = 300; j < L - edge; j++) maxErr = Math.max(maxErr, Math.abs(r[B + rep * L + j]! - dry[B + j]!));
      expect(maxErr, `repeat ${rep}`).toBeLessThan(1e-4);
    }
    expect(detectClicks(r, SR)).toEqual([]);
  });

  it('feedback (y) makes each repeat quieter', () => {
    const cmds: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...sinePad(), START];
    const r = render(cmds, 2, { at: [fx('stutter16', true, 0.01, -1, 0, 1)] }).left;
    const B = STEP + 72;
    const a = rms(r, B + 3 * STEP + 200, B + 4 * STEP - 200);
    const b = rms(r, B + 6 * STEP + 200, B + 7 * STEP - 200);
    expect(b / a).toBeLessThan(0.5);
  });
});

describe('reverse', () => {
  it('plays the beat before the press backwards', () => {
    const cmds: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...drumTrack(0, 'hat', 'x . x x . . x . x x . x . . x .', { decay: 0.3 }), START];
    const dry = render(cmds, 3).left;
    const r = render(cmds, 3, { at: [fx('reverse', true, 1.01, -1, 0, 1)] }).left; // 1 beat, full mix
    const lat = 72;
    const B = 9 * STEP + lat; // next 16th after 1.01 s at 120 BPM is step 9 (1.125 s)
    const L = 4 * STEP;
    let maxErr = 0;
    for (let j = 300; j < L - 96; j++) maxErr = Math.max(maxErr, Math.abs(r[B + j]! - dry[B - 1 - j]!));
    expect(maxErr).toBeLessThan(1e-4);
  });
});

describe('all effects', () => {
  for (const id of FX_IDS) {
    it(`${id}: press and release mid-groove without clicks or overs, and it changes the sound`, () => {
      const cmds = [...projectCommands(defaultProject()), START];
      const dry = render(cmds, 3).left;
      const r = render(cmds, 3, { at: [fx(id, true, 0.71), fx(id, false, 1.93)] });
      expect(peak(r.left)).toBeLessThan(1);
      expect(peak(r.right)).toBeLessThan(1);
      // Lo-fi's sample-and-hold staircase is the effect itself; check its press and release fades only.
      const ok = (i: number) => id !== 'lofi' || i < 0.71 * SR + 72 + 240 || i > 1.93 * SR + 72 + 240;
      expect(detectClicks(r.left, SR).filter(ok), id).toEqual([]);
      expect(detectClicks(r.right, SR).filter(ok), id).toEqual([]);
      let diff = 0;
      for (let i = Math.round(0.8 * SR); i < Math.round(1.9 * SR); i++) diff = Math.max(diff, Math.abs(r.left[i]! - dry[i]!));
      expect(diff, id).toBeGreaterThan(0.01);
    });
  }

  it('effects on a track leave the other tracks untouched', () => {
    // Track 0 has nothing to play; the hats on track 2 must come through bit-identical.
    const cmds: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...drumTrack(0, 'kick', '.'), ...drumTrack(2, 'hat', 'x x x x x x x x x x x x x x x x'), START];
    const dry = render(cmds, 1.5).left;
    const r = render(cmds, 1.5, { at: [fx('lowSweep', true, 0.2, 0), fx('lofi', true, 0.3, 0)] }).left;
    let diff = 0;
    for (let i = 0; i < r.length; i++) diff = Math.max(diff, Math.abs(r[i]! - dry[i]!));
    expect(diff).toBeLessThan(1e-6);
  });
});

describe('sends and throws', () => {
  it('Space (reverb send) leaves a tail after the sound stops', () => {
    const base: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...drumTrack(1, 'snare', 'x . . . . . . . . . . . . . . .')];
    const dry = render([...base, START], 1.5).left;
    const wet = render([...base, { type: 'sends', track: 1, a: 0.6, b: 0 }, START], 1.5).left;
    // Full send puts the wet signal about 9 dB under the dry snare, decaying with RT60 2.2 s.
    const tail = (b: Float32Array) => rms(b, Math.round(0.5 * SR), Math.round(1.0 * SR));
    expect(tail(dry)).toBeLessThan(1e-5);
    expect(tail(wet)).toBeGreaterThan(5e-4);
  });

  it('delay send repeats on the dotted 1/8 at the project tempo', () => {
    const base: EngineCommand[] = [{ type: 'tempo', bpm: BPM, swing: 50 }, ...drumTrack(2, 'hat', 'x . . . . . . . . . . . . . . .', { decay: 0 })];
    const r = render([...base, { type: 'sends', track: 2, a: 0, b: 0.8 }, START], 1.2).left;
    const echo = 3 * STEP + 72; // first echo, dotted 1/8 after the hit
    expect(rms(r, echo, echo + 1200)).toBeGreaterThan(5 * rms(r, echo - 3000, echo - 1800));
  });

  it('reverb throw keeps ringing after release', () => {
    const cmds = [...projectCommands(defaultProject()), START];
    const stopAll: EngineCommand[] = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => ({ type: 'mute', track: t, mute: true }) as EngineCommand);
    const muteAt = 1.6;
    const plain = render(cmds, 2.6, { at: stopAll.map((cmd) => ({ time: muteAt, cmd })) }).left;
    const thrown = render(cmds, 2.6, { at: [fx('reverbThrow', true, 0.8), fx('reverbThrow', false, 1.5), ...stopAll.map((cmd) => ({ time: muteAt, cmd }))] }).left;
    const tail = (b: Float32Array) => rms(b, Math.round(1.9 * SR), Math.round(2.5 * SR));
    expect(tail(thrown)).toBeGreaterThan(10 * tail(plain) + 1e-4);
  });

  it('tape stop slows to silence', () => {
    const r = render([{ type: 'tempo', bpm: BPM, swing: 50 }, ...sinePad(), START], 2.5, { at: [fx('tapeStop', true, 0.2, -1, 1, 0.5)] }).left;
    // x = 1: stops in 0.2 s.
    expect(rms(r, Math.round(0.6 * SR), Math.round(1.0 * SR))).toBeLessThan(1e-3);
    expect(detectClicks(r, SR)).toEqual([]);
  });
});
