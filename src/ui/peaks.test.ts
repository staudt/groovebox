import { describe, expect, it } from 'vitest';
import { computePeaks } from './peaks';

describe('computePeaks', () => {
  it('returns min and max per column', () => {
    const x = Float32Array.of(0, 0.5, -0.25, 0.1, 0, -1, 0.2, 0);
    const p = computePeaks(x, undefined, 2);
    [-0.25, 0.5, -1, 0.2].forEach((v, i) => expect(p[i]).toBeCloseTo(v, 5));
  });
  it('averages stereo', () => {
    const p = computePeaks(Float32Array.of(1, 1), Float32Array.of(-1, 0), 1);
    expect(Array.from(p)).toEqual([0, 0.5]);
  });
  it('handles more columns than frames and empty input', () => {
    expect(computePeaks(Float32Array.of(0.5), undefined, 4).length).toBe(8);
    expect(Array.from(computePeaks(new Float32Array(0), undefined, 2))).toEqual([0, 0, 0, 0]);
  });
});
