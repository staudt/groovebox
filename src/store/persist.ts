// IndexedDB persistence: the current project (autosaved on idle) and the user's FM patch library.
// Small hand-written wrapper; no runtime dependency.
import { effect } from '@preact/signals';
import type { FmPatch, Project } from './types';
import { SCHEMA_VERSION, defaultMixer, defaultProject, samplerParams } from './defaults';
import { apply, clampPatch, project, resetProject } from './project';

const DB = 'groovebox';
const DB_VERSION = 3;
/** One record per project, keyed by project id. (Before v3 a single record lived under the key 'current'.) */
const PROJECTS = 'projects';
const PATCHES = 'patches';
/** Small key/value records: 'current' = id of the open project, 'u:<id>' = last saved time. */
const META = 'meta';
/** Version history: key [projectId, ts], value { ts, size, project }. */
const VERSIONS = 'versions';
const LEGACY_CURRENT = 'current';
export const MAX_VERSIONS = 20;
export const VERSION_SPACING_MS = 60_000;
/** Sample metadata (and the audio itself where OPFS is unavailable); see samples.ts. */
export const SAMPLES = 'samples';

let dbp: Promise<IDBDatabase> | null = null;

const newId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

let clock: () => number = () => Date.now();
/** Test hook: replaces the time source used for "updated" times and version spacing. */
export function setClock(f: (() => number) | null): void {
  clock = f ?? (() => Date.now());
}

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        const tx = req.transaction!;
        if (!d.objectStoreNames.contains(PROJECTS)) d.createObjectStore(PROJECTS);
        if (!d.objectStoreNames.contains(PATCHES)) d.createObjectStore(PATCHES, { keyPath: 'name' });
        if (!d.objectStoreNames.contains(SAMPLES)) d.createObjectStore(SAMPLES, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        if (!d.objectStoreNames.contains(VERSIONS)) d.createObjectStore(VERSIONS);
        // v2 -> v3: the single 'current' record moves to its own id; patches and samples are not touched.
        const projects = tx.objectStore(PROJECTS);
        const get = projects.get(LEGACY_CURRENT);
        get.onsuccess = () => {
          const rec = get.result as { id?: unknown } | undefined;
          if (!rec) return;
          const id = typeof rec.id === 'string' && rec.id && rec.id !== LEGACY_CURRENT ? rec.id : newId();
          projects.put(id === rec.id ? rec : { ...rec, id }, id);
          projects.delete(LEGACY_CURRENT);
          const meta = tx.objectStore(META);
          meta.put(id, LEGACY_CURRENT);
          meta.put(clock(), `u:${id}`);
        };
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

/** Test hook: forgets the open connection (after closing it) so the next call reopens the database. */
export async function _closeDb(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = null;
}

/** Runs `f` in one transaction over several stores; resolves when the transaction commits. */
function multi<T>(stores: string[], mode: IDBTransactionMode, f: (tx: IDBTransaction) => IDBRequest<T> | undefined): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(stores, mode);
        const req = f(tx);
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
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
  // v2 -> v3: full mixer (levels, pan, delay send, sidechain), play mode.
  if (out.version < 3) {
    const old = out.mixer as Partial<typeof out.mixer> | undefined;
    const fresh = defaultMixer();
    out = {
      ...out,
      version: 3,
      mixer: { ...fresh, master: old?.master ?? fresh.master, tracks: fresh.tracks.map((c) => ({ ...c, duck: 0 })) },
      playMode: 'loop',
      sections: out.sections ?? [],
      scenes: out.scenes ?? [],
    };
  }
  return out;
}

/** Writes `p` under its own id, marks it as the current project and stamps its updated time. */
export async function saveProject(p: Project): Promise<void> {
  const t = clock();
  await multi([PROJECTS, META], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).put(p, p.id);
    tx.objectStore(META).put(t, `u:${p.id}`);
    return tx.objectStore(META).put(p.id, LEGACY_CURRENT);
  });
}

async function readMeta<T>(key: string): Promise<T | undefined> {
  return (await run(META, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)) as T | undefined;
}

/** Id of the project that was open last, if any. */
export async function currentProjectId(): Promise<string | null> {
  try {
    return (await readMeta<string>(LEGACY_CURRENT)) ?? null;
  } catch {
    return null;
  }
}

async function loadById(id: string): Promise<Project | null> {
  try {
    return migrate(await run(PROJECTS, 'readonly', (s) => s.get(id)));
  } catch {
    return null;
  }
}

/** The current project (as recorded in meta), migrated; null when there is none. */
export async function loadProject(): Promise<Project | null> {
  const id = await currentProjectId();
  return id ? loadById(id) : null;
}

// ---- Version history -------------------------------------------------------------------------

type VersionRec = { ts: number; size: number; project: Project };
export type VersionInfo = { ts: number; size: number };
const vRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

async function versionRecs(id: string): Promise<VersionRec[]> {
  return (await run(VERSIONS, 'readonly', (s) => s.getAll(vRange(id)) as IDBRequest<VersionRec[]>)) ?? [];
}

/** Newest first. */
export async function listVersions(projectId: string): Promise<VersionInfo[]> {
  try {
    return (await versionRecs(projectId)).map((v) => ({ ts: v.ts, size: v.size })).sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * Takes a snapshot of `p` when the project's latest version is at least 60 s old.
 * `force` (page hidden, before a restore) ignores the spacing but still skips an unchanged project.
 * Keeps the newest 20 versions. Returns true when a version was written.
 */
export async function snapshotVersion(p: Project, force = false): Promise<boolean> {
  const t = clock();
  const recs = await versionRecs(p.id);
  const latest = recs.reduce<VersionRec | null>((m, v) => (!m || v.ts > m.ts ? v : m), null);
  const json = JSON.stringify(p);
  if (latest) {
    if (force ? JSON.stringify(latest.project) === json : t - latest.ts < VERSION_SPACING_MS) return false;
  }
  const ts = latest && t <= latest.ts ? latest.ts + 1 : t;
  const old = recs.map((v) => v.ts).sort((a, b) => a - b);
  const drop = old.slice(0, Math.max(0, old.length + 1 - MAX_VERSIONS));
  await run(VERSIONS, 'readwrite', (s) => {
    for (const d of drop) s.delete([p.id, d]);
    return s.put({ ts, size: json.length, project: p } satisfies VersionRec, [p.id, ts]);
  });
  return true;
}

/** Applies a saved version to the open project as an undoable replaceProject. False if it is gone. */
export async function restoreVersion(projectId: string, ts: number): Promise<boolean> {
  const rec = await run(VERSIONS, 'readonly', (s) => s.get([projectId, ts]) as IDBRequest<VersionRec | undefined>);
  const p = rec ? migrate(rec.project) : null;
  if (!p || project.peek().id !== projectId) return false;
  // Keep what is being replaced reachable from the history too.
  await snapshotVersion(project.peek(), true).catch(() => {});
  apply({ type: 'replaceProject', project: p });
  return true;
}

// ---- Multiple projects -----------------------------------------------------------------------

export type ProjectInfo = { id: string; name: string; updated: number };

/** All saved projects, most recently updated first. */
export async function listProjects(): Promise<ProjectInfo[]> {
  try {
    const raws = (await run(PROJECTS, 'readonly', (s) => s.getAll() as IDBRequest<{ id?: unknown; name?: unknown }[]>)) ?? [];
    const list: ProjectInfo[] = [];
    for (const raw of raws) {
      if (typeof raw.id !== 'string') continue;
      const updated = (await readMeta<number>(`u:${raw.id}`)) ?? 0;
      list.push({ id: raw.id, name: typeof raw.name === 'string' ? raw.name : 'Untitled groove', updated });
    }
    return list.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

let lastSaved: Project | null = null;
let flushPending: (() => Promise<void>) | null = null;

/** Saves any debounced edit of the open project right now. */
async function flushNow(): Promise<void> {
  if (flushPending) await flushPending();
}

function switchTo(p: Project): void {
  lastSaved = p;
  resetProject(p);
}

/** Opens a saved project (the open one is saved first). Resolves false if it cannot be read. */
export async function openProject(id: string): Promise<boolean> {
  await flushNow();
  const p = await loadById(id);
  if (!p) return false;
  await run(META, 'readwrite', (s) => s.put(id, LEGACY_CURRENT));
  switchTo(p);
  return true;
}

/** A fresh default project with a new id; it becomes the open one. */
export async function createProject(): Promise<Project> {
  await flushNow();
  const p: Project = { ...defaultProject(), id: newId() };
  await saveProject(p);
  switchTo(p);
  return p;
}

export async function duplicateProject(id: string): Promise<Project | null> {
  await flushNow();
  const src = await loadById(id);
  if (!src) return null;
  const copy: Project = { ...structuredClone(src), id: newId(), name: `${src.name} copy`.slice(0, 40) };
  await multi([PROJECTS, META], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).put(copy, copy.id);
    return tx.objectStore(META).put(clock(), `u:${copy.id}`);
  });
  return copy;
}

/** Deletes a project and its history. Deleting the open one first opens another (or a new one). */
export async function deleteProject(id: string): Promise<void> {
  if (project.peek().id === id) {
    const others = (await listProjects()).filter((p) => p.id !== id);
    if (!(others[0] && (await openProject(others[0].id)))) await createProject();
  }
  await multi([PROJECTS, META, VERSIONS], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(META).delete(`u:${id}`);
    return tx.objectStore(VERSIONS).delete(vRange(id));
  });
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 40) || 'Untitled groove';
  if (project.peek().id === id) {
    apply({ type: 'setName', name: clean });
    return;
  }
  const raw = (await run(PROJECTS, 'readonly', (s) => s.get(id))) as Project | undefined;
  if (raw) await run(PROJECTS, 'readwrite', (s) => s.put({ ...raw, name: clean }, id));
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
 * Restores the open project (if any) and then autosaves every change, debounced and on idle,
 * snapshotting a version at most once a minute. Call once at startup before rendering.
 * Storage failures never break the app.
 */
export async function startPersistence(debounceMs = 800): Promise<void> {
  const saved = await loadProject();
  switchTo(saved ?? { ...defaultProject(), id: newId() });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = async (p: Project, force = false): Promise<void> => {
    if (p === lastSaved && !force) return;
    lastSaved = p;
    await saveProject(p).catch(() => {});
    await snapshotVersion(p, force).catch(() => {});
  };
  flushPending = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await save(project.peek());
  };
  effect(() => {
    const p = project.value;
    if (p === lastSaved) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      idle(() => void save(p));
    }, debounceMs);
  });
  // Flush when the page is hidden (app switch, tab close) so the last edit is not lost.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void save(project.peek(), true);
      }
    });
  }
}
