// Domain model (v1). See CLAUDE.md "Domain model". Plain JSON-serializable data only.

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type Midi = number;
export type ScaleName = 'minor' | 'major' | 'dorian' | 'mixolydian' | 'pentatonic';
export type PatternId = 'A' | 'B' | 'C' | 'D';
export const PATTERN_IDS: readonly PatternId[] = ['A', 'B', 'C', 'D'];
export type TrackKind = 'drum' | 'fm' | 'sampler';

export type Step =
  | { t: 'rest' }
  | { t: 'hit'; vel: number; chance?: number; nudge?: number }
  | { t: 'note'; note: Midi; vel: number; chance?: number; nudge?: number }
  | { t: 'chord'; notes: Midi[]; symbol: string; vel: number }
  | { t: 'hold' };

export type PatternLength = 16 | 32 | 64;
export type Pattern = { length: PatternLength; steps: Step[] };

/** Which synthesized drum model a drum track plays. */
export type DrumModel = 'kick' | 'snare' | 'hat' | 'perc';

/** All drum params are normalized 0..1 except tune (semitones, -12..12). */
export type DrumParams = {
  model: DrumModel;
  tune: number;
  decay: number;
  tone: number;
  level: number;
  drive: number;
};

/**
 * One FM operator. Ranges (the engine and the store clamp to these):
 *   ratio 0.5..31.99 (frequency multiple of the note), detune -7..7 (about 1.5 cents per step),
 *   level 0..99 (DX7-style output level, ~0.75 dB per step), a/d/r 0..1 (exp-mapped times),
 *   s 0..1 (sustain level), velSens 0..7.
 */
export type FmOperator = {
  ratio: number;
  detune: number;
  level: number;
  a: number;
  d: number;
  s: number;
  r: number;
  velSens: number;
};
export type FmOpKey = keyof FmOperator;

/** 6-operator FM patch. ops[0] is OP1 ... ops[5] is OP6. Plain JSON (also the LLM output format). */
export type FmPatch = {
  kind: 'fm';
  name: string;
  algorithm: number; // 1..32
  feedback: number; // 0..7
  ops: [FmOperator, FmOperator, FmOperator, FmOperator, FmOperator, FmOperator];
};

/**
 * Sampler track. `sampleId` refers to the sample store ("kit:<sound>" for the built-in kit,
 * otherwise a user sample id); null = nothing loaded yet.
 * One-shot: every hit or note plays the sample at `pitch`. Chromatic: notes transpose from `root`,
 * holds set the note length.
 */
export type SamplerParams = {
  kind: 'sampler';
  name: string;
  sampleId: string | null;
  start: number; // 0..1 of the sample
  end: number; // 0..1, > start
  pitch: number; // semitones -24..24
  reverse: boolean;
  mode: 'oneshot' | 'chromatic';
  root: Midi;
  level: number; // 0..1
  attack: number; // 0..1 (exp-mapped, 1 ms .. 1 s)
  release: number; // 0..1 (exp-mapped, 5 ms .. 4 s)
};

/**
 * A macro knob, 0..1. Drum tracks: the value is written into the targeted drum params.
 * FM tracks: the engine applies it as an offset around 0.5 (Tone = modulator levels,
 * Decay = envelope times, Drive = track drive); the patch itself is untouched.
 */
export type MacroMap = { label: string; value: number; targets: string[] };

export type Track = {
  id: string;
  name: string;
  kind: TrackKind;
  patterns: Record<PatternId, Pattern>;
  params: DrumParams | FmPatch | SamplerParams;
  macros: [MacroMap, MacroMap, MacroMap, MacroMap];
  /** Phase 1: per-track mute; full MixerState comes in Phase 4. */
  mute: boolean;
};

export type Section = {
  id: string;
  name: string;
  bars: number;
  patternByTrack: Record<string, PatternId | null>;
};
export type Scene = { id: string; name: string; mutes: Record<string, boolean> };
export type MixerState = { master: number };

export type Project = {
  id: string;
  name: string;
  bpm: number;
  swing: number; // 50..75 %
  key: PitchClass;
  scale: ScaleName;
  tracks: Track[];
  sections: Section[];
  scenes: Scene[];
  mixer: MixerState;
  version: number;
};

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const SWING_MIN = 50;
export const SWING_MAX = 75;
export const MAX_TRACKS = 8;
export const MAX_STEPS = 64;
