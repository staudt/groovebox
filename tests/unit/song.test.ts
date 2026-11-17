// Phase 4: pattern slots, song sections, mixer (pan, fader, solo, sidechain), scenes, and the
// acceptance test: a full song plays back identically after a save + reload.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { peak, rms } from '../audio/analysis';
import type { EngineCommand } from '../../src/engine/protocol';
import { defaultProject } from '../../src/store/defaults';
import { parsePattern } from '../../src/store/notation';
import { loadProject, saveProject } from '../../src/store/persist';
import type { Pattern, PatternId, Project } from '../../src/store/types';
import { projectCommands, render, sparseOnsets } from './render';

const SR = 48000;
const BPM = 120;
const STEP = (SR * 60) / BPM / 4;
const BAR = 16 * STEP;
const LAT = 72;
const START: EngineCommand = { type: 'transport', playing: true };

/** A project with only a short perc ping on track 0 (exact onsets), everything else silent. */
function pingProject(patterns: Partial<Record<PatternId, string>>, len: 16 | 32 = 16): Project {
  const p = defaultProject();
  p.bpm = BPM;
  p.swing = 50;
  p.tracks = p.tracks.map((t, i) => {
    const empty = (): Pattern => parsePattern('', len);
    const pats = { A: empty(), B: empty(), C: empty(), D: empty() };
    if (i === 0) for (const [id, txt] of Object.entries(patterns)) pats[id as PatternId] = parsePattern(txt, len);
    return {
      ...t,
      kind: i === 0 ? 'drum' : t.kind,
      params: i === 0 ? { model: 'perc', tune: 0, decay: 0, tone: 0, level: 0.8, drive: 0 } : t.params,
      macros: t.macros.map((m) => ({ ...m, value: m.label === 'Space' ? 0 : m.value })) as typeof t.macros,
      patterns: pats,
    };
  });
  p.mixer = { ...p.mixer, tracks: p.mixer.tracks.map((c) => ({ ...c, duck: 0 })) };
  return p;
}
/** Onset positions in steps (relative to the grid). */
const onsetSteps = (buf: Float32Array) => sparseOnsets(buf, SR).map((o) => Math.round(((o - LAT - 9) / STEP) * 4) / 4 + 0);

describe('patterns and song', () => {
  it('a pattern switch while playing waits for the next bar', () => {
    const p = pingProject({ A: 'x . . . . . . . . . . . . . . .', B: '. . . . . . . . x . . . . . . .' });
    const r = render([...projectCommands(p, 'A'), START], 3 * 2, {
      at: [{ time: 0.3, cmd: { type: 'patternSelect', slot: 1, quantize: true } }],
    });
    // Bar 0: A (step 0). From bar 1: B (step 8 of each bar).
    expect(onsetSteps(r.left)).toEqual([0, 16 + 8, 32 + 8]);
    expect(r.events.some((e) => e.type === 'pattern' && e.slot === 1)).toBe(true);
  });

  it('a 32-step pattern spans two bars', () => {
    const p = pingProject({ A: 'x . . . . . . . . . . . . . . . . x . . . . . . . . . . . . . .' }, 32);
    const r = render([...projectCommands(p, 'A'), START], 7.9);
    expect(onsetSteps(r.left)).toEqual([0, 17, 32, 49]);
  });

  it('song mode plays sections in order, silences tracks set to none, and loops', () => {
    const p = pingProject({ A: 'x . . . . . . . . . . . . . . .', B: '. . . . x . . . . . . . . . . .' });
    p.playMode = 'song';
    p.sections = [
      { id: 's1', name: 'Intro', bars: 2, patternByTrack: { [p.tracks[0]!.id]: 'A' } },
      { id: 's2', name: 'Drop', bars: 1, patternByTrack: { [p.tracks[0]!.id]: 'B' } },
      { id: 's3', name: 'Break', bars: 1, patternByTrack: { [p.tracks[0]!.id]: null } },
    ];
    const r = render([...projectCommands(p), START], 5 * 2 + 0.1);
    // Intro (bars 0-1): step 0; Drop (bar 2): step 4; Break (bar 3): silent; then the song loops.
    expect(onsetSteps(r.left)).toEqual([0, 16, 32 + 4, 64, 80]);
    const songEvents = r.events.filter((e) => e.type === 'song').map((e) => (e.type === 'song' ? `${e.section}:${e.bar}` : ''));
    expect(songEvents.slice(0, 5)).toEqual(['0:0', '0:1', '1:0', '2:0', '0:0']);
  });
});

describe('mixer', () => {
  it('pan hard left silences the right side; fader at 0 silences the track; 0.8 is unity', () => {
    const base = pingProject({ A: 'x . . . x . . . x . . . x . . .' });
    const left = { ...base, mixer: { ...base.mixer, tracks: base.mixer.tracks.map((c, i) => (i === 0 ? { ...c, pan: -1 } : c)) } };
    const r = render([...projectCommands(left), START], 1);
    expect(peak(r.left)).toBeGreaterThan(0.1);
    expect(peak(r.right)).toBeLessThan(1e-6);
    const zero = { ...base, mixer: { ...base.mixer, tracks: base.mixer.tracks.map((c, i) => (i === 0 ? { ...c, level: 0 } : c)) } };
    expect(peak(render([...projectCommands(zero), START], 1).left)).toBe(0);
    // Default fader (0.8) leaves the level exactly as before the mixer existed.
    const unity = render([...projectCommands(base), START], 1).left;
    const noMixer = render([...projectCommands(base), { type: 'channel', track: 0, level: 0.8, pan: 0, sendB: 0, duck: 0, solo: false }, START], 1).left;
    expect(peak(unity)).toBe(peak(noMixer));
  });

  it('mixer solo plays only soloed tracks', () => {
    const p = defaultProject();
    p.mixer.tracks[1] = { ...p.mixer.tracks[1]!, solo: true }; // SNARE
    const soloed = render([...projectCommands(p), START], 2).left;
    const snareOnly = defaultProject();
    snareOnly.tracks = snareOnly.tracks.map((t, i) => (i === 1 ? t : { ...t, mute: true }));
    const ref = render([...projectCommands(snareOnly), START], 2).left;
    let diff = 0;
    for (let i = 0; i < soloed.length; i++) diff = Math.max(diff, Math.abs(soloed[i]! - ref[i]!));
    expect(diff).toBeLessThan(1e-3); // reverb tails of the muted tracks aside, identical
  });

  it('sidechain ducks the bass right after each kick and recovers', () => {
    const p = defaultProject();
    p.bpm = BPM;
    p.swing = 50;
    // Only kick (track 0) and a sustained bass note (track 3).
    p.tracks = p.tracks.map((t, i) => (i === 0 || i === 3 ? t : { ...t, mute: true }));
    p.tracks[0] = { ...p.tracks[0]!, patterns: { ...p.tracks[0]!.patterns, A: parsePattern('x . . . . . . . x . . . . . . .') } };
    p.tracks[3] = { ...p.tracks[3]!, patterns: { ...p.tracks[3]!.patterns, A: parsePattern('C3 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~') } };
    const withDuck = { ...p, mixer: { ...p.mixer, duckSource: 0, duckRelease: 0.3, tracks: p.mixer.tracks.map((c, i) => (i === 3 ? { ...c, duck: 1 } : c)) } };
    const kickMuted = (q: Project) => ({ ...q, tracks: q.tracks.map((t, i) => (i === 0 ? { ...t, mute: true } : t)) });
    // Listen to the bass alone (kick muted in the mix but still keying the sidechain? No: muted tracks
    // still trigger, so the key keeps working when you mute the kick).
    const ducked = render([...projectCommands(kickMuted(withDuck)), START], 2).left;
    const plain = render([...projectCommands(kickMuted(p)), START], 2).left;
    const at = (b: Float32Array, step: number) => rms(b, Math.round(step * STEP + LAT + 240), Math.round(step * STEP + LAT + 720));
    // Just after the second kick (step 8) the bass is much quieter than without ducking...
    expect(at(ducked, 8) / at(plain, 8)).toBeLessThan(0.4);
    // ...and back to normal before the next kick.
    expect(at(ducked, 15) / at(plain, 15)).toBeGreaterThan(0.8);
  });

  it('a scene mute recalled while playing lands exactly on the next bar', () => {
    const p = pingProject({ A: 'x . . . x . . . x . . . x . . .' });
    const r = render([...projectCommands(p), START], 2 * 2, { at: [{ time: 0.3, cmd: { type: 'mute', track: 0, mute: true, atBar: true } }] });
    // Hits at steps 0, 4, 8, 12 of bar 0 still play; nothing from bar 1 on.
    expect(onsetSteps(r.left)).toEqual([0, 4, 8, 12]);
  });
});

describe('acceptance: a full song plays back identically after reload', () => {
  it('renders bit-identical before and after save + load (IndexedDB)', { timeout: 30_000 }, async () => {
    const p = defaultProject();
    p.name = 'Acceptance';
    p.bpm = 104;
    p.swing = 58;
    // Variations in B, a song with three sections, mixer moves, a recorded FX move.
    p.tracks = p.tracks.map((t) => ({ ...t, patterns: { ...t.patterns, B: t.patterns.A } }));
    p.tracks[2] = { ...p.tracks[2]!, patterns: { ...p.tracks[2]!.patterns, B: parsePattern('x x x x x x x x x x x x x x x x') } };
    const ids = p.tracks.map((t) => t.id);
    const all = (id: PatternId | null) => Object.fromEntries(ids.map((x) => [x, id]));
    p.sections = [
      { id: 'a', name: 'Intro', bars: 2, patternByTrack: { ...all('A'), [ids[3]!]: null } },
      { id: 'b', name: 'Main', bars: 2, patternByTrack: all('B') },
      { id: 'c', name: 'Out', bars: 1, patternByTrack: { ...all(null), [ids[5]!]: 'A' } },
    ];
    p.playMode = 'song';
    p.mixer.tracks[1] = { ...p.mixer.tracks[1]!, pan: -0.5, sendB: 0.3 };
    p.mixer.tracks[4] = { ...p.mixer.tracks[4]!, level: 0.6 };
    p.fxMoves = { A: [{ at: 4, fx: 'gate', on: true, x: 0.5, y: 1, target: -1 }, { at: 8, fx: 'gate', on: false, x: 0.5, y: 1, target: -1 }] };
    const seconds = ((5 * 4 * 60) / 104) + 0.5;
    const before = render([...projectCommands(p), START], seconds);
    await saveProject(p);
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    const after = render([...projectCommands(loaded!), START], seconds);
    expect(peak(before.left)).toBeGreaterThan(0.1);
    expect(after.left).toEqual(before.left);
    expect(after.right).toEqual(before.right);
  });
});
