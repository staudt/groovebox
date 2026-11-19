import { describe, expect, it } from 'vitest';
import { placeControls } from './placeUi';
import { defaultProject } from '../store/defaults';

const sug = { track: 4, slot: 'B' as const, sectionId: null, startStep: 0, repeats: 4 as const, octaveShift: 1, reason: 'x' };

describe('placeControls', () => {
  const p = defaultProject();
  it('adds the octave shift to the base and clamps', () => {
    expect(placeControls(sug, p, [1, 2, 4], 0).oct).toBe(1);
    expect(placeControls({ ...sug, octaveShift: 2 }, p, [1], 3).oct).toBe(4);
  });
  it('limits repeat to the offered options', () => {
    expect(placeControls(sug, p, [1, 2], 0).repeat).toBe(2);
    expect(placeControls({ ...sug, repeats: 1 }, p, [1, 2, 4], 0).repeat).toBe(1);
  });
  it('no section = -1, unknown section id = -1', () => {
    expect(placeControls(sug, p, [1], 0).sectionI).toBe(-1);
    expect(placeControls({ ...sug, sectionId: 'nope' }, p, [1], 0).sectionI).toBe(-1);
  });
});
