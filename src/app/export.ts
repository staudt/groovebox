// Offline export: renders the project with the real worklet (same engine and the same
// project -> command translation as live playback) and downloads WAV or a zip of stems.
import workletUrl from '../engine/worklet.ts?worker&url';
import type { EngineCommand } from '../engine/protocol';
import type { EngineProcessorOptions } from '../engine/worklet';
import { projectToCommands } from '../engine/sync';
import { getSample } from '../store/samples';
import type { PatternId, Project, SamplerParams } from '../store/types';
import { getAudioContext } from '../platform/audio';
import { toWav } from './wav';
import { zip } from './zip';

export const TAIL_SECONDS = 2;
export type ExportOptions = { bars: number; onProgress?: (done: number, total: number, label: string) => void };

const isSong = (p: Project): boolean => p.playMode === 'song' && p.sections.length > 0;

/** Bars to render: the whole song once, or `loopBars` in loop mode. */
export function exportBars(p: Project, loopBars: number): number {
  return isSong(p) ? p.sections.reduce((n, s) => n + s.bars, 0) : loopBars;
}

export const exportFrames = (p: Project, bars: number, sr: number): number => Math.round(((sr * 60) / p.bpm) * 4 * bars + TAIL_SECONDS * sr);

const playsSomething = (p: Project['tracks'][number], id: PatternId): boolean => p.patterns[id].steps.some((s) => s.t !== 'rest' && s.t !== 'hold');

/** Track indexes that have notes in the range that would be rendered. */
export function activeTracks(p: Project, current: PatternId): number[] {
  const out: number[] = [];
  p.tracks.forEach((t, i) => {
    const on = isSong(p)
      ? p.sections.some((s) => {
          const id = s.patternByTrack[t.id];
          return id ? playsSomething(t, id) : false;
        })
      : playsSomething(t, current);
    if (on) out.push(i);
  });
  return out;
}

const deviceRate = (): number => {
  try {
    const r = getAudioContext().sampleRate;
    return r === 44100 || r === 48000 ? r : 48000;
  } catch {
    return 48000;
  }
};

async function sampleCommands(p: Project): Promise<EngineCommand[]> {
  const ids = new Set<string>();
  for (const t of p.tracks) if (t.kind === 'sampler') {
    const id = (t.params as SamplerParams).sampleId;
    if (id) ids.add(id);
  }
  const out: EngineCommand[] = [];
  for (const id of ids) {
    const s = await getSample(id);
    if (s) out.push({ type: 'sample', id, l: s.l, ...(s.r ? { r: s.r } : {}), rate: s.rate });
  }
  return out;
}

async function renderCommands(commands: EngineCommand[], frames: number, sr: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: sr });
  await ctx.audioWorklet.addModule(workletUrl);
  const processorOptions: EngineProcessorOptions = { commands };
  const node = new AudioWorkletNode(ctx, 'groovebox-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

const play: EngineCommand = { type: 'transport', playing: true };

/** Renders the mix; resolves with a 16-bit stereo WAV. */
export async function renderMix(p: Project, current: PatternId, opts: ExportOptions): Promise<{ wav: Uint8Array; sr: number }> {
  const sr = deviceRate();
  opts.onProgress?.(0, 1, 'Rendering');
  const cmds = [...(await sampleCommands(p)), ...projectToCommands(p, current), play];
  const ch = await renderCommands(cmds, exportFrames(p, exportBars(p, opts.bars), sr), sr);
  opts.onProgress?.(1, 1, 'Rendering');
  return { wav: toWav(ch, sr), sr };
}

/** One WAV per active track (that track soloed), packed into a zip. Null when no track has notes. */
export async function renderStems(p: Project, current: PatternId, opts: ExportOptions): Promise<Uint8Array | null> {
  const sr = deviceRate();
  const active = activeTracks(p, current);
  if (active.length === 0) return null;
  const samples = await sampleCommands(p);
  const frames = exportFrames(p, exportBars(p, opts.bars), sr);
  const files: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  for (let k = 0; k < active.length; k++) {
    const i = active[k]!;
    opts.onProgress?.(k + 1, active.length, `Rendering ${k + 1}/${active.length}`);
    const solo: Project = {
      ...p,
      tracks: p.tracks.map((t, j) => (j === i ? { ...t, mute: false } : t)),
      mixer: { ...p.mixer, tracks: p.mixer.tracks.map((c, j) => ({ ...c, solo: j === i })) },
    };
    const ch = await renderCommands([...samples, ...projectToCommands(solo, current), play], frames, sr);
    let base = fileSafe(p.tracks[i]!.name, `TRACK${i + 1}`);
    while (used.has(base)) base += `_${i + 1}`;
    used.add(base);
    files.push({ name: `${base}.wav`, data: toWav(ch, sr) });
    await new Promise((r) => setTimeout(r, 0)); // let the UI breathe between renders
  }
  return zip(files);
}

export function fileSafe(name: string, fallback: string): string {
  const s = name.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '_');
  return s || fallback;
}

/** Hands bytes to the browser as a download (Blob URL + <a download>). */
export function download(data: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportWav(p: Project, current: PatternId, opts: ExportOptions): Promise<void> {
  const { wav } = await renderMix(p, current, opts);
  download(wav, `${fileSafe(p.name, 'groovebox')}.wav`, 'audio/wav');
}

/** Returns false when there was nothing to export. */
export async function exportStems(p: Project, current: PatternId, opts: ExportOptions): Promise<boolean> {
  const z = await renderStems(p, current, opts);
  if (!z) return false;
  download(z, `${fileSafe(p.name, 'groovebox')}-stems.zip`, 'application/zip');
  return true;
}
