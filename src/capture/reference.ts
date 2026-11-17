// Reference material for capture fixtures: what the user repeats on the fixture recorder page,
// and what the synthetic test fixtures render. Times in beats at REF_BPM.
export const REF_BPM = 100;

/** A melody in A minor: [midi, beats]. Eighths and quarters, a repeated pitch and leaps. */
export const REF_MELODY: readonly [number, number][] = [
  [69, 1], [72, 0.5], [71, 0.5], [69, 1], [64, 1],
  [65, 0.5], [67, 0.5], [69, 1], [69, 0.5], [67, 0.5], [64, 1],
];

/** Strummed chords, one per bar: Am F C G. */
export const REF_CHORDS: readonly number[][] = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

export type RefNote = { start: number; end: number; midi: number };

/** The melody as notes in seconds (starting at `t0`), shifted by `octave` octaves. */
export function refMelodyNotes(t0 = 0, octave = 0, bpm = REF_BPM): RefNote[] {
  const q = 60 / bpm;
  const out: RefNote[] = [];
  let t = t0;
  for (const [m, beats] of REF_MELODY) {
    out.push({ start: t, end: t + beats * q * 0.9, midi: m + 12 * octave });
    t += beats * q;
  }
  return out;
}

/** The chords as notes (every chord note listed), one chord per bar from `t0`. */
export function refChordNotes(t0 = 0, bpm = REF_BPM): RefNote[] {
  const bar = (60 / bpm) * 4;
  return REF_CHORDS.flatMap((c, i) => c.map((m) => ({ start: t0 + i * bar, end: t0 + (i + 1) * bar - 0.1, midi: m })));
}

/** Length of the reference in beats. */
export const refBeats = (kind: 'melody' | 'chords') => (kind === 'melody' ? REF_MELODY.reduce((s, [, b]) => s + b, 0) : REF_CHORDS.length * 4);
