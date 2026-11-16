import { describe, expect, it } from 'vitest';
import { layoutAlgorithm } from './algLayout';
import { ALGORITHMS } from '../engine/fm/algorithms';

describe('layoutAlgorithm', () => {
  for (let alg = 1; alg <= 32; alg++) {
    it(`algorithm ${alg}: 6 boxes, no overlap, fits 358 px, carriers at the bottom`, () => {
      const l = layoutAlgorithm(alg);
      expect(l.boxes).toHaveLength(6);
      expect(l.width).toBeLessThanOrEqual(358);
      for (const b of l.boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(l.width);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(l.height);
      }
      for (let i = 0; i < 6; i++) {
        for (let j = i + 1; j < 6; j++) {
          const p = l.boxes[i]!, q = l.boxes[j]!;
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart, `OP${p.op} vs OP${q.op}`).toBe(true);
        }
      }
      const bottom = Math.max(...l.boxes.map((b) => b.y));
      for (const c of ALGORITHMS[alg - 1]!.carriers) {
        const hasTargets = ALGORITHMS[alg - 1]!.mods.some(([m]) => m === c);
        if (!hasTargets) expect(l.boxes[c - 1]!.y).toBe(bottom);
      }
      // modulators are above their targets
      for (const [m, t] of l.edges) expect(l.boxes[m - 1]!.y).toBeLessThan(l.boxes[t - 1]!.y);
    });
  }
  it('algorithm 1 is the deepest stack (4 rows)', () => {
    expect(layoutAlgorithm(1).rows).toBe(4);
  });
});
