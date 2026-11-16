// Main-thread side of the engine: owns the AudioContext and the worklet node,
// mirrors the project store into engine commands, and exposes playhead/meters for rAF readers.
import { effect } from '@preact/signals';
import workletUrl from './worklet.ts?worker&url';
import type { EngineCommand, EngineEvent } from './protocol';
import type { FxId } from './fx/ids';
import { currentPattern, playing, project, selectedTrack, soloSelected } from '../store/project';
import type { DrumParams, FmPatch, Project, SamplerParams, Track } from '../store/types';
import { getSample } from '../store/samples';
import { ensureRunning, getAudioContext } from '../platform/audio';

let node: AudioWorkletNode | null = null;
let starting: Promise<void> | null = null;

// Recent step events (time-ordered). Read by rAF code; never triggers renders.
const STEP_RING = 32;
const stepTimes = new Float64Array(STEP_RING);
const stepIdx = new Int32Array(STEP_RING).fill(-1);
let stepWrite = 0;
const meters = { tracks: new Float32Array(8), master: 0 };

function post(cmd: EngineCommand): void {
  node?.port.postMessage(cmd);
}

function clearSteps(): void {
  stepIdx.fill(-1);
  stepTimes.fill(0);
}

function onEvent(ev: EngineEvent): void {
  if (ev.type === 'step' && ev.step < 0) {
    clearSteps();
  } else if (ev.type === 'step') {
    stepTimes[stepWrite] = ev.time;
    stepIdx[stepWrite] = ev.step;
    stepWrite = (stepWrite + 1) % STEP_RING;
  } else if (ev.type === 'resampled') {
    const done = pendingResamples.get(ev.id);
    pendingResamples.delete(ev.id);
    done?.({ l: ev.l, r: ev.r, rate: getAudioContext().sampleRate });
  } else if (ev.type === 'meters') {
    for (let i = 0; i < 8; i++) meters.tracks[i] = ev.tracks[i] ?? 0;
    meters.master = ev.master;
  }
}

/**
 * Global step index currently audible (accounts for output latency), or -1 when stopped.
 * Cheap; call from requestAnimationFrame. Map to a pattern step with `step % length`.
 */
export function audibleStep(): number {
  if (!node) return -1;
  const ctx = getAudioContext();
  const now = ctx.currentTime - (ctx.outputLatency || 0);
  let best = -1;
  let bestT = -Infinity;
  for (let i = 0; i < STEP_RING; i++) {
    const t = stepTimes[i]!;
    if (stepIdx[i]! >= 0 && t <= now && t > bestT) {
      bestT = t;
      best = stepIdx[i]!;
    }
  }
  return best;
}

/**
 * Audible song position in 16th steps (fractional), or -1 when stopped. Uses the latest step event
 * and the time since it. For recording performance moves at the position the player hears.
 */
export function songPosition(): number {
  if (!node) return -1;
  const ctx = getAudioContext();
  const now = ctx.currentTime - (ctx.outputLatency || 0);
  let best = -1;
  let bestT = -Infinity;
  for (let i = 0; i < STEP_RING; i++) {
    const t = stepTimes[i]!;
    if (stepIdx[i]! >= 0 && t <= now && t > bestT) {
      bestT = t;
      best = stepIdx[i]!;
    }
  }
  if (best < 0) return -1;
  const stepDur = 60 / project.peek().bpm / 4;
  return best + Math.min(0.999, (now - bestT) / stepDur);
}

export function readMeters(): Readonly<{ tracks: Float32Array; master: number }> {
  return meters;
}

const engineKind = (t: Track) => t.kind;

// Samples already sent to the engine (by id), and loads in flight.
const loadedSamples = new Set<string>();
const loadingSamples = new Map<string, Promise<void>>();

/** Makes sure the engine has sample `id` (kit or user); safe to call repeatedly. */
export function ensureSample(id: string | null): Promise<void> {
  if (!id || loadedSamples.has(id)) return Promise.resolve();
  let p = loadingSamples.get(id);
  if (!p) {
    p = getSample(id).then((s) => {
      loadingSamples.delete(id);
      if (!s || !node) return;
      // Copies are sent so the main-thread cache stays usable (waveform drawing).
      post({ type: 'sample', id, l: s.l.slice(), ...(s.r ? { r: s.r.slice() } : {}), rate: s.rate });
      loadedSamples.add(id);
    });
    loadingSamples.set(id, p);
  }
  return p;
}

/** Re-sends a sample after its audio changed (e.g. trimmed recording saved under the same id). */
export function reloadSample(id: string): Promise<void> {
  loadedSamples.delete(id);
  return ensureSample(id);
}
const macroValues = (t: Track): [number, number, number, number] => [t.macros[0].value, t.macros[1].value, t.macros[2].value, t.macros[3].value];

function postParams(t: Track, i: number): void {
  if (t.kind === 'drum') post({ type: 'drumParams', track: i, params: t.params as DrumParams });
  else if (t.kind === 'fm') post({ type: 'fmPatch', track: i, patch: t.params as FmPatch });
  else if (t.kind === 'sampler') {
    const sp = t.params as SamplerParams;
    post({ type: 'samplerParams', track: i, params: sp });
    // Params reference the sample by id; the engine links it as soon as the audio arrives.
    void ensureSample(sp.sampleId);
  }
}

function syncAll(p: Project): void {
  post({ type: 'tempo', bpm: p.bpm, swing: p.swing });
  post({ type: 'fxLane', moves: p.fxMoves?.[currentPattern.peek()] ?? [], length: 16 });
  p.tracks.forEach((t, i) => {
    post({ type: 'trackKind', track: i, kind: engineKind(t) });
    postParams(t, i);
    if (t.kind === 'fm' || t.kind === 'sampler') post({ type: 'macros', track: i, values: macroValues(t) });
    post({ type: 'sends', track: i, a: t.macros[3].value, b: 0 });
    post({ type: 'pattern', track: i, pattern: t.patterns[currentPattern.value] });
    post({ type: 'mute', track: i, mute: t.mute });
  });
}

/** Diff-based sync: only sends what changed (objects are immutable, so identity checks suffice). */
function startSync(): void {
  let prev: Project | null = null;
  let prevPat = currentPattern.peek();
  effect(() => {
    const p = project.value;
    const pat = currentPattern.value;
    if (!prev) {
      syncAll(p);
    } else {
      if (p.bpm !== prev.bpm || p.swing !== prev.swing) post({ type: 'tempo', bpm: p.bpm, swing: p.swing });
      const lane = p.fxMoves?.[pat];
      if (lane !== prev.fxMoves?.[prevPat] || pat !== prevPat) post({ type: 'fxLane', moves: lane ?? [], length: 16 });
      p.tracks.forEach((t, i) => {
        const o = prev!.tracks[i]!;
        if (t === o && pat === prevPat) return;
        if (t.kind !== o.kind) post({ type: 'trackKind', track: i, kind: engineKind(t) });
        if (t.params !== o.params) postParams(t, i);
        if (t.macros !== o.macros && (t.kind === 'fm' || t.kind === 'sampler')) post({ type: 'macros', track: i, values: macroValues(t) });
        if (t.macros[3].value !== o.macros[3].value) post({ type: 'sends', track: i, a: t.macros[3].value, b: 0 });
        if (t.patterns[pat] !== o.patterns[prevPat] || pat !== prevPat) post({ type: 'pattern', track: i, pattern: t.patterns[pat] });
        if (t.mute !== o.mute) post({ type: 'mute', track: i, mute: t.mute });
      });
    }
    prev = p;
    prevPat = pat;
  });
  effect(() => post({ type: 'solo', track: soloSelected.value ? selectedTrack.value : -1 }));
  effect(() => {
    const on = playing.value;
    if (!on) clearSteps(); // the playhead disappears immediately, not after the engine's stop event
    post({ type: 'transport', playing: on });
  });
}

/** Call from a user gesture. Creates the context and engine on first call; safe to call repeatedly. */
export function startAudio(): Promise<void> {
  if (!starting) {
    starting = (async () => {
      const ctx = await ensureRunning();
      await ctx.audioWorklet.addModule(workletUrl);
      node = new AudioWorkletNode(ctx, 'groovebox-engine', { numberOfInputs: 0, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<EngineEvent>) => onEvent(e.data);
      node.connect(ctx.destination);
      startSync();
    })();
  } else {
    void ensureRunning();
  }
  return starting;
}

export async function togglePlay(): Promise<void> {
  await startAudio();
  playing.value = !playing.value;
}

/** Start a live note on a melodic track (keyboard, MIDI). Pair with noteOff. */
export async function noteOn(track: number, note: number, vel = 100): Promise<void> {
  await startAudio();
  post({ type: 'noteOn', track, note, vel });
}

export function noteOff(track: number, note: number): void {
  post({ type: 'noteOff', track, note });
}

export function allNotesOff(track: number): void {
  post({ type: 'allNotesOff', track });
}

/** Play a short preview of notes (picker taps, step selection). Releases after `ms`. */
export async function previewNotes(track: number, notes: readonly number[], vel = 100, ms = 350): Promise<void> {
  await startAudio();
  for (const n of notes) post({ type: 'noteOn', track, note: n, vel });
  setTimeout(() => notes.forEach((n) => post({ type: 'noteOff', track, note: n })), ms);
}

/**
 * Press or release a punch-in effect. target: -1 = master, else a track index.
 * x/y (0..1) are the XY pad position; omitted = the effect's default.
 */
export async function fxPress(fx: FxId, on: boolean, target: number, x?: number, y?: number): Promise<void> {
  if (on) await startAudio();
  post({ type: 'fx', fx, on, target, ...(x !== undefined && y !== undefined ? { x, y } : {}) });
}

/** Move a held effect's XY parameters (0..1). */
export function fxXY(fx: FxId, x: number, y: number): void {
  post({ type: 'fxXY', fx, x, y });
}

const pendingResamples = new Map<string, (s: { l: Float32Array; r: Float32Array; rate: number }) => void>();

/**
 * Records `bars` bars of the master (source -1) or a track into a new buffer, starting at the next
 * bar while playing (else at once). Resolves with the audio; the caller decides whether to save it.
 */
export async function resample(source: number, bars: number): Promise<{ l: Float32Array; r: Float32Array; rate: number }> {
  await startAudio();
  const ctx = getAudioContext();
  const frames = Math.round(((ctx.sampleRate * 60) / project.peek().bpm) * 4 * bars);
  const id = `r${Date.now().toString(36)}`;
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  return new Promise((resolve) => {
    pendingResamples.set(id, (s) => resolve(s));
    node!.port.postMessage({ type: 'resample', id, source, l, r } satisfies EngineCommand, [l.buffer, r.buffer]);
  });
}

/** Audition a drum track immediately (pads, step preview). */
export async function audition(track: number, vel = 100): Promise<void> {
  await startAudio();
  post({ type: 'trigger', track, vel });
}
