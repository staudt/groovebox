/** Euclidean rhythm (Bresenham form). First hit lands on step 0 when rotate = 0; rotate shifts right. */
export function euclid(hits: number, steps: number, rotate = 0): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  const k = Math.min(n, Math.max(0, Math.floor(hits)));
  const base = Array.from({ length: n }, (_, i) => (i * k) % n < k);
  if (n === 0) return base;
  const r = ((Math.floor(rotate) % n) + n) % n;
  return base.map((_, i) => base[(i - r + n) % n]!);
}
