// Pure layout of an FM algorithm diagram: carriers on the bottom row, each modulator above what it
// modulates, columns assigned so connections stay short. No DOM; unit-tested.
import { ALGORITHMS } from '../engine/fm/algorithms';

export type AlgBox = { op: number; x: number; y: number; w: number; h: number; row: number };
export type AlgLayout = {
  width: number;
  height: number;
  rows: number;
  boxes: AlgBox[];
  /** [modulator, target] pairs, same as the algorithm table. */
  edges: ReadonlyArray<readonly [number, number]>;
};

export const DIAGRAM_W = 332;
const SIDE = 6;
const GAP = 6;
const MAX_W = 72;
const ROW_GAP = 26;
const TOP = 10;
const BOTTOM = 12;

export function layoutAlgorithm(alg: number, width = DIAGRAM_W): AlgLayout {
  const a = ALGORITHMS[Math.min(32, Math.max(1, Math.round(alg))) - 1]!;
  const ops = [1, 2, 3, 4, 5, 6];
  const targets = (op: number) => a.mods.filter(([m]) => m === op).map(([, t]) => t).sort((x, y) => x - y);

  const rowMemo = new Map<number, number>();
  const rowOf = (op: number): number => {
    const hit = rowMemo.get(op);
    if (hit !== undefined) return hit;
    const ts = targets(op);
    const r = ts.length === 0 ? 0 : 1 + Math.max(...ts.map(rowOf));
    rowMemo.set(op, r);
    return r;
  };

  // Tree by primary parent (lowest-numbered target), roots = operators with no targets.
  const parent = (op: number) => targets(op)[0];
  const children = (op: number) => ops.filter((o) => parent(o) === op);
  const roots = ops.filter((o) => targets(o).length === 0);
  const span = new Map<number, number>();
  const spanOf = (op: number): number => {
    const hit = span.get(op);
    if (hit !== undefined) return hit;
    const kids = children(op);
    const s = kids.length ? Math.max(1, kids.reduce((n, k) => n + spanOf(k), 0)) : 1;
    span.set(op, s);
    return s;
  };

  const center = new Map<number, number>();
  const place = (op: number, left: number): void => {
    center.set(op, left + spanOf(op) / 2);
    let x = left;
    for (const k of children(op)) {
      place(k, x);
      x += spanOf(k);
    }
  };
  let left = 0;
  for (const r of roots) {
    place(r, left);
    left += spanOf(r);
  }
  const cols = Math.max(1, left);

  // Modulators of several targets (and nothing above them) sit over the middle of their targets.
  for (const op of ops) {
    const ts = targets(op);
    if (ts.length < 2 || children(op).length > 0) continue;
    const c = ts.reduce((s, t) => s + center.get(t)!, 0) / ts.length;
    const clash = ops.some((o) => o !== op && rowOf(o) === rowOf(op) && Math.abs(center.get(o)! - c) < 1);
    if (!clash) center.set(op, c);
  }

  const rows = 1 + Math.max(...ops.map(rowOf));
  const cell = (width - SIDE * 2) / cols;
  const w = Math.floor(Math.min(MAX_W, cell - GAP));
  const h = rows > 2 ? 44 : 52;
  const boxes: AlgBox[] = ops.map((op) => ({
    op,
    row: rowOf(op),
    w,
    h,
    x: Math.round(SIDE + center.get(op)! * cell - w / 2),
    y: TOP + (rows - 1 - rowOf(op)) * (h + ROW_GAP),
  }));
  return { width, height: TOP + rows * h + (rows - 1) * ROW_GAP + BOTTOM, rows, boxes, edges: a.mods };
}
