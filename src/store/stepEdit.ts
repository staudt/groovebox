// Pure step-editing helpers for melodic patterns. All functions return a new array (inputs are never mutated).
import type { Midi, Step } from './types';

const REST: Step = { t: 'rest' };
const HOLD: Step = { t: 'hold' };

/** True for steps that start a sound (note or chord). */
export const isNoteStart = (s: Step | undefined): boolean => s?.t === 'note' || s?.t === 'chord';

/** Index of the last hold that continues the sound starting at `from` (or `from` itself if none). */
export function holdEnd(steps: readonly Step[], from: number): number {
  let j = from;
  while (j + 1 < steps.length && steps[j + 1]!.t === 'hold') j++;
  return j;
}

/** Writes a note at `i`. Holds after it are kept (they now continue the new note). */
export function addNote(steps: readonly Step[], i: number, note: Midi, vel = 100): Step[] {
  const out = steps.slice();
  out[i] = { t: 'note', note, vel };
  return out;
}

/** Clears step `i` and the holds that follow it. */
export function removeAt(steps: readonly Step[], i: number): Step[] {
  const out = steps.slice();
  const end = holdEnd(steps, i);
  for (let k = i; k <= end; k++) out[k] = REST;
  return out;
}

/**
 * Makes the sound starting at `from` last through step `to` (inclusive): steps after it up to `to`
 * become holds (overwriting whatever was there); its old holds beyond `to` become rests.
 * `to <= from` removes its holds.
 */
export function extendHold(steps: readonly Step[], from: number, to: number): Step[] {
  if (!isNoteStart(steps[from])) return steps.slice();
  const out = steps.slice();
  const end = Math.min(steps.length - 1, Math.max(from, to));
  const oldEnd = holdEnd(steps, from);
  for (let k = from + 1; k <= end; k++) out[k] = HOLD;
  for (let k = end + 1; k <= oldEnd; k++) out[k] = REST;
  return out;
}
