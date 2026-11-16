// Records punch-in FX presses, releases and XY moves into the current pattern's FX lane while
// "Moves" is on and the loop plays. The lane updates live, so the next loop already replays it
// (overdub). One recording session (Moves on until off) is one undo step.
import { effect } from '@preact/signals';
import { onFxEvent, recordMoves, resolveTarget } from './fxState';
import { apply, currentPattern, playing, project } from '../store/project';
import { songPosition } from '../engine/host';
import type { FxMove } from '../store/types';

const LANE_STEPS = 16;
/** Moves are stored at quarter-step resolution (64 per bar); XY moves at most once per slot per effect. */
const RES = 4;

export function startFxMoveRecorder(): void {
  const held = new Set<string>();
  let firstWrite = true;

  // A new session starts each time Moves is switched on.
  effect(() => {
    if (recordMoves.value) firstWrite = true;
  });

  onFxEvent((e) => {
    const wasHeld = held.has(e.fx);
    if (e.on) held.add(e.fx);
    else held.delete(e.fx);
    if (!recordMoves.peek() || !playing.peek()) return;
    const pos = songPosition();
    if (pos < 0) return;
    const at = (Math.round((pos % LANE_STEPS) * RES) / RES) % LANE_STEPS;
    const move: FxMove = { at, fx: e.fx, x: e.x, y: e.y, target: resolveTarget() };
    if (e.on && !wasHeld) move.on = true;
    else if (!e.on) move.on = false;
    const pat = currentPattern.peek();
    let moves = (project.peek().fxMoves?.[pat] ?? []).slice();
    if (move.on === undefined) {
      // XY: replace an earlier XY move of the same effect in the same slot.
      moves = moves.filter((m) => !(m.on === undefined && m.fx === move.fx && m.at === move.at));
    }
    moves.push(move);
    apply({ type: 'setFxMoves', pattern: pat, moves }, { merge: !firstWrite });
    firstWrite = false;
  });
}

/** Removes all recorded moves from the current pattern (one undo step). */
export function clearFxMoves(): void {
  apply({ type: 'setFxMoves', pattern: currentPattern.peek(), moves: [] });
}

export const hasFxMoves = (): boolean => (project.value.fxMoves?.[currentPattern.value]?.length ?? 0) > 0;
