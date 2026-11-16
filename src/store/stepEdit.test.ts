import { describe, expect, it } from 'vitest';
import { parsePattern, formatPattern } from './notation';
import { addNote, extendHold, holdEnd, removeAt } from './stepEdit';
import { noteToMidi } from './notation';

const P = (s: string) => parsePattern(s).steps;
const F = (steps: ReturnType<typeof P>) => formatPattern({ length: 16, steps });

describe('stepEdit', () => {
  it('addNote writes a note and keeps following holds', () => {
    const out = addNote(P('. ~ ~ . . . . . . . . . . . . .'), 0, noteToMidi('C3')!);
    expect(F(out)).toBe('C3 ~ ~ . . . . . . . . . . . . .');
  });
  it('does not mutate its input', () => {
    const src = P('C3 ~ . . . . . . . . . . . . . .');
    const copy = src.slice();
    removeAt(src, 0); extendHold(src, 0, 5); addNote(src, 3, 60);
    expect(src).toEqual(copy);
  });
  it('removeAt removes the note and its holds only', () => {
    expect(F(removeAt(P('C3 ~ ~ D3 ~ . . . . . . . . . . .'), 0))).toBe('. . . D3 ~ . . . . . . . . . . .');
  });
  it('removeAt on a hold shortens from that point', () => {
    expect(F(removeAt(P('C3 ~ ~ ~ . . . . . . . . . . . .'), 2))).toBe('C3 ~ . . . . . . . . . . . . . .');
  });
  it('holdEnd finds the last hold', () => {
    expect(holdEnd(P('C3 ~ ~ . ~ . . . . . . . . . . .'), 0)).toBe(2);
    expect(holdEnd(P('C3 . . . . . . . . . . . . . . .'), 0)).toBe(0);
  });
  it('extendHold lengthens, overwriting notes with holds', () => {
    expect(F(extendHold(P('C3 . D3 . . . . . . . . . . . . .'), 0, 3))).toBe('C3 ~ ~ ~ . . . . . . . . . . . .');
  });
  it('extendHold shortens when dragged back', () => {
    expect(F(extendHold(P('C3 ~ ~ ~ ~ . . . . . . . . . . .'), 0, 2))).toBe('C3 ~ ~ . . . . . . . . . . . . .');
    expect(F(extendHold(P('C3 ~ ~ ~ ~ . . . . . . . . . . .'), 0, 0))).toBe('C3 . . . . . . . . . . . . . . .');
  });
  it('extendHold works for chords and clamps to the pattern end', () => {
    expect(F(extendHold(P('. . . . . . . . . . . . . . Fm* .'), 14, 99))).toBe('. . . . . . . . . . . . . . Fm* ~');
  });
  it('extendHold ignores non-note starts', () => {
    expect(F(extendHold(P('. . . . . . . . . . . . . . . .'), 2, 5))).toBe('. . . . . . . . . . . . . . . .');
  });
});
