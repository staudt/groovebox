// Messages between the main thread and the engine worklet. Structured-cloneable plain objects.
// Commands flow main -> engine; events flow engine -> main at a throttled rate.
import type { DrumParams, Pattern } from '../store/types';

export type EngineCommand =
  | { type: 'transport'; playing: boolean }
  | { type: 'tempo'; bpm: number; swing: number }
  | { type: 'pattern'; track: number; pattern: Pattern }
  | { type: 'drumParams'; track: number; params: DrumParams }
  | { type: 'trackKind'; track: number; kind: 'drum' | 'off' }
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
