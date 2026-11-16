import { describe, expect, it } from 'vitest';
import { parsePattern, formatPattern } from './notation';
import { euclid } from './euclid';
import { countOnsets, rhythmize, shiftSteps } from './rhythm';
import type { Step } from './types';

const hit: Step = { t: 'hit', vel: 100 };
const steps = (s: string) => parsePattern(s, 16).steps;
const fmt = (s: Step[]) => formatPattern({ length: 16, steps: s });

describe('rhythmize', () => {
  it('keeps melody order across the new euclid positions', () => {
    const base = steps('C3 . Eb3 . G3 . . . . . . . . . . .');
    const out = rhythmize(base, 8, 0, hit);
    const pos = euclid(8, 16, 0).flatMap((b, i) => (b ? [i] : []));
    const names = pos.map((i) => fmt([out[i]!]));
    expect(names).toEqual(['C3', 'Eb3', 'G3', 'C3', 'Eb3', 'G3', 'C3', 'Eb3']);
    expect(out.filter((s) => s.t === 'rest')).toHaveLength(8);
  });
  it('drops holds', () => {
    const out = rhythmize(steps('C3 ~ ~ ~ G3 ~ ~ ~ . . . . . . . .'), 4, 0, hit);
    expect(out.some((s) => s.t === 'hold')).toBe(false);
  });
  it('keeps velocity, chance and chords', () => {
    const base: Step[] = Array.from({ length: 16 }, () => ({ t: 'rest' }) as Step);
    base[2] = { t: 'hit', vel: 60, chance: 50 };
    base[5] = { t: 'chord', notes: [48, 51, 55], symbol: 'Cm', vel: 90 };
    const out = rhythmize(base, 2, 0, hit);
    expect(out[0]).toEqual(base[2]);
    expect(out[8]).toEqual(base[5]);
  });
  it('uses the fallback when base has no onsets', () => {
    const fb: Step = { t: 'note', note: 48, vel: 100 };
    const out = rhythmize(steps('. . . . . . . . . . . . . . . .'), 4, 0, fb);
    expect(out.filter((s) => s === fb)).toHaveLength(4);
  });
  it('0 hits gives all rests', () => {
    expect(rhythmize(steps('x x x x . . . . . . . . . . . .'), 0, 3, hit).every((s) => s.t === 'rest')).toBe(true);
  });
  it('counts onsets', () => expect(countOnsets(steps('x . C3 ~ Fm* . . . . . . . . . . .'))).toBe(3));
});

describe('shiftSteps', () => {
  it('moves holds with their notes and wraps', () => {
    expect(fmt(shiftSteps(steps('C3 ~ . . . . . . . . . . . . . .'), 1))).toBe('. C3 ~ . . . . . . . . . . . . .');
    expect(fmt(shiftSteps(steps('. . . . . . . . . . . . . . . C3'), 1))).toBe('C3 . . . . . . . . . . . . . . .');
    expect(fmt(shiftSteps(steps('C3 . . . . . . . . . . . . . . .'), -1))).toBe('. . . . . . . . . . . . . . . C3');
  });
});
