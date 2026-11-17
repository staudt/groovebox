import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultProject } from '../../src/store/defaults';
import { apply, project, resetProject, undo } from '../../src/store/project';
import { presetByName } from '../../src/store/fmPresets';
import * as persist from '../../src/store/persist';

// Build a database exactly as the previous release left it (v2: single 'current' record).
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('groovebox', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('projects');
      d.createObjectStore('patches', { keyPath: 'name' });
      d.createObjectStore('samples', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction(['projects', 'patches', 'samples'], 'readwrite');
      tx.objectStore('projects').put({ ...defaultProject(), name: 'Old song', bpm: 111 }, 'current');
      tx.objectStore('patches').put({ ...presetByName('Bell'), name: 'My bell' });
      tx.objectStore('samples').put({ id: 's1', name: 'kick', rate: 44100, frames: 1, channels: 1, created: 1, source: 'file' });
      tx.oncomplete = () => { d.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
});

describe('multiple projects', () => {
  it('migrates the old single record: project, patches and samples are kept', async () => {
    const p = await persist.loadProject();
    expect(p?.name).toBe('Old song');
    expect(p?.bpm).toBe(111);
    expect((await persist.listPatches()).map((x) => x.name)).toEqual(['My bell']);
    expect((await persist.listProjects()).map((x) => x.name)).toEqual(['Old song']);
    const raw = await persist.run(persist.SAMPLES, 'readonly', (s) => s.get('s1'));
    expect((raw as { name: string }).name).toBe('kick');
    // The legacy key is gone.
    expect(await persist.run('projects', 'readonly', (s) => s.get('current'))).toBeUndefined();
  });

  it('create, open, duplicate, rename, delete', async () => {
    const old = (await persist.loadProject())!;
    resetProject(old);
    const b = await persist.createProject();
    expect(b.id).not.toBe(old.id);
    expect(project.peek().id).toBe(b.id);
    expect(await persist.currentProjectId()).toBe(b.id);
    expect((await persist.listProjects()).length).toBe(2);

    expect(await persist.openProject(old.id)).toBe(true);
    expect(project.peek().name).toBe('Old song');

    const copy = (await persist.duplicateProject(old.id))!;
    expect(copy.id).not.toBe(old.id);
    expect(copy.name).toBe('Old song copy');
    expect(copy.bpm).toBe(111);

    await persist.renameProject(copy.id, 'Renamed');
    expect((await persist.listProjects()).find((x) => x.id === copy.id)?.name).toBe('Renamed');
    await persist.renameProject(old.id, 'Open one'); // current: undoable command
    expect(project.peek().name).toBe('Open one');

    await persist.deleteProject(copy.id);
    expect((await persist.listProjects()).map((x) => x.id).sort()).toEqual([old.id, b.id].sort());
    // Deleting the open project opens another.
    await persist.deleteProject(old.id);
    expect(project.peek().id).toBe(b.id);
    expect((await persist.listProjects()).map((x) => x.id)).toEqual([b.id]);
    // Deleting the last one creates a new one.
    await persist.deleteProject(b.id);
    const left = await persist.listProjects();
    expect(left.length).toBe(1);
    expect(left[0]!.id).not.toBe(b.id);
    expect(project.peek().id).toBe(left[0]!.id);
  });
});

describe('version history', () => {
  it('spaces versions by 60 s, caps at 20, and restore is undoable', async () => {
    let t = 1_000_000;
    persist.setClock(() => t);
    const p0 = await persist.createProject();
    for (let i = 0; i < 30; i++) {
      t += 30_000; // saves 30 s apart: every other one is skipped
      await persist.snapshotVersion({ ...p0, bpm: 60 + i });
    }
    for (let i = 0; i < 10; i++) {
      t += 61_000;
      expect(await persist.snapshotVersion({ ...p0, bpm: 100 + i })).toBe(true);
    }
    const vs = await persist.listVersions(p0.id);
    expect(vs.length).toBe(20);
    for (let i = 1; i < vs.length; i++) expect(vs[i - 1]!.ts - vs[i]!.ts).toBeGreaterThanOrEqual(60_000);
    expect(vs[0]!.size).toBeGreaterThan(1000);

    // Within 60 s: no snapshot.
    expect(await persist.snapshotVersion({ ...p0, bpm: 99 })).toBe(false);
    t += 5000;
    // Forced snapshot of identical content is skipped; changed content is taken.
    expect(await persist.snapshotVersion({ ...p0, bpm: 99 }, true)).toBe(true);
    expect(await persist.snapshotVersion({ ...p0, bpm: 99 }, true)).toBe(false);

    // Restore the oldest kept version into the open project; undo brings the edit back.
    resetProject({ ...p0, bpm: 150 });
    const target = (await persist.listVersions(p0.id)).at(-1)!;
    expect(await persist.restoreVersion(p0.id, target.ts)).toBe(true);
    expect(project.peek().bpm).not.toBe(150);
    undo();
    expect(project.peek().bpm).toBe(150);
    expect(await persist.restoreVersion('other', target.ts)).toBe(false);
    apply({ type: 'setName', name: 'x' });
    persist.setClock(null);
  });
});
