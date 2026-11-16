import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { listPatches, loadProject, migrate, savePatch, deletePatch, saveProject } from '../../src/store/persist';
import { defaultProject } from '../../src/store/defaults';
import { presetByName } from '../../src/store/fmPresets';

describe('persistence', () => {
  it('saves and loads the project', async () => {
    const p = { ...defaultProject(), bpm: 133, name: 'Saved' };
    await saveProject(p);
    const back = await loadProject();
    expect(back?.bpm).toBe(133);
    expect(back?.name).toBe('Saved');
    expect(back?.tracks[3]!.patterns.A).toEqual(p.tracks[3]!.patterns.A);
  });

  it('patch library: save, list sorted, overwrite by name, clamp, delete', async () => {
    await savePatch({ ...presetByName('Bell'), name: 'Zeta' });
    await savePatch({ ...presetByName('Brass'), name: 'Alpha', algorithm: 99 });
    await savePatch({ ...presetByName('Brass'), name: 'Alpha', feedback: 3 });
    let list = await listPatches();
    expect(list.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
    expect(list[0]!.feedback).toBe(3);
    expect(list[0]!.algorithm).toBeLessThanOrEqual(32);
    await deletePatch('Zeta');
    list = await listPatches();
    expect(list.map((p) => p.name)).toEqual(['Alpha']);
  });

  it('rejects unusable or newer data', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ version: 999, tracks: [] })).toBeNull();
    expect(migrate({ ...defaultProject(), tracks: [] })).toBeNull();
    expect(migrate(defaultProject())).not.toBeNull();
  });
});
