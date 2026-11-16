// 6-operator FM voice and per-track FM parameters.
// AUDIO THREAD CODE: no allocations after construction, no closures per block.
//
// Phase modulation: op_out = sin(2*pi*phase + MOD_DEPTH * sum(modulator outputs) + feedback) * level * env.
// Operators are evaluated 6 -> 1 (every DX7 algorithm routes higher-numbered operators into lower ones).
// Envelopes: linear attack, exponential decay to sustain, exponential release. Click-free rules:
// attack is at least ATTACK_MIN_S, a stolen voice fades over STEAL_S, level changes are smoothed.
import type { FmPatch } from '../../store/types';
import { ALGORITHMS } from './algorithms';
import { expMap } from '../dsp';

const OPS = 6;
const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS;
const SIN = new Float32Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) SIN[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);

/** sin(2*pi*x) via a table with linear interpolation; x in cycles, any sign. */
function sinCycles(x: number): number {
  const p = x - Math.floor(x);
  const f = p * TABLE_SIZE;
  const i = f | 0;
  const a = SIN[i]!;
  return a + (SIN[i + 1]! - a) * (f - i);
}

/** Peak phase deviation (radians) produced by a modulator at full level. */
const MOD_DEPTH = 4 * Math.PI;
const MOD_CYCLES = MOD_DEPTH / (2 * Math.PI);
const ATTACK_MIN_S = 0.0015;
const STEAL_S = 0.005;
const END_LEVEL = 1e-4;

const IDLE = 0;
const ATTACK = 1;
const DECAY = 2;
const SUSTAIN = 3;
const RELEASE = 4;

/** DX7-style output level 0..99 to linear amplitude (about 0.75 dB per step). */
export const levelToAmp = (level: number) => (level <= 0 ? 0 : Math.pow(2, (level - 99) / 8));
/** Sustain 0..1 to linear amplitude on a 48 dB scale (0 = silent). */
export const sustainToAmp = (s: number) => (s <= 0 ? 0 : Math.pow(10, (-(1 - s) * 48) / 20));
export const attackSeconds = (a: number) => expMap(a, ATTACK_MIN_S, 8);
export const decaySeconds = (d: number) => expMap(d, 0.008, 12);

/** Per-track patch, precomputed from FmPatch JSON when it changes (UI rate). */
export class FmParams {
  readonly ratio = new Float64Array(OPS); // includes detune
  readonly amp = new Float64Array(OPS); // level as amplitude, before macros
  readonly aS = new Float64Array(OPS);
  readonly dS = new Float64Array(OPS);
  readonly rS = new Float64Array(OPS);
  readonly sus = new Float64Array(OPS);
  readonly velSens = new Float64Array(OPS);
  readonly modMask = new Int32Array(OPS); // bit k set = op k+1 modulates this op
  readonly isCarrier = new Uint8Array(OPS);
  carrierCount = 1;
  fbSrc = 5; // 0-based
  fbDst = 5;
  fbAmt = 0; // radians-equivalent scale, in cycles
  // Macros (0..1, 0.5 = neutral for tone/decay).
  tone = 0.5;
  decayMacro = 0.5;

  set(p: FmPatch): void {
    const alg = ALGORITHMS[Math.min(32, Math.max(1, Math.round(p.algorithm))) - 1]!;
    this.modMask.fill(0);
    this.isCarrier.fill(0);
    for (const [m, t] of alg.mods) this.modMask[t - 1]! |= 1 << (m - 1);
    for (const c of alg.carriers) this.isCarrier[c - 1] = 1;
    this.carrierCount = alg.carriers.length;
    this.fbSrc = alg.fb[0] - 1;
    this.fbDst = alg.fb[1] - 1;
    const fb = Math.min(7, Math.max(0, Math.round(p.feedback)));
    this.fbAmt = fb === 0 ? 0 : Math.pow(2, fb - 7) * 0.5; // fb 7 = pi radians = 0.5 cycles
    for (let k = 0; k < OPS; k++) {
      const o = p.ops[k]!;
      this.ratio[k] = Math.min(31.99, Math.max(0.5, o.ratio)) * Math.pow(2, (Math.min(7, Math.max(-7, o.detune)) * 1.5) / 1200);
      this.amp[k] = levelToAmp(Math.min(99, Math.max(0, o.level)));
      this.aS[k] = attackSeconds(o.a);
      this.dS[k] = decaySeconds(o.d);
      this.rS[k] = decaySeconds(o.r);
      this.sus[k] = sustainToAmp(o.s);
      this.velSens[k] = Math.min(7, Math.max(0, o.velSens)) / 7;
    }
  }
}

export class FmVoice {
  active = false;
  gate = false;
  /** True for keyboard / MIDI notes (released by noteOff / allNotesOff), false for sequenced ones. */
  live = false;
  note = -1;
  id = 0;
  age = 0;
  stealing = false;
  steal = 1;

  private sr: number;
  private freq = 0;
  private vel = 0;
  private readonly phase = new Float64Array(OPS);
  private readonly inc = new Float64Array(OPS);
  private readonly env = new Float64Array(OPS);
  private readonly stage = new Uint8Array(OPS);
  private readonly atkInc = new Float64Array(OPS);
  private readonly decK = new Float64Array(OPS);
  private readonly relK = new Float64Array(OPS);
  private readonly velGain = new Float64Array(OPS);
  private readonly cur = new Float64Array(OPS); // smoothed op amplitude (level * macros * velocity)
  private readonly out = new Float64Array(OPS);
  private fb1 = 0;
  private fb2 = 0;
  private stealInc = 0;
  private smoothK: number;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.smoothK = 1 - Math.exp(-1 / (0.005 * sampleRate));
  }

  noteOn(p: FmParams, note: number, vel: number, id: number, live: boolean, age: number): void {
    const sr = this.sr;
    this.active = true;
    this.gate = true;
    this.live = live;
    this.note = note;
    this.id = id;
    this.age = age;
    this.stealing = false;
    this.steal = 1;
    this.vel = Math.min(127, Math.max(0, vel)) / 127;
    this.freq = 440 * Math.pow(2, (note - 69) / 12);
    this.fb1 = 0;
    this.fb2 = 0;
    const dScale = Math.pow(2, (p.decayMacro - 0.5) * 3);
    for (let k = 0; k < OPS; k++) {
      this.phase[k] = 0;
      this.out[k] = 0;
      this.env[k] = 0;
      this.stage[k] = ATTACK;
      this.inc[k] = (this.freq * p.ratio[k]!) / sr;
      this.atkInc[k] = 1 / Math.max(1, p.aS[k]! * sr);
      this.decK[k] = Math.exp(-6.907755 / Math.max(1, p.dS[k]! * dScale * sr));
      this.relK[k] = Math.exp(-6.907755 / Math.max(1, p.rS[k]! * dScale * sr));
      // Velocity sensitivity: up to -30 dB at velocity 0 for velSens 7.
      this.velGain[k] = Math.pow(10, (-(p.velSens[k]! * (1 - this.vel)) * 30) / 20);
      this.cur[k] = this.targetAmp(p, k);
    }
  }

  noteOff(p: FmParams): void {
    if (!this.gate) return;
    this.gate = false;
    const dScale = Math.pow(2, (p.decayMacro - 0.5) * 3);
    for (let k = 0; k < OPS; k++) {
      this.stage[k] = RELEASE;
      this.relK[k] = Math.exp(-6.907755 / Math.max(1, p.rS[k]! * dScale * this.sr));
    }
  }

  /** Fast fade for voice stealing. */
  stealFade(): void {
    if (!this.active || this.stealing) return;
    this.stealing = true;
    this.stealInc = 1 / Math.max(1, STEAL_S * this.sr);
  }

  private targetAmp(p: FmParams, k: number): number {
    const toneScale = p.isCarrier[k] ? 1 : Math.pow(2, (p.tone - 0.5) * 2.5);
    return p.amp[k]! * toneScale * this.velGain[k]!;
  }

  /** Loudness proxy for stealing decisions: the largest carrier envelope. */
  loudness(p: FmParams): number {
    let m = 0;
    for (let k = 0; k < OPS; k++) if (p.isCarrier[k] && this.env[k]! > m) m = this.env[k]!;
    return m * this.steal;
  }

  /** Adds this voice into out[from..to). */
  render(p: FmParams, buf: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const phase = this.phase;
    const inc = this.inc;
    const env = this.env;
    const stage = this.stage;
    const o = this.out;
    const cur = this.cur;
    const modMask = p.modMask;
    const isCarrier = p.isCarrier;
    const fbSrc = p.fbSrc;
    const fbDst = p.fbDst;
    const fbAmt = p.fbAmt;
    const sk = this.smoothK;
    const outGain = 0.5 / Math.sqrt(p.carrierCount);
    // Smoothing targets are fixed for the block (params change at UI rate).
    const tgt0 = this.targetAmp(p, 0);
    const tgt1 = this.targetAmp(p, 1);
    const tgt2 = this.targetAmp(p, 2);
    const tgt3 = this.targetAmp(p, 3);
    const tgt4 = this.targetAmp(p, 4);
    const tgt5 = this.targetAmp(p, 5);

    for (let i = from; i < to; i++) {
      cur[0] = cur[0]! + (tgt0 - cur[0]!) * sk;
      cur[1] = cur[1]! + (tgt1 - cur[1]!) * sk;
      cur[2] = cur[2]! + (tgt2 - cur[2]!) * sk;
      cur[3] = cur[3]! + (tgt3 - cur[3]!) * sk;
      cur[4] = cur[4]! + (tgt4 - cur[4]!) * sk;
      cur[5] = cur[5]! + (tgt5 - cur[5]!) * sk;
      let sum = 0;
      for (let k = OPS - 1; k >= 0; k--) {
        // Envelope.
        let e = env[k]!;
        const st = stage[k]!;
        if (st === ATTACK) {
          e += this.atkInc[k]!;
          if (e >= 1) {
            e = 1;
            stage[k] = DECAY;
          }
        } else if (st === DECAY) {
          const s = p.sus[k]!;
          e = s + (e - s) * this.decK[k]!;
          if (Math.abs(e - s) < 1e-5) {
            e = s;
            stage[k] = SUSTAIN;
          }
        } else if (st === RELEASE) {
          e *= this.relK[k]!;
          if (e < 1e-6) {
            e = 0;
            stage[k] = IDLE;
          }
        }
        env[k] = e;
        // Modulation input (in cycles).
        let m = 0;
        const mask = modMask[k]!;
        if (mask !== 0) {
          for (let j = k + 1; j < OPS; j++) if ((mask >> j) & 1) m += o[j]!;
          m *= MOD_CYCLES;
        }
        if (k === fbDst && fbAmt > 0) m += (this.fb1 + this.fb2) * 0.5 * fbAmt;
        let ph = phase[k]! + inc[k]!;
        if (ph >= 1) ph -= 1;
        phase[k] = ph;
        const y = sinCycles(ph + m) * e * cur[k]!;
        o[k] = y;
        if (isCarrier[k]) sum += y;
      }
      this.fb2 = this.fb1;
      this.fb1 = o[fbSrc]!;
      let g = outGain;
      if (this.stealing) {
        this.steal -= this.stealInc;
        if (this.steal <= 0) {
          this.steal = 0;
          this.active = false;
          break;
        }
        g *= this.steal;
      }
      buf[i]! += sum * g;
    }
    if (!this.active) return;
    // Done when every carrier has finished releasing.
    if (!this.gate) {
      let alive = false;
      for (let k = 0; k < OPS; k++) if (isCarrier[k] && env[k]! > END_LEVEL) alive = true;
      if (!alive) this.active = false;
    }
  }
}
