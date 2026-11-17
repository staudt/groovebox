import { parsePattern } from './notation';
import { presetByName } from './fmPresets';
import type { ChannelState, DrumModel, DrumParams, MacroMap, MixerState, Pattern, PatternId, Project, SamplerParams, Track, TrackKind } from './types';

export const SCHEMA_VERSION = 3;

const empty = (): Pattern => parsePattern('', 16);

function patterns(a: string): Record<PatternId, Pattern> {
  return { A: parsePattern(a, 16), B: empty(), C: empty(), D: empty() };
}

export function drumParams(model: DrumModel): DrumParams {
  const base = { tune: 0, level: 0.8, drive: 0.2 };
  switch (model) {
    case 'kick':
      return { model, ...base, decay: 0.45, tone: 0.5 };
    case 'snare':
      return { model, ...base, decay: 0.35, tone: 0.55 };
    case 'hat':
      return { model, ...base, decay: 0.2, tone: 0.6, level: 0.6 };
    case 'perc':
      return { model, ...base, decay: 0.3, tone: 0.5, level: 0.7 };
  }
}

export function samplerParams(sampleId: string | null = null, name = 'Empty'): SamplerParams {
  return { kind: 'sampler', name, sampleId, start: 0, end: 1, pitch: 0, reverse: false, mode: 'oneshot', root: 60, level: 0.8, attack: 0, release: 0.3 };
}

export const defaultChannel = (): ChannelState => ({ level: 0.8, pan: 0, sendB: 0, duck: 0, solo: false });

export function defaultMixer(): MixerState {
  const tracks = Array.from({ length: 8 }, defaultChannel);
  // A little sidechain pump on the bass and pad out of the box.
  tracks[3] = { ...tracks[3]!, duck: 0.35 };
  tracks[5] = { ...tracks[5]!, duck: 0.45 };
  return { master: 0.9, tracks, duckSource: 0, duckRelease: 0.4 };
}

function macros(p: DrumParams | null, space = 0): Track['macros'] {
  const m = (label: string, value: number, targets: string[]): MacroMap => ({ label, value, targets });
  return [
    m('Tone', p?.tone ?? 0.5, ['tone']),
    m('Decay', p?.decay ?? 0.5, ['decay']),
    m('Drive', p?.drive ?? 0.2, ['drive']),
    m('Space', space, []), // reverb send (send A)
  ];
}

function makeTrack(i: number, name: string, kind: TrackKind, model: DrumModel | null, pat: string, preset = 'Init', space = 0): Track {
  const params = model ? drumParams(model) : kind === 'fm' ? presetByName(preset) : preset.startsWith('kit:') ? samplerParams(preset, preset.slice(4)) : samplerParams();
  return {
    id: `t${i}`,
    name,
    kind,
    patterns: patterns(pat),
    params,
    macros: macros(model ? (params as DrumParams) : null, space),
    mute: false,
  };
}

export function defaultProject(): Project {
  return {
    id: 'demo',
    name: 'Untitled groove',
    bpm: 92,
    swing: 54,
    key: 0,
    scale: 'minor',
    tracks: [
      makeTrack(0, 'KICK', 'drum', 'kick', 'x . . . . . x . x . . . . . . .'),
      makeTrack(1, 'SNARE', 'drum', 'snare', '. . . . x . . . . . . . x . . x40'),
      makeTrack(2, 'HATS', 'drum', 'hat', 'x x50 x x50 x x50 x x50 x x50 x x50 x x50 x x50'),
      makeTrack(3, 'BASS', 'fm', null, 'C2 . C2 . . Eb2 . . Ab1 . Ab1 . . G1 ~ .', 'Round Bass'),
      makeTrack(4, 'KEYS', 'fm', null, '', 'Electric Piano', 0.2),
      makeTrack(5, 'PAD', 'fm', null, 'Cm* ~ ~ ~ ~ ~ ~ ~ Ab* ~ ~ ~ ~ ~ ~ ~', 'Soft Pad', 0.35),
      makeTrack(6, 'PERC', 'sampler', null, '. . . . . . . x60 . . x50 . . . . .', 'kit:tambourine'),
      makeTrack(7, 'VOX', 'sampler', null, ''),
    ],
    sections: [],
    scenes: [],
    mixer: defaultMixer(),
    playMode: 'loop',
    version: SCHEMA_VERSION,
  };
}

/** Every track kind has an engine now. */
export const isPlayable = (_t: Track) => true;
/** Melodic tracks use notes, holds and chords: FM, and samplers in chromatic mode. */
export const isMelodic = (t: Track) => t.kind === 'fm' || (t.kind === 'sampler' && (t.params as SamplerParams).mode === 'chromatic');
