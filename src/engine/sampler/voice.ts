// Sample playback voice and per-track sampler settings.
// AUDIO THREAD CODE: no allocations after construction (sample buffers arrive by message, at UI rate).
//
// Click-free rules: attack of at least 1 ms, a release ramp on note-off, an automatic fade over the
// last END_FADE_S before the (trimmed) end, and a fast fade when a voice is stolen.
import { expMap } from '../dsp';

const END_FADE_S = 0.003;
const STEAL_S = 0.005;

/** A loaded sample: one or two channels at their own sample rate. */
export type SampleData = { l: Float32Array; r: Float32Array; rate: number };

export class SamplerSettings {
  sample: SampleData | null = null;
  start = 0;
  end = 1;
  pitch = 0;
  reverse = false;
  chromatic = false;
  root = 60;
  attackS = 0.001;
  releaseS = 0.05;
}

export const samplerAttackS = (a: number) => expMap(a, 0.001, 1);
export const samplerReleaseS = (r: number) => expMap(r, 0.005, 4);

/** 4-point cubic Hermite interpolation of x at fractional index p (clamped to the buffer). */
function hermite(x: Float32Array, p: number): number {
  const n = x.length;
  const i = Math.floor(p);
  const f = p - i;
  const xm1 = x[i - 1 < 0 ? 0 : i - 1]!;
  const x0 = x[i < 0 ? 0 : i >= n ? n - 1 : i]!;
  const x1 = x[i + 1 >= n ? n - 1 : i + 1]!;
  const x2 = x[i + 2 >= n ? n - 1 : i + 2]!;
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}

export class SamplerVoice {
  active = false;
  gate = false;
  live = false;
  note = -1;
  id = 0;
  age = 0;
  stealing = false;

  private readonly sr: number;
  private data: SampleData | null = null;
  private pos = 0; // source frame
  private inc = 0; // source frames per output frame (negative when reversed)
  private from = 0; // first source frame of the trimmed region
  private to = 0; // one past the last
  private gain = 0;
  private env = 0;
  private atkInc = 0;
  private relK = 0;
  private released = false;
  private steal = 1;
  private stealInc = 0;
  private fadeLen = 1;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
  }

  noteOn(s: SamplerSettings, note: number, vel: number, id: number, live: boolean, age: number): void {
    const d = s.sample;
    if (!d || d.l.length < 4) return;
    const len = d.l.length;
    const a = Math.min(s.start, s.end);
    const b = Math.max(s.start, s.end);
    this.from = Math.floor(a * len);
    this.to = Math.max(this.from + 2, Math.ceil(b * len));
    const semis = s.pitch + (s.chromatic ? note - s.root : 0);
    const rate = (d.rate / this.sr) * Math.pow(2, semis / 12);
    this.inc = s.reverse ? -rate : rate;
    this.pos = s.reverse ? this.to - 1 : this.from;
    this.data = d;
    this.active = true;
    this.gate = true;
    this.live = live;
    this.note = note;
    this.id = id;
    this.age = age;
    this.stealing = false;
    this.steal = 1;
    this.released = false;
    this.gain = Math.pow(Math.min(127, Math.max(0, vel)) / 127, 1.5);
    this.env = 0;
    this.atkInc = 1 / Math.max(1, s.attackS * this.sr);
    this.relK = Math.exp(-6.907755 / Math.max(1, s.releaseS * this.sr));
    this.fadeLen = Math.max(1, END_FADE_S * d.rate);
  }

  /** Release. One-shot voices ignore it (they play to the end) unless `force`. */
  noteOff(chromatic: boolean, force = false): void {
    if (!this.gate) return;
    this.gate = false;
    if (chromatic || force) this.released = true;
  }

  stealFade(): void {
    if (!this.active || this.stealing) return;
    this.stealing = true;
    this.stealInc = 1 / Math.max(1, STEAL_S * this.sr);
  }

  loudness(): number {
    return this.env * this.steal * this.gain;
  }

  render(outBuf: Float32Array, from: number, to: number): void {
    if (!this.active || !this.data) return;
    const d = this.data;
    const l = d.l;
    const r = d.r;
    const stereo = r !== l;
    for (let i = from; i < to; i++) {
      // Distance (in source frames) to the end of the region in the playing direction.
      const left = this.inc > 0 ? this.to - 1 - this.pos : this.pos - this.from;
      if (left <= 0) {
        this.active = false;
        break;
      }
      if (this.released) {
        this.env *= this.relK;
        if (this.env < 1e-4) {
          this.active = false;
          break;
        }
      } else if (this.env < 1) this.env = Math.min(1, this.env + this.atkInc);
      let g = this.env * this.gain * Math.min(1, left / this.fadeLen);
      if (this.stealing) {
        this.steal -= this.stealInc;
        if (this.steal <= 0) {
          this.active = false;
          break;
        }
        g *= this.steal;
      }
      const v = stereo ? (hermite(l, this.pos) + hermite(r, this.pos)) * 0.5 : hermite(l, this.pos);
      outBuf[i]! += v * g;
      this.pos += this.inc;
    }
  }
}
