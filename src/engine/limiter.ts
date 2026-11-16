// Stereo-linked lookahead peak limiter. AUDIO THREAD CODE: no allocations after construction.
//
// Guarantee: |output| <= ceiling. For each input sample we compute the gain it needs
// (req = ceiling / |x|, capped at 1). The output is the input delayed by N samples, multiplied by
// the N-sample box average of a gain curve that (a) is the minimum of req over the last N+1
// samples and (b) attacks instantly and releases smoothly. Every term in the average covers the
// delayed sample's window, so the averaged gain never exceeds the gain that sample needs, while
// the averaging turns the instant attack into an N-sample ramp (no clicks).

export class Limiter {
  private readonly n: number;
  private readonly ceiling: number;
  private readonly releaseK: number;
  private readonly dl: Float32Array;
  private readonly dr: Float32Array;
  private readonly req: Float32Array; // ring of the last N+1 required gains
  private readonly sm: Float64Array; // ring of the last N smoothed gains (box average)
  private w = 0;
  private reqW = 0;
  private smW = 0;
  private smSum: number;
  private g = 1;
  /** Current gain reduction (1 = none), for meters. */
  gain = 1;

  constructor(sampleRate: number, lookaheadMs = 1.5, ceiling = 0.98, releaseMs = 120) {
    this.n = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
    this.ceiling = ceiling;
    this.releaseK = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
    this.dl = new Float32Array(this.n);
    this.dr = new Float32Array(this.n);
    this.req = new Float32Array(this.n + 1).fill(1);
    this.sm = new Float64Array(this.n).fill(1);
    this.smSum = this.n;
  }

  /** Latency in samples. */
  get latency(): number {
    return this.n;
  }

  process(l: Float32Array, r: Float32Array, frames: number): void {
    const n = this.n;
    const req = this.req;
    const reqLen = n + 1;
    for (let i = 0; i < frames; i++) {
      const xl = l[i]!;
      const xr = r[i]!;
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      req[this.reqW] = a > this.ceiling ? this.ceiling / a : 1;
      this.reqW = this.reqW + 1 === reqLen ? 0 : this.reqW + 1;
      let m = 1;
      for (let k = 0; k < reqLen; k++) {
        const v = req[k]!;
        if (v < m) m = v;
      }
      if (m < this.g) this.g = m;
      else this.g += (m - this.g) * this.releaseK;
      // Box average of the smoothed gain over the last N samples.
      this.smSum += this.g - this.sm[this.smW]!;
      this.sm[this.smW] = this.g;
      this.smW = this.smW + 1 === n ? 0 : this.smW + 1;
      // Guard against float drift in the running sum: never let it exceed the instantaneous need.
      const gain = Math.min(this.smSum / n, 1);
      const yl = this.dl[this.w]!;
      const yr = this.dr[this.w]!;
      this.dl[this.w] = xl;
      this.dr[this.w] = xr;
      this.w = this.w + 1 === n ? 0 : this.w + 1;
      let ol = yl * gain;
      let or = yr * gain;
      // Safety net only (should never engage): hard ceiling.
      if (ol > this.ceiling) ol = this.ceiling;
      else if (ol < -this.ceiling) ol = -this.ceiling;
      if (or > this.ceiling) or = this.ceiling;
      else if (or < -this.ceiling) or = -this.ceiling;
      l[i] = ol;
      r[i] = or;
      this.gain = gain;
    }
    if (this.g > 0.999999) this.g = 1;
  }
}
