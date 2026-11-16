// Per-track keyboard state shared by the drawer, the step grid and the track strip.
import { signal } from '@preact/signals';
import { project } from '../store/project';
import type { Midi } from '../store/types';

export const OCT_MIN = 1;
export const OCT_MAX = 7;
export const OCT_DEFAULT = 3;

/** Octave of the keyboard drawer, remembered per track index. */
export const octaves = signal<Record<number, number>>({});
export const getOctave = (track: number): number => octaves.value[track] ?? OCT_DEFAULT;
export const setOctave = (track: number, oct: number): void => {
  octaves.value = { ...octaves.value, [track]: Math.min(OCT_MAX, Math.max(OCT_MIN, oct)) };
};

/** Last note entered on each track (by step tap, picker or key press). Not reactive on purpose. */
const lastNotes = new Map<number, Midi>();
export const setLastNote = (track: number, note: Midi): void => { lastNotes.set(track, note); };

/** MIDI note of C in the given octave (C4 = 60). */
export const octaveBase = (oct: number): Midi => 12 * (oct + 1);

/** The note a new step gets: the last one entered on this track, else the key's root at the drawer octave. */
export function defaultNote(track: number): Midi {
  return lastNotes.get(track) ?? octaveBase(getOctave(track)) + project.value.key;
}
