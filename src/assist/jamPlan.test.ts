import { describe, expect, it } from 'vitest';
import { JAM_START, jamTick, mergeJam, type JamItem, type JamState, type JamTick } from './jamPlan';

const song = (section: number, bar: number, sectionBars = 4): JamTick => ({ playing: true, mode: 'song', section, bar, sectionBars, step: 0 });
const loop = (step: number): JamTick => ({ playing: true, mode: 'loop', section: 0, bar: 0, sectionBars: 0, step });

describe('jamTick song mode', () => {
  it('requests two bars before the end, once, and flags the section change', () => {
    let s: JamState = JAM_START;
    const seen: string[] = [];
    for (const [sec, bar] of [[0, 0], [0, 1], [0, 2], [0, 2], [0, 3], [1, 0], [1, 1]] as const) {
      const d = jamTick(s, song(sec, bar));
      s = d.state;
      seen.push(`${sec}.${bar}${d.request ? ' req' : ''}${d.boundary ? ' bound' : ''}`);
    }
    expect(seen).toEqual(['0.0', '0.1', '0.2 req', '0.2', '0.3', '1.0 bound', '1.1']);
  });
  it('one-bar sections ask immediately; a single looping section counts as a boundary', () => {
    let d = jamTick(JAM_START, song(0, 0, 1));
    expect(d.request).toBe(true);
    d = jamTick(d.state, song(0, 0, 1));
    expect(d.boundary).toBe(false);
    d = jamTick(d.state, song(0, 1, 2));
    d = jamTick(d.state, song(0, 0, 2));
    expect(d.boundary).toBe(true);
  });
  it('stopping resets', () => {
    const d = jamTick(jamTick(JAM_START, song(0, 0)).state, { ...song(0, 0), playing: false });
    expect(d.state).toEqual(JAM_START);
  });
});

describe('jamTick loop mode', () => {
  it('asks on the first bar then every 4 bars; boundary at each bar wrap', () => {
    let s: JamState = JAM_START;
    const out: string[] = [];
    for (const step of [0, 5, 15, 16, 30, 32, 48, 64, 65, 80]) {
      const d = jamTick(s, loop(step));
      s = d.state;
      out.push(`${step}${d.request ? 'r' : ''}${d.boundary ? 'b' : ''}`);
    }
    expect(out).toEqual(['0r', '5', '15', '16b', '30', '32b', '48b', '64rb', '65', '80b']);
  });
  it('ignores readings before the first step', () => {
    expect(jamTick(JAM_START, loop(-1))).toEqual({ state: JAM_START, boundary: false, request: false });
  });
});

describe('mergeJam', () => {
  const it_ = (id: number, status: JamItem<number>['status']): JamItem<number> => ({ id, description: '', tracks: [], commands: [], status });
  it('replaces unqueued items, keeps queued and finished ones', () => {
    const out = mergeJam([it_(1, 'new'), it_(2, 'queued'), it_(3, 'played')], [it_(4, 'new'), it_(5, 'new')]);
    expect(out.map((i) => i.id)).toEqual([4, 5, 2, 3]);
  });
  it('an empty answer changes nothing; the list is capped', () => {
    const items = [it_(1, 'new')];
    expect(mergeJam(items, [])).toBe(items);
    const many = mergeJam([it_(1, 'played'), it_(2, 'played'), it_(3, 'skipped'), it_(4, 'queued')], [it_(5, 'new'), it_(6, 'new'), it_(7, 'new')]);
    expect(many.length).toBe(6);
    expect(many.some((i) => i.status === 'queued')).toBe(true);
  });
});
