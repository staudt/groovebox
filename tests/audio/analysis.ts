// Pure audio analysis helpers for render tests (no DOM, no deps). Mono Float32Array in, numbers out.

export function peak(buf: Float32Array): number {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > m) m = a;
  }
  return m;
}

/** RMS over [start, end) in samples (defaults: whole buffer). */
export function rms(buf: Float32Array, start = 0, end = buf.length): number {
  const s = Math.max(0, start | 0);
  const e = Math.min(buf.length, end | 0);
  if (e <= s) return 0;
  let acc = 0;
  for (let i = s; i < e; i++) acc += buf[i]! * buf[i]!;
  return Math.sqrt(acc / (e - s));
}

/** True if the RMS over [start, end) is below thresholdDb (dBFS). */
export function isSilent(buf: Float32Array, start: number, end: number, thresholdDb = -60): boolean {
  return 20 * Math.log10(Math.max(rms(buf, start, end), 1e-12)) < thresholdDb;
}

/** 1200 * log2(a / b): how many cents a is above b. */
export function cents(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

export interface OnsetOptions {
  /** Minimum time between reported onsets (ms). Default 30. */
  minGapMs?: number;
  /** Energy window / hop of the detection envelope (ms). Default 1. */
  windowMs?: number;
  /** Energy must exceed this multiple of the recent max energy (power ratio). Default 6 (~7.8 dB). */
  riseRatio?: number;
  /** Ignore events whose window energy is below this level relative to the loudest window (dB). Default -50. */
  floorDb?: number;
  /** Refinement: onset is the first sample whose |diff| reaches this fraction of the local peak |diff|. Default 0.2. */
  refineFraction?: number;
}

/**
 * Percussive onset detector. Returns onset times in seconds, ascending.
 *
 * Method: work on the first difference d[n] = x[n] - x[n-1] (a crude high-pass, so a loud low-frequency
 * tail such as a kick's body barely contributes while a sharp attack of any velocity does).
 * 1. Detection: mean d^2 per windowMs window (hop = window). A window is a candidate when its energy
 *    exceeds riseRatio * the max energy of the previous 8 windows and the floor; candidates closer than
 *    minGapMs to the previous accepted onset are dropped. Because the reference is the *recent* energy
 *    (not a global level), a quiet hit on a decaying loud tail still triggers, while a smooth decay never does.
 * 2. Refinement: within [candidate - 2 windows, candidate + 3 ms], find the local peak |d| and return the
 *    first sample where |d| >= max(refineFraction * localPeak, 2 * tail level measured just before the region).
 * Expected precision: a few samples (<= ~0.1 ms at 44.1 kHz) for sharp-attack hits; the error is bounded by
 * how quickly the attack reaches 20 % of its peak. Soft (multi-ms) attacks would be reported late.
 */
export function detectOnsets(buf: Float32Array, sr: number, opts: OnsetOptions = {}): number[] {
  const minGap = (opts.minGapMs ?? 30) * 1e-3 * sr;
  const W = Math.max(8, Math.round((opts.windowMs ?? 1) * 1e-3 * sr));
  const riseRatio = opts.riseRatio ?? 6;
  const floorDb = opts.floorDb ?? -50;
  const frac = opts.refineFraction ?? 0.2;
  const n = buf.length;
  if (n < 2 * W) return [];

  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = buf[i]! - buf[i - 1]!;

  const nWin = Math.floor(n / W);
  const e = new Float64Array(nWin);
  let eMax = 0;
  for (let k = 0; k < nWin; k++) {
    let acc = 0;
    for (let i = k * W; i < (k + 1) * W; i++) acc += d[i]! * d[i]!;
    e[k] = acc / W;
    if (e[k]! > eMax) eMax = e[k]!;
  }
  const floor = eMax * Math.pow(10, floorDb / 10);
  const lookback = 8;
  const out: number[] = [];
  let lastIdx = -Infinity;

  for (let k = 1; k < nWin; k++) {
    if (e[k]! < floor) continue;
    let ref = 0;
    for (let j = Math.max(0, k - lookback); j < k; j++) if (e[j]! > ref) ref = e[j]!;
    if (e[k]! <= riseRatio * ref) continue;
    // Refine at sample resolution.
    const s = k * W;
    const lo = Math.max(1, s - 2 * W);
    const hi = Math.min(n, s + Math.round(0.003 * sr));
    let localPeak = 0;
    for (let i = lo; i < hi; i++) localPeak = Math.max(localPeak, Math.abs(d[i]!));
    let tail = 0;
    for (let i = Math.max(1, lo - 4 * W); i < lo; i++) tail = Math.max(tail, Math.abs(d[i]!));
    const thr = Math.max(frac * localPeak, 2 * tail);
    let idx = lo;
    for (let i = lo; i < hi; i++) {
      if (Math.abs(d[i]!) >= thr) {
        idx = i;
        break;
      }
    }
    if (idx - lastIdx < minGap) continue;
    lastIdx = idx;
    out.push(idx / sr);
    // Skip the rest of this attack so one hit is not reported twice.
    k = Math.max(k, Math.floor(idx / W) + 1);
  }
  return out;
}

export interface ClickOptions {
  /**
   * Sensitivity: a click needs |second difference| > sensitivity * the largest |second difference|
   * among the surrounding samples (+-16, excluding the click itself). Default 4. Lower = more sensitive.
   */
  sensitivity?: number;
  /** Absolute minimum jump size (amplitude of the step). Default 0.02. */
  minJump?: number;
  /** Surrounding window used for the local norm, in samples. Default 16. */
  neighborhood?: number;
}

/**
 * Discontinuity detector. Returns sample indices m where the signal steps between x[m-1] and x[m].
 *
 * Let j[n] = x[n] - 2x[n-1] + x[n-2] (second difference). A step of size s at m gives j[m] ~ +s and
 * j[m+1] ~ -s (an isolated spike pair), whereas smooth ramps (even steep, few-sample attacks or fades) give
 * one-sided changes with no immediate reversal. A click is reported when
 *  - |j[m]| >= minJump,
 *  - |j[m]| > sensitivity * local norm (max |j| nearby, excluding m-2..m+3),
 *  - j[m+1] has the opposite sign and at least half the magnitude (the spike-pair signature).
 * Limitations: steps well below the natural second difference of the signal (high-frequency, loud
 * material, or noise) are not detectable; a hit whose very first sample jumps by >= minJump is a click by definition.
 */
export function detectClicks(buf: Float32Array, sr: number, opts: ClickOptions = {}): number[] {
  void sr;
  const sens = opts.sensitivity ?? 4;
  const minJump = opts.minJump ?? 0.02;
  const N = opts.neighborhood ?? 16;
  const n = buf.length;
  const j = new Float32Array(n);
  for (let i = 2; i < n; i++) j[i] = buf[i]! - 2 * buf[i - 1]! + buf[i - 2]!;
  const out: number[] = [];
  for (let m = 2; m < n - 1; m++) {
    const a = Math.abs(j[m]!);
    if (a < minJump) continue;
    const b = j[m + 1];
    if (Math.sign(b!) === Math.sign(j[m]!) || Math.abs(b!) < 0.5 * a) continue;
    let scale = 0;
    for (let k = Math.max(2, m - N); k <= Math.min(n - 1, m + N); k++) {
      if (k >= m - 2 && k <= m + 3) continue;
      const v = Math.abs(j[k]!);
      if (v > scale) scale = v;
    }
    if (a > sens * scale) out.push(m);
  }
  return out;
}

/**
 * Fundamental frequency (Hz) of buf[start, end) using YIN (cumulative mean normalized difference,
 * threshold 0.1) with parabolic interpolation, then refined over several periods: the difference
 * function is re-evaluated at doubled lags so the fractional-lag error shrinks by ~k.
 * Range 40 Hz .. 2 kHz (as long as the segment holds at least ~3 periods of the lowest pitch). Returns 0 if
 * no periodicity is found.
 */
export function estimatePitchHz(buf: Float32Array, sr: number, start: number, end: number): number {
  const fMin = 40;
  const fMax = 2000;
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  const tauMax = Math.ceil(sr / fMin) + 2;
  const s = Math.max(0, start | 0);
  const e = Math.min(buf.length, end | 0);
  const len = e - s;
  const W = len - 2 * tauMax; // integration window for the coarse pass
  if (W < tauMax) return 0;

  const diff = (tau: number, w: number): number => {
    let acc = 0;
    for (let i = 0; i < w; i++) {
      const v = buf[s + i]! - buf[s + i + tau]!;
      acc += v * v;
    }
    return acc;
  };

  const dt = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) dt[tau] = diff(tau, W);
  const cm = new Float64Array(tauMax + 1);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += dt[tau]!;
    cm[tau] = run > 0 ? (dt[tau]! * tau) / run : 1;
  }
  let tau0 = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cm[tau]! < 0.1) {
      while (tau + 1 < tauMax && cm[tau + 1]! < cm[tau]!) tau++;
      tau0 = tau;
      break;
    }
  }
  if (tau0 < 0) return 0;

  const parabolic = (f: (t: number) => number, t: number): number => {
    const a = f(t - 1);
    const b = f(t);
    const c = f(t + 1);
    const den = a - 2 * b + c;
    return den === 0 ? t : t + (0.5 * (a - c)) / den;
  };
  let period = parabolic((t) => cm[t]!, tau0);

  // Multi-period refinement: repeatedly double the lag k * period and re-locate the difference minimum
  // (+-1 sample, parabolic) so each step halves the relative error; stops once the lag nears len / 2.
  for (let k = 2; k <= 128 && k * period * 2 < len; k *= 2) {
    const w = len - Math.ceil(k * period) - 3;
    if (w < period) break;
    const cache = new Map<number, number>();
    const f = (t: number): number => {
      let v = cache.get(t);
      if (v === undefined) {
        v = diff(t, w);
        cache.set(t, v);
      }
      return v;
    };
    const center = Math.round(k * period);
    let best = center;
    for (let t = center - 1; t <= center + 1; t++) if (f(t) < f(best)) best = t;
    period = parabolic(f, best) / k;
  }
  return sr / period;
}

export { toWav } from '../../src/app/wav';
