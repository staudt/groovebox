import { describe, expect, it } from 'vitest';
import { chordNotes, diatonicChords, inScale, parseChord, scalePcs } from '../../src/harmony/theory';

describe('theory', () => {
  it('C minor scale and membership', () => {
    expect(scalePcs(0, 'minor')).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(inScale(63, 0, 'minor')).toBe(true); // Eb4
    expect(inScale(64, 0, 'minor')).toBe(false); // E4
  });
  it('diatonic triads and sevenths', () => {
    expect(diatonicChords(0, 'major').map((c) => c.symbol)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(diatonicChords(0, 'minor').map((c) => c.symbol)).toEqual(['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb']);
    expect(diatonicChords(0, 'major', true).map((c) => c.symbol)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7b5']);
    expect(diatonicChords(9, 'minor').map((c) => c.symbol)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
    expect(diatonicChords(2, 'dorian').map((c) => c.symbol)[3]).toBe('G');
  });
  it('chord parsing and voicing', () => {
    expect(parseChord('Bb7')).toEqual({ root: 10, intervals: [0, 4, 7, 10] });
    expect(parseChord('X')).toBeNull();
    expect(chordNotes('Fm')).toEqual([53, 56, 60]);
    expect(chordNotes('C#maj7', 60)).toEqual([61, 65, 68, 72]);
  });
});
