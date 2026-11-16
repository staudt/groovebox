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

/** Placeholders until Phase 2/3 define them. */
export type FmPatch = { kind: 'fm'; name: string };
export type SamplerParams = { kind: 'sampler'; name: string };

/** A macro knob maps 0..1 onto one or more params. Phase 1: direct param ids. */
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
