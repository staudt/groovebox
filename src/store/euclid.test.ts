import { describe, expect, it } from 'vitest';
import { euclid } from './euclid';

const fmt = (a: boolean[]) => a.map((b) => (b ? 'x' : '.')).join('');

describe('euclid', () => {
  it('E(3,8)', () => expect(fmt(euclid(3, 8, 0))).toBe('x..x..x.'));
  it('E(5,16)', () => expect(fmt(euclid(5, 16, 0))).toBe('x...x..x..x..x..'));
  it('E(4,16) is four on the floor', () => expect(fmt(euclid(4, 16, 0))).toBe('x...x...x...x...'));
  it('0 hits is empty', () => expect(euclid(0, 16, 0).some(Boolean)).toBe(false));
  it('16 hits fills every step', () => expect(euclid(16, 16, 0).every(Boolean)).toBe(true));
  it('clamps hits above steps', () => expect(euclid(20, 8, 0).every(Boolean)).toBe(true));
  it('rotate shifts right and wraps', () => {
    expect(fmt(euclid(3, 8, 1))).toBe('.x..x..x');
    expect(fmt(euclid(3, 8, 8))).toBe('x..x..x.');
  });
  it('keeps hit count and length', () => {
    for (let k = 0; k <= 16; k++) for (let r = 0; r < 16; r++) {
      const e = euclid(k, 16, r);
      expect(e).toHaveLength(16);
      expect(e.filter(Boolean)).toHaveLength(k);
    }
  });
});
