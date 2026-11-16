// Engine renders analyzed with the shared audio helpers: dense patterns, clicks, onsets.
import { describe, expect, it } from 'vitest';
import { detectClicks, detectOnsets, peak } from '../audio/analysis';
import { defaultProject } from '../../src/store/defaults';
import type { EngineCommand } from '../../src/engine/protocol';
import { drumTrack, projectCommands, render } from './render';

const START: EngineCommand = { type: 'transport', playing: true };

describe('engine audio quality', () => {
  it('default beat: no clicks, no clipping', () => {
    const r = render([...projectCommands(defaultProject()), START], 8);
    expect(peak(r.left)).toBeLessThan(1);
    expect(detectClicks(r.left, r.sr)).toEqual([]);
  });

  it('guard: the click detector does catch a 0.05 step injected into a real drum render', () => {
    const r = render([...projectCommands(defaultProject()), START], 4);
    const buf = r.left.slice();
    const at = Math.round(2.1 * r.sr);
    for (let i = at; i < buf.length; i++) buf[i]! += 0.05;
    expect(detectClicks(buf, r.sr)).toContain(at);
  });

  it('fast retriggers (voice stealing) do not click', () => {
    for (const m of ['kick', 'snare', 'hat', 'perc'] as const) {
      // 32nd-ish retriggers of long sounds force steals on every hit.
      const r = render([{ type: 'tempo', bpm: 240, swing: 50 }, ...drumTrack(0, m, 'x x x x x x x x x x x x x x x x', { decay: 1 }), START], 2);
      expect(detectClicks(r.left, r.sr), m).toEqual([]);
    }
  });

  it('muting and unmuting mid-note does not click', () => {
    const r = render([{ type: 'tempo', bpm: 120, swing: 50 }, ...drumTrack(0, 'kick', 'x . . . x . . . x . . . x . . .', { decay: 1 }), START], 2, {
      at: [
        { time: 0.05, cmd: { type: 'mute', track: 0, mute: true } },
        { time: 0.3, cmd: { type: 'mute', track: 0, mute: false } },
      ],
    });
    expect(detectClicks(r.left, r.sr)).toEqual([]);
  });

  it('stopping mid-note lets voices ring out without clicks', () => {
    const r = render([...projectCommands(defaultProject()), START], 3, { at: [{ time: 1.234, cmd: { type: 'transport', playing: false } }] });
    expect(detectClicks(r.left, r.sr)).toEqual([]);
  });

  it('dense kick + snare + hats: every onset within 1 ms of the grid', () => {
    const bpm = 120;
    const sr = 48000;
    const cmds: EngineCommand[] = [
      { type: 'tempo', bpm, swing: 50 },
      ...drumTrack(0, 'kick', 'x . . . . . . . x . . . . . . .'),
      ...drumTrack(1, 'snare', '. . . . x . . . . . . . x . . .'),
      ...drumTrack(2, 'hat', '. . x . . . x . . . x . . . x .'),
      START,
    ];
    const r = render(cmds, 4, { sr });
    const stepS = 60 / bpm / 4;
    const lat = r.engine.latency / sr;
    const onsets = detectOnsets(r.left, sr);
    // 8 events per bar, 2 bars.
    expect(onsets.length).toBe(16);
    for (const t of onsets) {
      const rel = t - lat;
      const err = Math.abs(rel - Math.round(rel / stepS) * stepS);
      expect(err * 1000).toBeLessThan(1);
    }
  });

  it('solo isolates one track, fades in and out without clicks, and can move to another track', () => {
    const cmds: EngineCommand[] = [
      { type: 'tempo', bpm: 120, swing: 50 },
      ...drumTrack(0, 'kick', 'x . . . x . . . x . . . x . . .', { decay: 1 }),
      ...drumTrack(2, 'hat', 'x x x x x x x x x x x x x x x x', { decay: 0 }),
      START,
    ];
    const solo = (track: number, time: number) => ({ time, cmd: { type: 'solo', track } as EngineCommand });
    const sr = 48000;
    const all = render(cmds, 4).left;
    const r = render(cmds, 4, { at: [solo(2, 1.03), solo(0, 2.07), solo(-1, 3.01)] }).left;
    const hatOnly = render([...cmds.filter((c) => !('track' in c) || c.track !== 0)], 4).left;
    const kickOnly = render([...cmds.filter((c) => !('track' in c) || c.track !== 2)], 4).left;
    const seg = (b: Float32Array, a: number, z: number) => b.subarray(Math.round(a * sr), Math.round(z * sr));
    const maxDiff = (x: Float32Array, y: Float32Array) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i]!)), 0);
    // After the 10 ms fade, each soloed stretch equals that track rendered alone.
    expect(maxDiff(seg(r, 1.2, 2.0), seg(hatOnly, 1.2, 2.0))).toBeLessThan(1e-3);
    expect(maxDiff(seg(r, 2.3, 3.0), seg(kickOnly, 2.3, 3.0))).toBeLessThan(1e-3);
    expect(maxDiff(seg(r, 3.6, 4.0), seg(all, 3.6, 4.0))).toBeLessThan(1e-3);
    expect(detectClicks(r, sr)).toEqual([]);
  });
});
