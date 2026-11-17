import { describe, expect, it } from 'vitest';
import { defaultProject } from './defaults';
import { currentMutes, cycleCell, duplicateSection, makeSection, moveSection, nextPattern, sameMutes, sceneName } from './songEdit';

describe('songEdit', () => {
  it('cycles patterns A B C D then silent then A', () => {
    expect([nextPattern('A'), nextPattern('D'), nextPattern(null)]).toEqual(['B', null, 'A']);
  });
  it('makes a section with every track on one pattern', () => {
    const s = makeSection(defaultProject(), 'B');
    expect(s.bars).toBe(4);
    expect(Object.values(s.patternByTrack)).toEqual(new Array(8).fill('B'));
  });
  it('cycles one cell only', () => {
    const p = defaultProject();
    const secs = [makeSection(p, 'A'), makeSection(p, 'A')];
    const out = cycleCell(secs, 1, 't3');
    expect(out[1]!.patternByTrack['t3']).toBe('B');
    expect(out[0]).toBe(secs[0]);
    expect(out[1]!.patternByTrack['t2']).toBe('A');
  });
  it('moves and duplicates', () => {
    const p = defaultProject();
    const a = makeSection(p, 'A', 4, 'X');
    const b = makeSection(p, 'B', 2, 'Y');
    expect(moveSection([a, b], 0, 1).map((s) => s.name)).toEqual(['Y', 'X']);
    expect(moveSection([a, b], 0, -1)).toEqual([a, b]);
    const d = duplicateSection([a, b], 0);
    expect(d.map((s) => s.name)).toEqual(['X', 'X 2', 'Y']);
    expect(d[1]!.id).not.toBe(a.id);
  });
  it('scene mutes round-trip', () => {
    const p = defaultProject();
    const scene = { id: 'x', name: 'Scene 1', mutes: currentMutes(p) };
    expect(sameMutes(p, scene)).toBe(true);
    expect(sceneName([scene])).toBe('Scene 2');
  });
});
