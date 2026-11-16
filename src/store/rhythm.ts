// Pure helpers for the Play screen's Rhythm tool (live Euclidean re-timing of a pattern).
import type { Step } from './types';
import { euclid } from './euclid';

const REST: Step = { t: 'rest' };

/** True for steps that start a sound (hit, note or chord). */
export const isOnset = (s: Step): boolean => s.t === 'hit' || s.t === 'note' || s.t === 'chord';

/** Number of onsets in a step list. */
export const countOnsets = (steps: readonly Step[]): number => steps.filter(isOnset).length;

/**
 * Re-times `base` onto an Euclidean grid. The k-th new hit takes the k-th onset of `base` (cycling),
 * so notes, chords, velocities and chance survive. Holds are dropped. With no onsets, `fallback` is used.
 */
export function rhythmize(base: readonly Step[], hits: number, rotate: number, fallback: Step): Step[] {
  const onsets = base.filter(isOnset);
  let k = 0;
  return euclid(hits, base.length, rotate).map((on) => {
    if (!on) return REST;
    const src = onsets.length > 0 ? onsets[k % onsets.length]! : fallback;
    k++;
    return src;
  });
}

/** Rotates steps by `by` positions (positive = later), wrapping. Holds stay attached to their notes. */
export function shiftSteps(steps: readonly Step[], by: number): Step[] {
  const n = steps.length;
  if (n === 0) return [];
  const r = ((by % n) + n) % n;
  return steps.map((_, i) => steps[(i - r + n) % n]!);
}
