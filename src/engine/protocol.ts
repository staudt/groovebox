// Messages between the main thread and the engine worklet. Structured-cloneable plain objects.
// Commands flow main -> engine; events flow engine -> main at a throttled rate.
import type { DrumParams, FmPatch, FxMove, Pattern, SamplerParams } from '../store/types';
import type { FxId } from './fx/ids';

export type EngineCommand =
  | { type: 'transport'; playing: boolean }
  | { type: 'tempo'; bpm: number; swing: number }
  /** Pattern data for one slot (0-3 = A-D, default 0) of a track. */
  | { type: 'pattern'; track: number; pattern: Pattern; slot?: number }
  /** Loop mode: play slot (0-3) on every track; with `quantize` while playing, from the next bar. */
  | { type: 'patternSelect'; slot: number; quantize: boolean }
  /** Song mode: sections in order (bars, slot per track or -1 = silent); loops at the end. */
  | { type: 'song'; enabled: boolean; sections: { bars: number; slots: number[] }[] }
  /** Mixer channel: fader 0..1 (0.8 = unity), pan -1..1, delay send, sidechain amount, solo. */
  | { type: 'channel'; track: number; level: number; pan: number; sendB: number; duck: number; solo: boolean }
  /** Sidechain key track and release (0..1 = 40 ms .. 1 s). */
  | { type: 'duck'; source: number; release: number }
  | { type: 'master'; gain: number }
  | { type: 'drumParams'; track: number; params: DrumParams }
  | { type: 'trackKind'; track: number; kind: 'drum' | 'fm' | 'sampler' | 'off' }
  | { type: 'samplerParams'; track: number; params: SamplerParams }
  /** Load (or replace) a sample under `id`. Mono samples send r === undefined. */
  | { type: 'sample'; id: string; l: Float32Array; r?: Float32Array; rate: number }
  /**
   * Record `source` (-1 = master, else a track) into the provided buffers (their length = frames),
   * starting at the next bar while playing, else at once. Answered by a 'resampled' event.
   */
  | { type: 'resample'; id: string; source: number; l: Float32Array; r: Float32Array }
  | { type: 'fmPatch'; track: number; patch: FmPatch }
  /** Macro values 0..1 [Tone, Decay, Drive, Space] for FM tracks (applied as offsets around 0.5). */
  | { type: 'macros'; track: number; values: [number, number, number, number] }
  /** Live notes (keyboard, MIDI). A noteOn without a later noteOff rings until released. */
  | { type: 'noteOn'; track: number; note: number; vel: number }
  | { type: 'noteOff'; track: number; note: number }
  /** Release every live (keyboard) note on a track, e.g. when Hold is switched off. */
  | { type: 'allNotesOff'; track: number }
  /** atBar: while playing, switch on the next bar line (scene recall). */
  | { type: 'mute'; track: number; mute: boolean; atBar?: boolean }
  /** Reverb (a) and delay (b) send levels 0..1. */
  | { type: 'sends'; track: number; a: number; b: number }
  /**
   * Punch-in effect press/release. target: -1 = master, else a track. Stutter, gate and reverse
   * start on the next 1/16 while playing. x/y (0..1) set the XY parameters at press time.
   */
  | { type: 'fx'; fx: FxId; on: boolean; target: number; x?: number; y?: number }
  | { type: 'fxXY'; fx: FxId; x: number; y: number }
  /** Recorded FX moves of the playing pattern; replayed every loop (lane length = `length` steps). */
  | { type: 'fxLane'; moves: FxMove[]; length: number }
  /** Only this track is heard (-1 = no solo). Gains fade, so toggling never clicks. */
  | { type: 'solo'; track: number }
  /** Audition: play one hit now (finger drumming / preview). vel 0..127. */
  | { type: 'trigger'; track: number; vel: number };

export type EngineEvent =
  /**
   * The engine fired global step `step` at AudioContext time `time` (seconds).
   * Sent once per step while playing, plus once with step -1 on stop.
   */
  | { type: 'step'; step: number; time: number }
  /** Loop mode: a queued pattern switch happened (at a bar line). */
  | { type: 'pattern'; slot: number; time: number }
  /** Song mode: playback entered `section` (index) at `bar` (0-based within the section). */
  | { type: 'song'; section: number; bar: number; time: number }
  /** A resample finished; the buffers are transferred back. */
  | { type: 'resampled'; id: string; l: Float32Array; r: Float32Array }
  /** Peak levels per track and master (0..1+), about 30 times per second while playing. */
  | { type: 'meters'; tracks: number[]; master: number };
