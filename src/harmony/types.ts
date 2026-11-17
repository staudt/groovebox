// Harmony engine: types shared by the engine and the Place screen.
import type { Midi, PitchClass, ScaleName } from '../store/types';
import type { GridNote } from '../capture/types';

export type HarmonyStyle = 'pop' | 'melancholy' | 'jazzy';
export const STYLE_LABEL: Record<HarmonyStyle, string> = { pop: 'Pop', melancholy: 'Melancholy', jazzy: 'Jazzy' };

export type HarmonyInput = {
  melody: GridNote[];
  key: PitchClass;
  scale: ScaleName;
  style: HarmonyStyle;
  /** Total length in 16th steps (a multiple of 16). */
  steps: number;
  /** Chord changes every 8 (half bar) or 16 (bar) steps. Default 16. */
  segment?: 8 | 16;
};

/** One chord over a segment: symbol, scale degree (1-7), voiced notes (pad) and bass root. */
export type ChordSpan = { step: number; length: number; symbol: string; degree: number; notes: Midi[]; bass: Midi };

export type HarmonyResult = {
  chords: ChordSpan[];
  /** Second voice: a third or sixth below the melody, in key. */
  second: GridNote[];
  /** Time the engine took (ms), for the < 50 ms budget. */
  ms: number;
};
