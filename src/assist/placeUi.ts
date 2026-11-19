// Maps a validated placement suggestion onto the Place screen's controls (pure, so it is unit tested).
import type { PatternId, Project } from '../store/types';
import type { placeSuggestion } from './apply';

type Suggestion = NonNullable<ReturnType<typeof placeSuggestion>>;
export type PlaceControls = { trackI: number; slot: PatternId; sectionI: number; repeat: number; oct: number };
export type PlaceKey = keyof PlaceControls;

/** `baseOct`: the octave offset Place had when the melody was sent (the shift is relative to it). */
export function placeControls(s: Suggestion, p: Project, repeatOptions: number[], baseOct: number): PlaceControls {
  const idx = s.sectionId ? p.sections.findIndex((x) => x.id === s.sectionId) : -1;
  // Largest offered repeat that does not exceed the suggestion, so the pattern length stays legal.
  const rep = [...repeatOptions].reverse().find((r) => r <= s.repeats) ?? repeatOptions[0] ?? 1;
  return { trackI: s.track, slot: s.slot, sectionI: idx, repeat: rep, oct: Math.max(-4, Math.min(4, baseOct + s.octaveShift)) };
}
