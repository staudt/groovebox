// Shared performance state for the punch-in effects (FX sheet, Perform quick FX, desktop keys).
// Not saved and not undoable. The engine calls go through src/engine/host.
import { effect, signal } from '@preact/signals';
import { fxPress, fxXY } from '../engine/host';
import { FX_DEFAULT_XY, type FxId } from '../engine/fx/ids';
import { selectedTrack } from '../store/project';

export type FxEvent = { fx: FxId; on: boolean; x: number; y: number };
export type FxTargetMode = 'master' | 'track';

export const fxTarget = signal<FxTargetMode>('master');
export const latch = signal(false);
/** Whether FX presses and XY motion should be recorded into the pattern (recording happens elsewhere). */
export const recordMoves = signal(false);
/** Effects currently on (held or latched), in press order: the last one is the "active" one shown on the pad. */
export const heldFx = signal<readonly FxId[]>([]);
/** Last XY (0..1) per effect; reset to the effect's default each time it is pressed. */
export const fxXYState = signal<Partial<Record<FxId, readonly [number, number]>>>({});

/** Track index (or -1 for master) each held effect was pressed on. */
const targets = new Map<FxId, number>();
const listeners = new Set<(e: FxEvent) => void>();

/** Subscribe to every FX press, release and XY move. Returns an unsubscribe function. */
export function onFxEvent(cb: (e: FxEvent) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function emit(e: FxEvent): void {
  for (const cb of listeners) cb(e);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function resolveTarget(): number {
  return fxTarget.value === 'master' ? -1 : selectedTrack.value;
}

export const isHeld = (id: FxId): boolean => targets.has(id);

function syncHeld(): void {
  heldFx.value = [...targets.keys()];
}

function releaseOne(id: FxId): void {
  const target = targets.get(id);
  if (target === undefined) return;
  targets.delete(id);
  syncHeld();
  const [x, y] = fxXYState.peek()[id] ?? FX_DEFAULT_XY[id];
  void fxPress(id, false, target);
  emit({ fx: id, on: false, x, y });
}

/** Press an effect. In latch mode a press toggles it; otherwise it stays on until `releaseFx`. */
export function pressFx(id: FxId): void {
  if (targets.has(id)) {
    if (latch.peek()) releaseOne(id);
    return;
  }
  const target = resolveTarget();
  const [x, y] = FX_DEFAULT_XY[id];
  targets.set(id, target);
  fxXYState.value = { ...fxXYState.peek(), [id]: [x, y] };
  syncHeld();
  void fxPress(id, true, target, x, y);
  emit({ fx: id, on: true, x, y });
}

/** Release an effect (finger or key up). Does nothing in latch mode. */
export function releaseFx(id: FxId): void {
  if (latch.peek()) return;
  releaseOne(id);
}

/** Move every held effect's XY (0..1 each). */
export function moveXY(x: number, y: number): void {
  const cx = clamp01(x);
  const cy = clamp01(y);
  if (targets.size === 0) return;
  const next = { ...fxXYState.peek() };
  for (const id of targets.keys()) {
    next[id] = [cx, cy];
    fxXY(id, cx, cy);
    emit({ fx: id, on: true, x: cx, y: cy });
  }
  fxXYState.value = next;
}

export function releaseAllFx(): void {
  for (const id of [...targets.keys()]) releaseOne(id);
}

/** Turning latch off also ends anything that was latched on. */
export function setLatch(on: boolean): void {
  latch.value = on;
  if (!on) releaseAllFx();
}

// A track-targeted effect belongs to the track it was pressed on: switching tracks ends it.
effect(() => {
  const sel = selectedTrack.value;
  for (const [id, t] of [...targets]) if (t !== -1 && t !== sel) releaseOne(id);
});
