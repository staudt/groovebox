import { describe, expect, it } from 'vitest';
import { cents, detectClicks, estimatePitchHz, peak, rms } from '../audio/analysis';
import { ALGORITHMS } from '../../src/engine/fm/algorithms';
import { attackSeconds, decaySeconds } from '../../src/engine/fm/voice';
import { initPatch } from '../../src/store/fmPresets';
import { FM_PRESETS } from '../../src/store/fmPresets';
import type { FmOperator, FmPatch } from '../../src/store/types';
import type { EngineCommand } from '../../src/engine/protocol';
import { fmTrack, render } from './render';

const SR = 48000;
const START: EngineCommand = { type: 'transport', playing: true };
const tempo = (bpm: number): EngineCommand => ({ type: 'tempo', bpm, swing: 50 });
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Patch with only the given operators sounding at the given levels (others level 0). */
function patchWith(algorithm: number, levels: Partial<Record<number, number>>, opOver: Partial<FmOperator> = {}, feedback = 0): FmPatch {
  const p = initPatch();
  p.algorithm = algorithm;
  p.feedback = feedback;
  p.ops = p.ops.map((o, k) => ({ ...o, ratio: 1, level: levels[k + 1] ?? 0, a: 0, d: 0.5, s: 1, r: 0.2, velSens: 0, ...opOver })) as FmPatch['ops'];
  return p;
}

/** Energy of frequency f in buf[start, end) (Goertzel). */
function goertzel(buf: Float32Array, f: number, start: number, end: number): number {
  const w = (2 * Math.PI * f) / SR;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < end; i++) {
    const s0 = buf[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (end - start);
}

/** RMS in consecutive windows of `ms`. */
function envelope(buf: Float32Array, ms: number): number[] {
  const w = Math.round((ms / 1000) * SR);
  const out: number[] = [];
  for (let i = 0; i + w <= buf.length; i += w) out.push(rms(buf, i, i + w));
  return out;
}

describe('FM pitch', () => {
  for (const [note, ratio] of [
    [33, 1],
    [57, 1],
    [69, 1],
    [84, 1],
    [57, 2],
    [45, 0.5],
  ] as const) {
    it(`note ${note} at ratio ${ratio} is within 5 cents`, () => {
      const p = patchWith(1, { 1: 99 }, {});
      p.ops[0] = { ...p.ops[0], ratio };
      const r = render([tempo(60), ...fmTrack(0, p, '. . . .'), { type: 'noteOn', track: 0, note, vel: 100 }], 1);
      const f = estimatePitchHz(r.left, SR, 0.3 * SR, 0.9 * SR);
      expect(Math.abs(cents(f, midiHz(note) * ratio))).toBeLessThan(5);
    });
  }

  it('detune +7 raises the pitch by about 10.5 cents', () => {
    const p = patchWith(1, { 1: 99 }, { detune: 7 });
    const r = render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 69, vel: 100 }], 1);
    const f = estimatePitchHz(r.left, SR, 0.3 * SR, 0.9 * SR);
    expect(cents(f, 440)).toBeGreaterThan(9.5);
    expect(cents(f, 440)).toBeLessThan(11.5);
  });
});

describe('FM algorithms', () => {
  // An operator changes the output exactly when it has a modulation path to a carrier.
  const reaches = (alg: number, op: number): boolean => {
    const a = ALGORITHMS[alg - 1]!;
    if (a.carriers.includes(op)) return true;
    return a.mods.some(([m, t]) => m === op && reaches(alg, t));
  };

  for (let alg = 1; alg <= 32; alg++) {
    it(`algorithm ${alg}: each operator is heard iff it reaches a carrier`, () => {
      const a = ALGORITHMS[alg - 1]!;
      // Every operator on (so chains pass through), non-carriers at a different ratio so a
      // modulator can't hide as a phase shift. Then switch one operator off at a time.
      const all = (without: number): FmPatch => {
        const levels: Record<number, number> = {};
        for (let k = 1; k <= 6; k++) levels[k] = k === without ? 0 : a.carriers.includes(k) ? 90 : 75;
        const p = patchWith(alg, levels);
        p.ops = p.ops.map((o, k) => (a.carriers.includes(k + 1) ? o : { ...o, ratio: 3 })) as FmPatch['ops'];
        return p;
      };
      const play = (p: FmPatch) => render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 57, vel: 100 }], 0.3).left;
      const ref = play(all(0));
      for (let op = 1; op <= 6; op++) {
        if (a.carriers.includes(op)) {
          const alone = play(patchWith(alg, { [op]: 90 }));
          expect(peak(alone), `op ${op} carrier audible`).toBeGreaterThan(0.01);
        }
        const withOp = play(all(op));
        let diff = 0;
        for (let i = 0; i < withOp.length; i++) diff = Math.max(diff, Math.abs(withOp[i]! - ref[i]!));
        if (reaches(alg, op)) expect(diff, `op ${op} should change the output`).toBeGreaterThan(0.01);
        else expect(diff, `op ${op} should not change the output`).toBeLessThan(1e-6);
      }
    });
  }

  it('a modulator adds harmonics (FM), a lone carrier is a pure sine', () => {
    const f0 = midiHz(57);
    const pure = render([...fmTrack(0, patchWith(1, { 1: 99 }), '.'), { type: 'noteOn', track: 0, note: 57, vel: 100 }], 0.5).left;
    const fm = render([...fmTrack(0, patchWith(1, { 1: 99, 2: 80 }), '.'), { type: 'noteOn', track: 0, note: 57, vel: 100 }], 0.5).left;
    const h = (b: Float32Array) => goertzel(b, 2 * f0, 4800, 24000) / goertzel(b, f0, 4800, 24000);
    expect(h(pure)).toBeLessThan(0.01);
    expect(h(fm)).toBeGreaterThan(0.1);
  });

  it('feedback adds harmonics to the feedback operator', () => {
    const f0 = midiHz(57);
    // Algorithm 32: op 6 is a carrier with feedback.
    const off = render([...fmTrack(0, patchWith(32, { 6: 99 }, {}, 0), '.'), { type: 'noteOn', track: 0, note: 57, vel: 100 }], 0.5).left;
    const on = render([...fmTrack(0, patchWith(32, { 6: 99 }, {}, 7), '.'), { type: 'noteOn', track: 0, note: 57, vel: 100 }], 0.5).left;
    const h = (b: Float32Array) => goertzel(b, 2 * f0, 4800, 24000) / goertzel(b, f0, 4800, 24000);
    expect(h(off)).toBeLessThan(0.01);
    expect(h(on)).toBeGreaterThan(0.1);
  });
});

describe('FM envelopes', () => {
  it('attack time: reaches full level after the attack, not before', () => {
    const a = 0.5;
    const secs = attackSeconds(a);
    const p = patchWith(1, { 1: 99 }, { a, d: 0.5, s: 1 });
    const r = render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 69, vel: 100 }], secs + 0.3);
    const env = envelope(r.left, 5);
    const full = Math.max(...env);
    const at = (t: number) => env[Math.floor((t * 1000) / 5)]!;
    expect(at(secs * 0.5) / full).toBeGreaterThan(0.35);
    expect(at(secs * 0.5) / full).toBeLessThan(0.65);
    expect(at(secs + 0.05) / full).toBeGreaterThan(0.95);
  });

  it('decay falls to the sustain level and stays there', () => {
    // d 0.6 = about 0.64 s to settle, so the first 10 ms window is still at full level.
    const p = patchWith(1, { 1: 99 }, { a: 0, d: 0.6, s: 0.5 });
    const r = render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 69, vel: 100 }], 4);
    const env = envelope(r.left, 10);
    const early = env[1]!;
    const late = env.at(-5)!;
    // s 0.5 = -24 dB.
    expect(20 * Math.log10(late / early)).toBeGreaterThan(-26);
    expect(20 * Math.log10(late / early)).toBeLessThan(-22);
    expect(Math.abs(env.at(-1)! - env.at(-20)!) / late).toBeLessThan(0.02);
  });

  it('release: silent about decaySeconds(r) after note off', () => {
    const rParam = 0.3;
    const relS = decaySeconds(rParam);
    const p = patchWith(1, { 1: 99 }, { a: 0, s: 1, r: rParam });
    const r = render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 69, vel: 100 }], 0.5 + relS + 0.2, {
      at: [{ time: 0.5, cmd: { type: 'noteOff', track: 0, note: 69 } }],
    });
    const env = envelope(r.left, 5);
    const held = env[80]!; // 0.4 s
    const after = env[Math.floor(((0.5 + relS) * 1000) / 5) + 4]!;
    expect(after / held).toBeLessThan(0.002); // past -54 dB
    expect(detectClicks(r.left, SR)).toEqual([]);
  });
});

describe('FM sequencing', () => {
  it('holds extend the note: C4 ~ ~ ~ sounds through step 4, C4 alone releases after step 1', () => {
    const p = patchWith(1, { 1: 99 }, { a: 0, s: 1, r: 0.05 });
    const stepS = 60 / 120 / 4;
    const held = render([tempo(120), ...fmTrack(0, p, 'C4 ~ ~ ~ . . . . . . . . . . . .'), START], 1).left;
    const short = render([tempo(120), ...fmTrack(0, p, 'C4 . . . . . . . . . . . . . . .'), START], 1).left;
    const at = (b: Float32Array, steps: number) => rms(b, Math.round(steps * stepS * SR), Math.round((steps + 0.3) * stepS * SR));
    expect(at(held, 3.2) / at(held, 0.5)).toBeGreaterThan(0.9);
    expect(at(short, 3.2) / at(short, 0.5)).toBeLessThan(0.01);
    expect(at(held, 5) / at(held, 0.5)).toBeLessThan(0.01);
  });

  it('a chord step plays all its notes', () => {
    const p = patchWith(1, { 1: 99 }, { a: 0, s: 1 });
    const r = render([tempo(120), ...fmTrack(0, p, 'Cm* ~ ~ ~'), START], 0.6).left;
    // Cm in octave 3: C3 Eb3 G3. A3 is far enough from all three for a clean comparison.
    const e = (m: number) => goertzel(r, midiHz(m), 2400, 21600);
    const notIn = e(57);
    for (const m of [48, 51, 55]) expect(e(m), `note ${m}`).toBeGreaterThan(notIn * 10);
  });

  it('note onsets land on the grid (within 1 ms)', () => {
    const p = patchWith(1, { 1: 99 }, { a: 0, d: 0.1, s: 0, r: 0 });
    const r = render([tempo(150), ...fmTrack(0, p, 'C5 . . . C5 . . . C5 . . . C5 . . .'), START], 3.3);
    const lat = r.engine.latency;
    const stepF = (SR * 60) / 150 / 4;
    let found = 0;
    for (let k = 0; k < 8; k++) {
      const expected = Math.round(k * 4 * stepF + lat);
      let first = -1;
      for (let i = expected - 200; i < expected + 200; i++) if (Math.abs(r.left[i]!) > 1e-3) { first = i; break; }
      if (first >= 0) found++;
      expect(Math.abs(first - expected) / SR).toBeLessThan(0.001);
    }
    expect(found).toBe(8);
  });

  it('stop releases sequenced notes (no stuck pad)', () => {
    const p = FM_PRESETS.find((x) => x.name === 'Soft Pad')!;
    const r = render([tempo(120), ...fmTrack(0, p, 'Cm* ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~'), START], 8, {
      at: [{ time: 1, cmd: { type: 'transport', playing: false } }],
    });
    const tail = r.left.subarray(7 * SR);
    expect(peak(tail)).toBeLessThan(1e-3);
  });
});

describe('FM voices', () => {
  it('more than 8 live notes steal voices without clicks or overload', () => {
    const p = patchWith(1, { 1: 99 }, { a: 0, s: 1, r: 0.5 });
    const at = Array.from({ length: 14 }, (_, k) => ({ time: 0.05 + k * 0.03, cmd: { type: 'noteOn', track: 0, note: 48 + k, vel: 100 } as EngineCommand }));
    const r = render([...fmTrack(0, p, '.')], 1.2, { at });
    expect(peak(r.left)).toBeLessThan(1);
    expect(detectClicks(r.left, SR)).toEqual([]);
  });

  it('allNotesOff releases live notes only', () => {
    const p = patchWith(1, { 1: 99 }, { a: 0, s: 1, r: 0.1 });
    const r = render([...fmTrack(0, p, '.'), { type: 'noteOn', track: 0, note: 60, vel: 100 }, { type: 'noteOn', track: 0, note: 64, vel: 100 }], 1.5, {
      at: [{ time: 0.5, cmd: { type: 'allNotesOff', track: 0 } }],
    });
    expect(rms(r.left, 0.3 * SR, 0.45 * SR)).toBeGreaterThan(0.05);
    expect(peak(r.left.subarray(1.2 * SR))).toBeLessThan(1e-4);
  });

  it('every factory preset plays, stays under 0 dBFS and does not click', () => {
    for (const p of FM_PRESETS) {
      const r = render([tempo(120), ...fmTrack(0, p, 'C3 ~ . Eb3 G3 ~ ~ ~ C4 . Bb3 ~ G3 . . .'), START], 3);
      expect(peak(r.left), p.name).toBeGreaterThan(0.05);
      expect(peak(r.left), p.name).toBeLessThan(1);
      expect(detectClicks(r.left, SR), p.name).toEqual([]);
    }
  });
});
