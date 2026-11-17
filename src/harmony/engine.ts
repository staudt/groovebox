// Harmony engine (no LLM): chooses chords for a melody, then voices them.
// 1. Candidates: diatonic triads and sevenths of the project key.
// 2. Emission: per segment (half bar or bar), melody notes score by duration x beat strength:
//    chord tones +1, other scale tones -0.3, out-of-scale -1; a melody root on the downbeat helps.
// 3. Transitions: a table per style (Pop, Melancholy, Jazzy) over scale degrees, plus a cadence
//    pull to the tonic at the end and a small penalty for repeating a chord.
// 4. Viterbi over the segments picks the best whole sequence. Deterministic (ties: first candidate).
// 5. Voicing: close-position voicings within C3..C5, choosing the one that moves least.
import type { GridNote } from '../capture/types';
import type { Midi, PitchClass, ScaleName } from '../store/types';
import { SCALES, diatonicChords, inScale, parseChord } from './theory';
import type { ChordSpan, HarmonyInput, HarmonyResult, HarmonyStyle } from './types';

type Cand = { symbol: string; degree: number; seventh: boolean; root: number; pcs: number[] };

function candidates(key: PitchClass, scale: ScaleName): Cand[] {
  const out: Cand[] = [];
  for (const sevenths of [false, true]) {
    for (const c of diatonicChords(key, scale, sevenths)) {
      const p = parseChord(c.symbol)!;
      out.push({ symbol: c.symbol, degree: c.degree, seventh: sevenths, root: p.root, pcs: p.intervals.map((i) => (p.root + i) % 12) });
    }
  }
  return out;
}

// Degree-to-degree preferences per style (positive = likes, missing = neutral 0).
const T: Record<HarmonyStyle, Record<string, number>> = {
  pop: { '1-4': 1, '1-5': 1, '1-6': 0.9, '4-5': 1, '4-1': 0.9, '5-1': 1.2, '5-6': 0.8, '6-4': 1.1, '6-5': 0.5, '2-5': 0.9, '3-6': 0.7, '3-4': 0.6, '7-1': 0.4, '4-6': 0.4 },
  melancholy: { '1-6': 1.1, '6-3': 0.9, '6-4': 1, '4-1': 0.8, '3-7': 0.9, '7-1': 0.8, '4-5': 0.6, '5-1': 0.7, '1-4': 0.7, '6-7': 0.7, '7-3': 0.6, '3-6': 0.6, '5-6': 0.8, '1-3': 0.6 },
  jazzy: { '2-5': 1.4, '5-1': 1.3, '1-6': 1, '6-2': 1.1, '3-6': 1, '4-7': 0.6, '7-3': 0.8, '1-4': 0.6, '4-5': 0.5, '1-2': 0.7, '6-5': 0.4 },
};
// How much each style likes each degree on its own (1-based index).
const PRIOR: Record<HarmonyStyle, number[]> = {
  pop: [0, 0.6, 0, -0.1, 0.4, 0.5, 0.3, -0.6],
  melancholy: [0, 0.5, -0.2, 0.3, 0.4, 0.1, 0.5, 0.1],
  jazzy: [0, 0.4, 0.4, 0.2, 0.2, 0.5, 0.3, -0.1],
};

const beatWeight = (step: number) => (step % 16 === 0 ? 2 : step % 8 === 0 ? 1.5 : step % 4 === 0 ? 1.2 : 1);

function emission(c: Cand, seg: number, len: number, melody: GridNote[], key: PitchClass, scale: ScaleName, style: HarmonyStyle): number {
  let score = PRIOR[style][c.degree]!;
  // Style taste for sevenths.
  // Pop = plain triads, Melancholy = mostly triads, Jazzy = sevenths.
  score += c.seventh ? (style === 'jazzy' ? 0.5 : style === 'melancholy' ? -0.8 : -2) : style === 'jazzy' ? -0.2 : 0;
  // Diminished triads are rarely what a hummed melody wants outside jazz.
  if (/dim|m7b5/.test(c.symbol) && style !== 'jazzy') score -= 0.6;
  const a = seg;
  const b = seg + len;
  for (const n of melody) {
    const s = Math.max(a, n.step);
    const e = Math.min(b, n.step + n.length);
    if (e <= s) continue;
    const startsHere = n.step >= a && n.step < b;
    // Normalized per segment, so melody evidence (~1-3 per segment) and style taste (~1) balance.
    const w = ((e - s) / len) * (startsHere ? beatWeight(n.step) : 0.8);
    const pc = ((n.midi % 12) + 12) % 12;
    if (c.pcs.includes(pc)) score += w;
    else score += inScale(n.midi, key, scale) ? -0.3 * w : -w;
    if (startsHere && n.step === a && pc === c.root) score += 0.5;
  }
  return score;
}

function transition(prev: Cand, cur: Cand, style: HarmonyStyle): number {
  if (prev.symbol === cur.symbol) return -0.6;
  let t = T[style][`${prev.degree}-${cur.degree}`] ?? 0;
  if (prev.degree === cur.degree) t -= 0.3; // triad <-> seventh of the same degree: little movement
  return t;
}

/** Close-position voicings of `pcs` with every note in [lo, hi]. */
function voicings(pcs: number[], lo = 48, hi = 74): Midi[][] {
  const out: Midi[][] = [];
  for (let r = 0; r < pcs.length; r++) {
    const rot = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let base = lo; base < lo + 12; base++) {
      if (base % 12 !== rot[0]) continue;
      for (let oct = 0; oct < 2; oct++) {
        const notes: Midi[] = [];
        let cur = base + 12 * oct;
        for (const pc of rot) {
          while (cur % 12 !== pc) cur++;
          notes.push(cur);
          cur++;
        }
        if (notes[notes.length - 1]! <= hi) out.push(notes);
      }
    }
  }
  return out;
}

/** Movement between two voicings (sum over sorted notes, padding the shorter with its top note). */
function movement(a: Midi[], b: Midi[]): number {
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  const n = Math.max(x.length, y.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs((x[Math.min(i, x.length - 1)] ?? 0) - (y[Math.min(i, y.length - 1)] ?? 0));
  return d;
}

/** Second voice: a third (2 scale steps) below the melody, or a sixth (5 steps) when that fits the chord better. */
function secondVoice(melody: GridNote[], chords: ChordSpan[], key: PitchClass, scale: ScaleName, cands: Cand[]): GridNote[] {
  const iv = SCALES[scale];
  const len = iv.length;
  const down = (m: Midi, steps: number): Midi => {
    let x = m;
    while (!inScale(x, key, scale)) x--;
    const rel = x - key;
    const deg = iv.indexOf(((rel % 12) + 12) % 12) + Math.floor(rel / 12) * len - steps;
    return key + Math.floor(deg / len) * 12 + iv[((deg % len) + len) % len]!;
  };
  return melody.map((n) => {
    const span = chords.find((c) => n.step >= c.step && n.step < c.step + c.length);
    const pcs = span ? (cands.find((c) => c.symbol === span.symbol)?.pcs ?? []) : [];
    const third = down(n.midi, 2);
    const sixth = down(n.midi, 5);
    const ok = (m: Midi) => pcs.includes(((m % 12) + 12) % 12);
    const pick = ok(third) || !ok(sixth) ? third : sixth;
    return { ...n, midi: pick };
  });
}

export function harmonize(input: HarmonyInput): HarmonyResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { melody, key, style } = input;
  const scale: ScaleName = input.scale === 'pentatonic' ? 'minor' : input.scale;
  const seg = input.segment ?? 16;
  const n = Math.max(1, Math.round(input.steps / seg));
  const cands = candidates(key, scale);
  const C = cands.length;
  // Viterbi.
  const score: number[][] = [];
  const back: number[][] = [];
  for (let s = 0; s < n; s++) {
    score.push(new Array<number>(C).fill(-Infinity));
    back.push(new Array<number>(C).fill(0));
    for (let c = 0; c < C; c++) {
      let e = emission(cands[c]!, s * seg, seg, melody, key, scale, style);
      if (s === 0 && cands[c]!.degree === 1) e += 0.8; // start on the tonic when the melody allows
      if (s === n - 1 && n > 1 && cands[c]!.degree === 1) e += 0.8; // cadence home
      if (s === 0) {
        score[0]![c] = e;
        continue;
      }
      let best = -Infinity;
      let arg = 0;
      for (let p = 0; p < C; p++) {
        const v = score[s - 1]![p]! + transition(cands[p]!, cands[c]!, style);
        if (v > best) {
          best = v;
          arg = p;
        }
      }
      score[s]![c] = best + e;
      back[s]![c] = arg;
    }
  }
  let last = 0;
  for (let c = 1; c < C; c++) if (score[n - 1]![c]! > score[n - 1]![last]!) last = c;
  const path = new Array<number>(n);
  path[n - 1] = last;
  for (let s = n - 1; s > 0; s--) path[s - 1] = back[s]![path[s]!]!;

  // Voicing with minimal movement.
  const chords: ChordSpan[] = [];
  let prev: Midi[] | null = null;
  for (let s = 0; s < n; s++) {
    const c = cands[path[s]!]!;
    const opts = voicings(c.pcs);
    let best = opts[0]!;
    let bestCost = Infinity;
    for (const v of opts) {
      const cost = prev ? movement(prev, v) : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 60);
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
    prev = best;
    chords.push({ step: s * seg, length: seg, symbol: c.symbol, degree: c.degree, notes: best, bass: 36 + c.root });
  }
  const second = secondVoice(melody, chords, key, scale, cands);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { chords, second, ms: t1 - t0 };
}
