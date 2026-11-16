// Text notation, one token per step:
//   .  rest      x  hit (vel 100)   x64  hit with velocity 64
//   G4 note (sharps or flats, Ab4 / G#4), optional velocity suffix ":80"
//   ~  hold      Fm*  chord (symbol only; notes resolved by the harmony engine / chord tables)
// Example: "G4 ~ Ab4 G4 F4 ~ Eb4 ~ Fm* ~ ~ ~ C5 ~ Bb4 ~"
import type { Midi, Pattern, PatternLength, Step } from './types';

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_VEL = 100;

/** Note name to MIDI (C4 = 60). Returns null if not a note name. */
export function noteToMidi(name: string): Midi | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const base = LETTER[m[1]!]!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function midiToNote(midi: Midi, flats = true): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return (flats ? NAMES_FLAT : NAMES_SHARP)[pc]! + oct;
}

export function parseStep(tok: string): Step {
  if (tok === '.') return { t: 'rest' };
  if (tok === '~') return { t: 'hold' };
  const hit = /^x(\d{1,3})?$/.exec(tok);
  if (hit) return { t: 'hit', vel: hit[1] ? Number(hit[1]) : DEFAULT_VEL };
  if (tok.endsWith('*')) return { t: 'chord', notes: [], symbol: tok.slice(0, -1), vel: DEFAULT_VEL };
  const [name, vel] = tok.split(':');
  const midi = noteToMidi(name!);
  if (midi !== null) return { t: 'note', note: midi, vel: vel ? Number(vel) : DEFAULT_VEL };
  throw new Error(`Bad pattern token: "${tok}"`);
}

export function formatStep(s: Step): string {
  switch (s.t) {
    case 'rest':
      return '.';
    case 'hold':
      return '~';
    case 'hit':
      return s.vel === DEFAULT_VEL ? 'x' : `x${s.vel}`;
    case 'note':
      return s.vel === DEFAULT_VEL ? midiToNote(s.note) : `${midiToNote(s.note)}:${s.vel}`;
    case 'chord':
      return `${s.symbol}*`;
  }
}

/** Parses whitespace-separated tokens. Pads with rests to `length` (default: 16, 32 or 64, whichever fits). */
export function parsePattern(text: string, length?: PatternLength): Pattern {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  const len: PatternLength = length ?? (toks.length <= 16 ? 16 : toks.length <= 32 ? 32 : 64);
  if (toks.length > len) throw new Error(`Pattern has ${toks.length} steps, more than ${len}`);
  const steps: Step[] = toks.map(parseStep);
  while (steps.length < len) steps.push({ t: 'rest' });
  return { length: len, steps };
}

export function formatPattern(p: Pattern): string {
  return p.steps.slice(0, p.length).map(formatStep).join(' ');
}
