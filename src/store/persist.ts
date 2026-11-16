// IndexedDB persistence: the current project (autosaved on idle) and the user's FM patch library.
// Small hand-written wrapper; no runtime dependency.
import { effect } from '@preact/signals';
import type { FmPatch, Project } from './types';
import { SCHEMA_VERSION, defaultProject, samplerParams } from './defaults';
import { clampPatch, project, resetProject } from './project';

const DB = 'groovebox';
const DB_VERSION = 2;
const PROJECTS = 'projects';
const PATCHES = 'patches';
const CURRENT = 'current';
/** Sample metadata (and the audio itself where OPFS is unavailable); see samples.ts. */
export const SAMPLES = 'samples';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(PROJECTS)) d.createObjectStore(PROJECTS);
        if (!d.objectStoreNames.contains(PATCHES)) d.createObjectStore(PATCHES, { keyPath: 'name' });
        if (!d.objectStoreNames.contains(SAMPLES)) d.createObjectStore(SAMPLES, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export function run<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = f(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Upgrades older saved projects to the current schema; returns null if the data is unusable. */
export function migrate(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Project;
  if (typeof p.version !== 'number' || p.version > SCHEMA_VERSION) return null;
  if (!Array.isArray(p.tracks) || p.tracks.length !== 8) return null;
  let out = p;
  // v1 -> v2: real sampler params; PERC (a drum stand-in until the sampler existed) becomes a kit sampler.
  if (out.version < 2) {
    out = {
      ...out,
      version: 2,
      tracks: out.tracks.map((t) => {
        if (t.kind === 'sampler') return { ...t, params: { ...samplerParams(), ...(t.params as object), kind: 'sampler' as const } };
        if (t.name === 'PERC' && t.kind === 'drum') return { ...t, kind: 'sampler' as const, params: samplerParams('kit:tambourine', 'tambourine') };
        return t;
      }),
    };
  }
  return out;
}

export async function saveProject(p: Project): Promise<void> {
  await run(PROJECTS, 'readwrite', (s) => s.put(p, CURRENT));
}

export async function loadProject(): Promise<Project | null> {
  try {
    return migrate(await run(PROJECTS, 'readonly', (s) => s.get(CURRENT)));
  } catch {
    return null;
  }
}

export async function savePatch(patch: FmPatch): Promise<void> {
  await run(PATCHES, 'readwrite', (s) => s.put(clampPatch(patch)));
}

export async function listPatches(): Promise<FmPatch[]> {
  try {
    const all = await run(PATCHES, 'readonly', (s) => s.getAll() as IDBRequest<FmPatch[]>);
    return all.map(clampPatch).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function deletePatch(name: string): Promise<void> {
  await run(PATCHES, 'readwrite', (s) => s.delete(name));
}

const idle = (f: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(f, { timeout: 2000 });
  else setTimeout(f, 200);
};

/**
 * Restores the saved project (if any) and then autosaves every change, debounced and on idle.
 * Call once at startup before rendering. Storage failures never break the app.
 */
export async function startPersistence(debounceMs = 800): Promise<void> {
  const saved = await loadProject();
  resetProject(saved ?? defaultProject());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let first = true;
  effect(() => {
    const p = project.value;
    if (first) {
      first = false;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => idle(() => void saveProject(p).catch(() => {})), debounceMs);
  });
  // Flush when the page is hidden (app switch, tab close) so the last edit is not lost.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void saveProject(project.peek()).catch(() => {});
    });
  }
}
