import { beforeEach, describe, expect, it } from 'vitest';
import { formatPattern, midiToNote, noteToMidi, parsePattern } from '../../src/store/notation';
import { apply, canRedo, canUndo, project, redo, resetProject, undo } from '../../src/store/project';
import type { DrumParams } from '../../src/store/types';

describe('notation', () => {
  it('round-trips the spec example', () => {
    const text = 'G4 ~ Ab4 G4 F4 ~ Eb4 ~ Fm* ~ ~ ~ C5 ~ Bb4 ~';
    const p = parsePattern(text);
    expect(p.length).toBe(16);
    expect(formatPattern(p)).toBe(text);
  });
  it('parses hits with velocity and pads with rests', () => {
    const p = parsePattern('x x40 .');
    expect(p.steps.slice(0, 3)).toEqual([{ t: 'hit', vel: 100 }, { t: 'hit', vel: 40 }, { t: 'rest' }]);
    expect(formatPattern(p)).toBe('x x40 ' + Array(14).fill('.').join(' '));
  });
  it('maps note names to MIDI', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('G#3')).toBe(noteToMidi('Ab3'));
    expect(midiToNote(70)).toBe('Bb4');
  });
  it('chooses the length and rejects bad tokens', () => {
    expect(parsePattern(Array(20).fill('x').join(' ')).length).toBe(32);
    expect(() => parsePattern('x q')).toThrow();
  });
});

describe('store commands', () => {
  beforeEach(() => resetProject());

  it('setStep undoes and redoes', () => {
    const before = formatPattern(project.value.tracks[0]!.patterns.A);
    apply({ type: 'setStep', track: 0, pattern: 'A', index: 1, step: { t: 'hit', vel: 70 } });
    const after = formatPattern(project.value.tracks[0]!.patterns.A);
    expect(after).not.toBe(before);
    expect(canUndo.value).toBe(true);
    undo();
    expect(formatPattern(project.value.tracks[0]!.patterns.A)).toBe(before);
    expect(canRedo.value).toBe(true);
    redo();
    expect(formatPattern(project.value.tracks[0]!.patterns.A)).toBe(after);
  });

  it('a merged drag is a single undo step', () => {
    const start = project.value.tracks[0]!.macros[0].value;
    apply({ type: 'setMacro', track: 0, macro: 0, value: 0.1 });
    apply({ type: 'setMacro', track: 0, macro: 0, value: 0.2 }, { merge: true });
    apply({ type: 'setMacro', track: 0, macro: 0, value: 0.3 }, { merge: true });
    expect((project.value.tracks[0]!.params as DrumParams).tone).toBe(0.3);
    undo();
    expect(project.value.tracks[0]!.macros[0].value).toBe(start);
    expect((project.value.tracks[0]!.params as DrumParams).tone).toBe(start);
  });

  it('clamps BPM and swing', () => {
    apply({ type: 'setBpm', bpm: 999 });
    apply({ type: 'setSwing', swing: 10 });
    expect(project.value.bpm).toBe(240);
    expect(project.value.swing).toBe(50);
  });

  it('a multi-command group undoes together', () => {
    const before = project.value;
    apply([
      { type: 'setBpm', bpm: 100 },
      { type: 'setMute', track: 2, mute: true },
    ]);
    undo();
    expect(project.value.bpm).toBe(before.bpm);
    expect(project.value.tracks[2]!.mute).toBe(false);
  });
});
