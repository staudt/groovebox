/**
 * Min/max peaks for drawing a waveform: `columns` pairs [min0, max0, min1, max1, ...] over the
 * whole sample (stereo is averaged to mono).
 */
export function computePeaks(l: Float32Array, r: Float32Array | undefined, columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, columns) * 2);
  const n = l.length;
  if (!n || columns <= 0) return out;
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * n) / columns);
    const b = Math.max(a + 1, Math.floor(((c + 1) * n) / columns));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i < b && i < n; i++) {
      const v = r ? (l[i]! + (r[i] ?? 0)) * 0.5 : l[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[c * 2] = lo === Infinity ? 0 : lo;
    out[c * 2 + 1] = hi === -Infinity ? 0 : hi;
  }
  return out;
}
