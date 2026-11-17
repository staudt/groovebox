// Pure helpers for the Place screen: how a captured melody (and optional harmony parts) becomes
// pattern steps. No DOM, no store access.
import type { GridNote } from './types';
import type { HarmonyResult } from '../harmony/types';
import type { PatternLength, Step } from '../store/types';
import { midiToNote } from '../store/notation';

export type Parts = { bass: boolean; pad: boolean; second: boolean };

export const PATTERN_LENGTHS: readonly PatternLength[] = [16, 32, 64];

/** How many times a melody of `melodySteps` can repeat inside one pattern (1, 2, 4...). */
export function repeatOptions(melodySteps: number): number[] {
  const out: number[] = [];
  for (let n = 1; melodySteps * n <= 64; n *= 2) out.push(n);
  return out.length ? out : [1];
}

/** Smallest legal pattern length that holds `melodySteps * repeat` steps (melodies over 64 steps are cut). */
export function patternLengthFor(melodySteps: number, repeat: number): PatternLength {
  const need = melodySteps * repeat;
  return PATTERN_LENGTHS.find((l) => l >= need) ?? 64;
}

const rest = (): Step => ({ t: 'rest' });

function writeNote(steps: Step[], at: number, len: number, step: Step): void {
  if (at < 0 || at >= steps.length) return;
  steps[at] = step;
  for (let k = 1; k < len && at + k < steps.length; k++) steps[at + k] = { t: 'hold' };
}

export type Placement = { length: PatternLength; melody: Step[]; pad: Step[] | null; bass: Step[] | null };

/**
 * Builds the steps for the melody track (with the 2nd voice merged in as two-note chord steps),
 * PAD (chord steps and holds) and BASS (root notes and holds). The material is `melodySteps` long and
 * tiled `repeat` times; everything is cut at the pattern length.
 */
export function buildPlacement(args: { melody: GridNote[]; melodySteps: number; repeat: number; harmony: HarmonyResult | null; parts: Parts }): Placement {
  const { melody, melodySteps, repeat, harmony, parts } = args;
  const length = patternLengthFor(melodySteps, repeat);
  const mel: Step[] = Array.from({ length }, rest);
  const pad: Step[] = Array.from({ length }, rest);
  const bass: Step[] = Array.from({ length }, rest);
  const second = new Map<number, GridNote>();
  if (parts.second && harmony) for (const n of harmony.second) second.set(n.step, n);

  for (let r = 0; r < repeat; r++) {
    const off = r * melodySteps;
    for (const n of melody) {
      const s2 = second.get(n.step);
      const step: Step = s2
        ? { t: 'chord', notes: [n.midi, s2.midi].sort((a, b) => a - b), symbol: midiToNote(n.midi), vel: n.velocity }
        : { t: 'note', note: n.midi, vel: n.velocity };
      writeNote(mel, off + n.step, Math.min(n.length, melodySteps - n.step), step);
    }
    if (harmony) {
      for (const c of harmony.chords) {
        const len = Math.min(c.length, melodySteps - c.step);
        if (parts.pad) writeNote(pad, off + c.step, len, { t: 'chord', notes: c.notes.slice(), symbol: c.symbol, vel: 90 });
        if (parts.bass) writeNote(bass, off + c.step, len, { t: 'note', note: c.bass, vel: 100 });
      }
    }
  }
  return { length, melody: mel, pad: parts.pad && harmony ? pad : null, bass: parts.bass && harmony ? bass : null };
}

/** "Fm · Ab · Bb · Cm": consecutive duplicates collapsed. */
export function chordSummary(h: HarmonyResult, max = 4): string {
  const out: string[] = [];
  for (const c of h.chords) if (out[out.length - 1] !== c.symbol) out.push(c.symbol);
  return out.slice(0, max).join(' · ') + (out.length > max ? ' …' : '');
}

/** Mean semitone shift between the original and the shifted notes (for moving the raw trace with them). */
export function meanShift(orig: GridNote[], shifted: GridNote[]): number {
  if (!orig.length) return 0;
  let s = 0;
  for (let i = 0; i < orig.length; i++) s += shifted[i]!.midi - orig[i]!.midi;
  return s / orig.length;
}
