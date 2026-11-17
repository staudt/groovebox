// Note accuracy against an expected list (for fixture tests and the in-app fixture check).
// A note is right when its pitch matches (after octave normalization when `octaveFree`) and it
// starts within `onsetTol` seconds of an unmatched expected note. Each expected note matches once.

export type NoteLike = { start: number; midi: number };

export function noteAccuracy(expected: NoteLike[], got: NoteLike[], opts: { onsetTol?: number; octaveFree?: boolean } = {}): { accuracy: number; matched: number; extra: number } {
  const tol = opts.onsetTol ?? 0.05;
  // Whistles land one or two octaves high: align by the median octave difference first.
  let shift = 0;
  if (opts.octaveFree && got.length && expected.length) {
    const diffs = got.map((g) => Math.round(g.midi) - Math.round(nearest(expected, g.start).midi));
    const octs = diffs.map((d) => Math.round(d / 12)).sort((a, b) => a - b);
    shift = octs[Math.floor(octs.length / 2)]! * 12;
  }
  const used = new Set<number>();
  let matched = 0;
  for (const e of expected) {
    let pick = -1;
    let bestDt = Infinity;
    got.forEach((g, i) => {
      if (used.has(i)) return;
      const dt = Math.abs(g.start - e.start);
      if (dt <= tol && Math.round(g.midi) - shift === Math.round(e.midi) && dt < bestDt) {
        bestDt = dt;
        pick = i;
      }
    });
    if (pick >= 0) {
      used.add(pick);
      matched++;
    }
  }
  return { accuracy: expected.length ? matched / expected.length : 1, matched, extra: got.length - used.size };
}

function nearest(xs: NoteLike[], t: number): NoteLike {
  let best = xs[0]!;
  for (const x of xs) if (Math.abs(x.start - t) < Math.abs(best.start - t)) best = x;
  return best;
}
