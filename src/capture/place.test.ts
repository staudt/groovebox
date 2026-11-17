import { describe, expect, it } from 'vitest';
import { buildPlacement, chordSummary, patternLengthFor, repeatOptions } from './place';
import { formatPattern } from '../store/notation';
import type { GridNote } from './types';
import type { HarmonyResult } from '../harmony/types';

const melody: GridNote[] = [
  { step: 0, length: 4, midi: 67, velocity: 100 },
  { step: 4, length: 2, midi: 68, velocity: 90 },
  { step: 8, length: 8, midi: 65, velocity: 100 },
];
const harmony: HarmonyResult = {
  chords: [
    { step: 0, length: 8, symbol: 'Cm', degree: 1, notes: [48, 51, 55], bass: 36 },
    { step: 8, length: 8, symbol: 'Ab', degree: 6, notes: [44, 48, 51], bass: 32 },
  ],
  second: [{ step: 4, length: 2, midi: 63, velocity: 90 }],
  ms: 1,
};

describe('place helpers', () => {
  it('repeat options and pattern lengths', () => {
    expect(repeatOptions(16)).toEqual([1, 2, 4]);
    expect(repeatOptions(32)).toEqual([1, 2]);
    expect(repeatOptions(64)).toEqual([1]);
    expect(repeatOptions(128)).toEqual([1]);
    expect(patternLengthFor(16, 1)).toBe(16);
    expect(patternLengthFor(16, 2)).toBe(32);
    expect(patternLengthFor(32, 2)).toBe(64);
    expect(patternLengthFor(128, 1)).toBe(64);
  });

  it('writes notes with holds, tiled by repeat', () => {
    const p = buildPlacement({ melody, melodySteps: 16, repeat: 2, harmony: null, parts: { bass: false, pad: false, second: false } });
    expect(p.length).toBe(32);
    expect(formatPattern({ length: 32, steps: p.melody })).toBe('G4 ~ ~ ~ Ab4:90 ~ . . F4 ~ ~ ~ ~ ~ ~ ~ G4 ~ ~ ~ Ab4:90 ~ . . F4 ~ ~ ~ ~ ~ ~ ~');
    expect(p.pad).toBeNull();
    expect(p.bass).toBeNull();
  });

  it('adds pad chords, bass roots and the second voice as two-note chord steps', () => {
    const p = buildPlacement({ melody, melodySteps: 16, repeat: 1, harmony, parts: { bass: true, pad: true, second: true } });
    expect(p.melody[4]).toEqual({ t: 'chord', notes: [63, 68], symbol: 'Ab4', vel: 90 });
    expect(p.melody[0]).toEqual({ t: 'note', note: 67, vel: 100 });
    expect(p.pad![0]).toMatchObject({ t: 'chord', symbol: 'Cm', notes: [48, 51, 55] });
    expect(p.pad![1]).toEqual({ t: 'hold' });
    expect(p.pad![8]).toMatchObject({ t: 'chord', symbol: 'Ab' });
    expect(p.bass![0]).toEqual({ t: 'note', note: 36, vel: 100 });
    expect(p.bass![8]).toEqual({ t: 'note', note: 32, vel: 100 });
  });

  it('summarizes chords', () => {
    expect(chordSummary(harmony)).toBe('Cm · Ab');
  });
});
