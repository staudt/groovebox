// Messages between the main thread and the engine worklet. Structured-cloneable plain objects.
// Commands flow main -> engine; events flow engine -> main at a throttled rate.
import type { DrumParams, FmPatch, Pattern } from '../store/types';

export type EngineCommand =
  | { type: 'transport'; playing: boolean }
  | { type: 'tempo'; bpm: number; swing: number }
  | { type: 'pattern'; track: number; pattern: Pattern }
  | { type: 'drumParams'; track: number; params: DrumParams }
  | { type: 'trackKind'; track: number; kind: 'drum' | 'fm' | 'off' }
  | { type: 'fmPatch'; track: number; patch: FmPatch }
  /** Macro values 0..1 [Tone, Decay, Drive, Space] for FM tracks (applied as offsets around 0.5). */
  | { type: 'macros'; track: number; values: [number, number, number, number] }
  /** Live notes (keyboard, MIDI). A noteOn without a later noteOff rings until released. */
  | { type: 'noteOn'; track: number; note: number; vel: number }
  | { type: 'noteOff'; track: number; note: number }
  /** Release every live (keyboard) note on a track, e.g. when Hold is switched off. */
  | { type: 'allNotesOff'; track: number }
  | { type: 'mute'; track: number; mute: boolean }
  /** Audition: play one hit now (finger drumming / preview). vel 0..127. */
  | { type: 'trigger'; track: number; vel: number };

export type EngineEvent =
  /**
   * The engine fired global step `step` at AudioContext time `time` (seconds).
   * Sent once per step while playing, plus once with step -1 on stop.
   */
  | { type: 'step'; step: number; time: number }
  /** Peak levels per track and master (0..1+), about 30 times per second while playing. */
  | { type: 'meters'; tracks: number[]; master: number };
