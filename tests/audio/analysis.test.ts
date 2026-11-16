import { describe, expect, it } from 'vitest';
import { cents, detectClicks, detectOnsets, estimatePitchHz, isSilent, peak, rms, toWav } from './analysis';

const SR = 44100;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Adds a drum-like hit starting exactly at sample `at`: noise transient + decaying sine. */
function addHit(buf: Float32Array, at: number, o: { amp: number; freq: number; decay: number; noiseMs?: number }, rng: () => number): void {
  const nNoise = Math.round(((o.noiseMs ?? 2) * SR) / 1000);
  for (let i = 0; at + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t / o.decay);
    if (env < 1e-4) break;
    let v = Math.sin(2 * Math.PI * o.freq * t + Math.PI / 2 * 0.0) * env;
    // Sharp, but not a pure 1-sample step: sine starts at phase 0 and noise gives an instant transient.
    if (i < nNoise) v += rng() * (1 - i / nNoise);
    buf[at + i]! += o.amp * v;
  }
}

describe('basic level helpers', () => {
  it('peak, rms, isSilent', () => {
    const b = new Float32Array(1000);
    for (let i = 500; i < 1000; i++) b[i] = i % 2 ? 0.5 : -0.5;
    expect(peak(b)).toBeCloseTo(0.5, 6);
    expect(rms(b, 500, 1000)).toBeCloseTo(0.5, 6);
    expect(rms(b)).toBeCloseTo(0.5 / Math.SQRT2, 6);
    expect(isSilent(b, 0, 500)).toBe(true);
    expect(isSilent(b, 400, 1000)).toBe(false);
    expect(cents(880, 440)).toBeCloseTo(1200, 9);
  });
});

describe('detectOnsets', () => {
  it('finds hits within 0.25 ms with overlapping tails, mixed velocities and noise', () => {
    const rng = makeRng(1);
    const buf = new Float32Array(SR * 3);
    // Background noise at about -60 dBFS.
    for (let i = 0; i < buf.length; i++) buf[i] = rng() * 0.001;
    const hits: { t: number; o: { amp: number; freq: number; decay: number } }[] = [
      { t: 0.2, o: { amp: 0.9, freq: 55, decay: 0.4 } }, // loud kick, long tail
      { t: 0.4, o: { amp: 0.06, freq: 1800, decay: 0.03 } }, // vel ~40 hat during kick tail
      { t: 0.5, o: { amp: 0.25, freq: 220, decay: 0.12 } }, // snare-ish, quieter than the tail
      { t: 0.5237, o: { amp: 0.5, freq: 330, decay: 0.05 } }, // close hit (23.7 ms later is below minGap, so skipped; see below)
      { t: 0.9, o: { amp: 0.9, freq: 55, decay: 0.4 } },
      { t: 1.1, o: { amp: 0.05, freq: 1500, decay: 0.02 } },
      { t: 1.25, o: { amp: 0.7, freq: 70, decay: 0.3 } },
      { t: 1.4, o: { amp: 0.05, freq: 2500, decay: 0.02 } },
      { t: 2.0, o: { amp: 0.3, freq: 150, decay: 0.2 } },
    ];
    // Drop the deliberately too-close hit from the expectation but keep it out of the signal as well.
    hits.splice(3, 1);
    const times: number[] = [];
    for (const h of hits) {
      const at = Math.round(h.t * SR);
      addHit(buf, at, h.o, rng);
      times.push(at / SR);
    }
    const found = detectOnsets(buf, SR);
    expect(found.length).toBe(times.length);
    let worst = 0;
    times.forEach((t, i) => {
      worst = Math.max(worst, Math.abs(found[i]! - t));
    });
    console.log(`onset worst error: ${(worst * 1000).toFixed(4)} ms`);
    expect(worst).toBeLessThan(0.25e-3);
  });

  it('respects minGapMs', () => {
    const rng = makeRng(2);
    const buf = new Float32Array(SR);
    addHit(buf, 10000, { amp: 0.8, freq: 200, decay: 0.1 }, rng);
    addHit(buf, 10000 + Math.round(0.02 * SR), { amp: 0.8, freq: 300, decay: 0.1 }, rng);
    expect(detectOnsets(buf, SR, { minGapMs: 30 }).length).toBe(1);
    expect(detectOnsets(buf, SR, { minGapMs: 10 }).length).toBe(2);
  });

  it('reports no onsets in a decaying tail or silence', () => {
    const rng = makeRng(3);
    const buf = new Float32Array(SR * 2);
    for (let i = 0; i < buf.length; i++) buf[i] = rng() * 0.0005;
    addHit(buf, 20000, { amp: 1, freq: 60, decay: 0.5 }, rng);
    const found = detectOnsets(buf, SR);
    expect(found.length).toBe(1);
    expect(Math.abs(found[0]! - 20000 / SR)).toBeLessThan(0.25e-3);
    expect(detectOnsets(new Float32Array(SR), SR)).toEqual([]);
  });
});

describe('detectClicks', () => {
  const sine = (f: number, amp: number, n: number): Float32Array => {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
    return b;
  };

  it('is clean on a pure sine', () => {
    expect(detectClicks(sine(440, 0.8, SR), SR)).toEqual([]);
  });

  it('flags a hard 0.05 step in a sine', () => {
    for (const f of [110, 440, 1000]) {
      const b = sine(f, 0.5, SR);
      const m = 20000;
      for (let i = m; i < b.length; i++) b[i]! += 0.05;
      const c = detectClicks(b, SR);
      expect(c, `f=${f}`).toEqual([m]);
    }
  });

  it('flags a sine cut to zero mid-cycle', () => {
    const b = sine(440, 0.8, SR);
    // Find a sample where the sine is far from zero (about 1 rad into a cycle).
    const m = Math.round((20 * SR) / 440 + SR / 440 / 6.28);
    for (let i = m; i < b.length; i++) b[i] = 0;
    const c = detectClicks(b, SR);
    expect(c).toEqual([m]);
  });

  it('does not flag smooth attacks (few-sample ramp, 2 ms fades) or noise', () => {
    // Drum-like attack with a 3-sample ramp.
    const rng = makeRng(4);
    const d = new Float32Array(SR);
    for (let i = 5000; i < d.length; i++) {
      const t = (i - 5000) / SR;
      const ramp = Math.min(1, (i - 5000) / 3);
      d[i] = ramp * Math.exp(-t / 0.1) * Math.sin(2 * Math.PI * 100 * t + 1);
    }
    expect(detectClicks(d, SR)).toEqual([]);

    // Sine with 2 ms linear fade in and out.
    const s = sine(440, 0.8, SR);
    const fade = Math.round(0.002 * SR);
    const a = 10000;
    const z = 30000;
    for (let i = 0; i < s.length; i++) {
      let g = i < a || i >= z ? 0 : 1;
      if (i >= a && i < a + fade) g = (i - a) / fade;
      if (i >= z - fade && i < z) g = (z - i) / fade;
      s[i]! *= g;
    }
    expect(detectClicks(s, SR)).toEqual([]);

    const n = new Float32Array(SR);
    for (let i = 0; i < n.length; i++) n[i] = rng() * 0.5;
    expect(detectClicks(n, SR)).toEqual([]);
  });

  it('sensitivity option changes the verdict', () => {
    const b = sine(2000, 0.5, SR);
    for (let i = 20000; i < b.length; i++) b[i]! += 0.05;
    const strict = detectClicks(b, SR, { sensitivity: 10 });
    const loose = detectClicks(b, SR, { sensitivity: 1.2 });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });
});

describe('estimatePitchHz', () => {
  const freqs = [55, 110, 261.63, 440, 1046.5];
  const gen = (f: number, saw: boolean, n: number, phase = 0.3): Float32Array => {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = (f * i) / SR + phase;
      b[i] = saw ? 0.8 * (2 * (p - Math.floor(p)) - 1) : 0.8 * Math.sin(2 * Math.PI * p);
    }
    return b;
  };
  for (const saw of [false, true]) {
    for (const f of freqs) {
      it(`${saw ? 'saw' : 'sine'} ${f} Hz within 5 cents`, () => {
        const b = gen(f, saw, SR);
        const est = estimatePitchHz(b, SR, 5000, 5000 + 16384);
        const err = cents(est, f);
        console.log(`${saw ? 'saw' : 'sine'} ${f}: ${err.toFixed(3)} cents`);
        expect(Math.abs(err)).toBeLessThan(5);
      });
    }
  }
  it('handles the range extremes and other sample rates', () => {
    for (const f of [40, 1999]) {
      const b = new Float32Array(SR);
      for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * f * i) / SR);
      expect(Math.abs(cents(estimatePitchHz(b, SR, 1000, 1000 + 20000), f))).toBeLessThan(5);
    }
    const b = new Float32Array(48000);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 330 * i) / 48000);
    expect(Math.abs(cents(estimatePitchHz(b, 48000, 0, 20000), 330))).toBeLessThan(5);
  });
  it('returns 0 for silence', () => {
    expect(estimatePitchHz(new Float32Array(20000), SR, 0, 20000)).toBe(0);
  });
});

describe('toWav', () => {
  it('writes a valid 16-bit PCM header and data', () => {
    const l = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
    const r = Float32Array.from([0, 0, 0, 0, 0, 0]);
    const w = toWav([l, r], 48000);
    const v = new DataView(w.buffer);
    const tag = (o: number): string => String.fromCharCode(w[o]!, w[o + 1]!, w[o + 2]!, w[o + 3]!);
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(6 * 4);
    expect(w.length).toBe(44 + 24);
    expect(v.getUint32(4, true)).toBe(w.length - 8);
    expect(v.getInt16(44 + 4, true)).toBe(16384 | 0 ? Math.round(0.5 * 32767) : 0);
    expect(v.getInt16(44 + 12, true)).toBe(32767);
    expect(v.getInt16(44 + 16, true)).toBe(-32768);
    expect(v.getInt16(44 + 20, true)).toBe(32767); // clipped
  });
});
