// Sample store: the built-in CC0 kit plus the user's samples (recordings, files, resamples).
// Audio lives in OPFS (one file per sample) with metadata in IndexedDB; where OPFS is unavailable
// the audio is kept in IndexedDB too. Everything here runs on the main thread.
import { SAMPLES, run } from './persist';

export type Sample = { l: Float32Array; r?: Float32Array; rate: number };
export type SampleMeta = { id: string; name: string; rate: number; frames: number; channels: 1 | 2; created: number; source: 'record' | 'file' | 'resample' };

export const KIT_PREFIX = 'kit:';
export const KIT_SOUNDS = [
  'kick', 'snare', 'sidestick', 'clap', 'hatClosed', 'hatPedal', 'hatOpen', 'ride',
  'rideBell', 'crash', 'crash2', 'tomHigh', 'tomMid', 'tomFloor', 'tambourine', 'cowbell',
] as const;

type KitJson = { file: string; sampleRate: number; sounds: Record<string, { start: number; duration: number; gain: number }> };

let kitP: Promise<Map<string, Sample>> | null = null;

/** Decodes audio without needing a running AudioContext (no user gesture required). */
async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes);
}

/** Loads and slices the built-in kit once (cached; also precached by the service worker). */
export function loadKit(base = './kits/virtuosity/'): Promise<Map<string, Sample>> {
  if (!kitP) {
    kitP = (async () => {
      const meta = (await (await fetch(base + 'kit.json')).json()) as KitJson;
      const buf = await decode(await (await fetch(base + meta.file)).arrayBuffer());
      const data = buf.getChannelData(0);
      const out = new Map<string, Sample>();
      for (const [name, s] of Object.entries(meta.sounds)) {
        const a = Math.round(s.start * buf.sampleRate);
        const b = Math.min(data.length, a + Math.round(s.duration * buf.sampleRate));
        const l = data.slice(a, b);
        if (s.gain !== 1) for (let i = 0; i < l.length; i++) l[i] = l[i]! * s.gain;
        out.set(KIT_PREFIX + name, { l, rate: buf.sampleRate });
      }
      return out;
    })();
    kitP.catch(() => (kitP = null));
  }
  return kitP;
}

const opfsDir = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('samples', { create: true });
  } catch {
    return null;
  }
};

/** Serialized audio: [l | r] float32 frames back to back (r only for stereo). */
function pack(s: Sample): ArrayBuffer {
  const n = s.l.length;
  const out = new Float32Array(s.r ? n * 2 : n);
  out.set(s.l, 0);
  if (s.r) out.set(s.r, n);
  return out.buffer;
}

function unpack(buf: ArrayBuffer, meta: SampleMeta): Sample {
  const all = new Float32Array(buf);
  const n = meta.frames;
  return meta.channels === 2 ? { l: all.slice(0, n), r: all.slice(n, 2 * n), rate: meta.rate } : { l: all.slice(0, n), rate: meta.rate };
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Saves a sample and returns its id. */
export async function saveSample(name: string, s: Sample, source: SampleMeta['source']): Promise<string> {
  const id = newId();
  const meta: SampleMeta = { id, name: name.slice(0, 40) || 'Sample', rate: s.rate, frames: s.l.length, channels: s.r ? 2 : 1, created: Date.now(), source };
  const dir = await opfsDir();
  if (dir) {
    const fh = await dir.getFileHandle(`${id}.f32`, { create: true });
    const w = await fh.createWritable();
    await w.write(pack(s));
    await w.close();
    await run(SAMPLES, 'readwrite', (st) => st.put(meta));
  } else {
    await run(SAMPLES, 'readwrite', (st) => st.put({ ...meta, audio: pack(s) }));
  }
  cache.set(id, s);
  return id;
}

export async function listSamples(): Promise<SampleMeta[]> {
  try {
    const all = await run(SAMPLES, 'readonly', (st) => st.getAll() as IDBRequest<(SampleMeta & { audio?: ArrayBuffer })[]>);
    return all.map(({ audio: _a, ...m }) => m).sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

export async function renameSample(id: string, name: string): Promise<void> {
  const m = await run(SAMPLES, 'readonly', (st) => st.get(id) as IDBRequest<SampleMeta | undefined>);
  if (m) await run(SAMPLES, 'readwrite', (st) => st.put({ ...m, name: name.slice(0, 40) }));
}

export async function deleteSample(id: string): Promise<void> {
  cache.delete(id);
  const dir = await opfsDir();
  if (dir) await dir.removeEntry(`${id}.f32`).catch(() => {});
  await run(SAMPLES, 'readwrite', (st) => st.delete(id));
}

const cache = new Map<string, Sample>();

/** Loads a sample by id (kit or user). Resolves null if it no longer exists. */
export async function getSample(id: string): Promise<Sample | null> {
  if (id.startsWith(KIT_PREFIX)) return (await loadKit()).get(id) ?? null;
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const m = await run(SAMPLES, 'readonly', (st) => st.get(id) as IDBRequest<(SampleMeta & { audio?: ArrayBuffer }) | undefined>);
    if (!m) return null;
    let buf = m.audio;
    if (!buf) {
      const dir = await opfsDir();
      if (!dir) return null;
      buf = await (await (await dir.getFileHandle(`${id}.f32`)).getFile()).arrayBuffer();
    }
    const s = unpack(buf, m);
    cache.set(id, s);
    return s;
  } catch {
    return null;
  }
}

/** Decodes an audio file (wav, mp3, ogg, m4a… whatever the browser supports) into a sample. */
export async function decodeFile(file: Blob): Promise<Sample> {
  const b = await decode(await file.arrayBuffer());
  const l = b.getChannelData(0).slice();
  return b.numberOfChannels > 1 ? { l, r: b.getChannelData(1).slice(), rate: b.sampleRate } : { l, rate: b.sampleRate };
}
