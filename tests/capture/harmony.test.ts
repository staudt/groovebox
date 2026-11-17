import { describe, expect, it } from 'vitest';
import { harmonize } from '../../src/harmony/engine';
import { inScale } from '../../src/harmony/theory';
import type { GridNote } from '../../src/capture/types';

/** One note per quarter: [step, midi] for bars of 16 steps. */
const mel = (notes: [number, number][], length = 4): GridNote[] => notes.map(([step, midi]) => ({ step, length, midi, velocity: 100 }));

describe('harmony engine', () => {
  it('finds I IV V I under an arpeggiated C major melody (pop)', () => {
    const m = mel([[0, 72], [4, 76], [8, 79], [12, 76], [16, 77], [20, 81], [24, 84], [28, 81], [32, 79], [36, 83], [40, 86], [44, 83], [48, 72], [52, 76], [56, 79], [60, 84]]);
    const r = harmonize({ melody: m, key: 0, scale: 'major', style: 'pop', steps: 64 });
    expect(r.chords.map((c) => c.symbol)).toEqual(['C', 'F', 'G', 'C']);
  });

  it('C minor melody on Eb G C gets Cm', () => {
    const r = harmonize({ melody: mel([[0, 63], [4, 67], [8, 72], [12, 67]]), key: 0, scale: 'minor', style: 'melancholy', steps: 16 });
    expect(r.chords[0]!.symbol).toBe('Cm');
  });

  it('is deterministic and fast (8 bars, half-bar chords, < 50 ms)', () => {
    const m = mel(Array.from({ length: 32 }, (_, i) => [i * 4, 60 + ((i * 7) % 12)] as [number, number]));
    const a = harmonize({ melody: m, key: 0, scale: 'minor', style: 'jazzy', steps: 128, segment: 8 });
    const b = harmonize({ melody: m, key: 0, scale: 'minor', style: 'jazzy', steps: 128, segment: 8 });
    expect(JSON.stringify({ ...a, ms: 0 })).toBe(JSON.stringify({ ...b, ms: 0 }));
    expect(a.chords.length).toBe(16);
    // Warm runs are far below the budget; measure the worst of several.
    let worst = 0;
    for (let i = 0; i < 20; i++) worst = Math.max(worst, harmonize({ melody: m, key: 5, scale: 'major', style: 'pop', steps: 128, segment: 8 }).ms);
    expect(worst).toBeLessThan(50);
  });

  it('styles differ: jazzy uses sevenths, pop does not', () => {
    const m = mel([[0, 60], [8, 62], [16, 64], [24, 65], [32, 67], [40, 65], [48, 64], [56, 62]], 8);
    const pop = harmonize({ melody: m, key: 0, scale: 'major', style: 'pop', steps: 64 }).chords.map((c) => c.symbol);
    const jazz = harmonize({ melody: m, key: 0, scale: 'major', style: 'jazzy', steps: 64 }).chords.map((c) => c.symbol);
    expect(pop.some((s) => /7/.test(s))).toBe(false);
    expect(jazz.some((s) => /7/.test(s))).toBe(true);
    expect(pop).not.toEqual(jazz);
  });

  it('voicings stay in range and move little; bass is the root in octave 2', () => {
    const m = mel([[0, 72], [16, 77], [32, 79], [48, 72]], 16);
    const r = harmonize({ melody: m, key: 0, scale: 'major', style: 'pop', steps: 64 });
    for (const c of r.chords) {
      for (const n of c.notes) {
        expect(n).toBeGreaterThanOrEqual(48);
        expect(n).toBeLessThanOrEqual(74);
      }
      expect(c.bass).toBeGreaterThanOrEqual(36);
      expect(c.bass).toBeLessThanOrEqual(47);
    }
    for (let i = 1; i < r.chords.length; i++) {
      const a = r.chords[i - 1]!.notes;
      const b = r.chords[i]!.notes;
      const move = a.reduce((s, x, k) => s + Math.abs(x - (b[k] ?? b[b.length - 1]!)), 0);
      expect(move, `${r.chords[i - 1]!.symbol} -> ${r.chords[i]!.symbol}`).toBeLessThanOrEqual(8);
    }
  });

  it('second voice is in key, 3 to 9 semitones below the melody', () => {
    const m = mel([[0, 72], [4, 74], [8, 75], [12, 77], [16, 79], [20, 77], [24, 75], [28, 74]]);
    const r = harmonize({ melody: m, key: 0, scale: 'minor', style: 'pop', steps: 32 });
    r.second.forEach((s, i) => {
      expect(inScale(s.midi, 0, 'minor')).toBe(true);
      const d = m[i]!.midi - s.midi;
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(9);
    });
  });
});
