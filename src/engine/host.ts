// Main-thread side of the engine: owns the AudioContext and the worklet node,
// mirrors the project store into engine commands, and exposes playhead/meters for rAF readers.
import { effect } from '@preact/signals';
import workletUrl from './worklet.ts?worker&url';
import type { EngineCommand, EngineEvent } from './protocol';
import { currentPattern, playing, project } from '../store/project';
import type { DrumParams, Project } from '../store/types';
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

function onEvent(ev: EngineEvent): void {
  if (ev.type === 'step') {
    stepTimes[stepWrite] = ev.time;
    stepIdx[stepWrite] = ev.step;
    stepWrite = (stepWrite + 1) % STEP_RING;
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
    if (t <= now && t > bestT) {
      bestT = t;
      best = stepIdx[i]!;
    }
  }
  return best;
}

export function readMeters(): Readonly<{ tracks: Float32Array; master: number }> {
  return meters;
}

function syncAll(p: Project): void {
  post({ type: 'tempo', bpm: p.bpm, swing: p.swing });
  p.tracks.forEach((t, i) => {
    post({ type: 'trackKind', track: i, kind: t.kind === 'drum' ? 'drum' : 'off' });
    if (t.kind === 'drum') post({ type: 'drumParams', track: i, params: t.params as DrumParams });
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
      p.tracks.forEach((t, i) => {
        const o = prev!.tracks[i]!;
        if (t === o && pat === prevPat) return;
        if (t.params !== o.params && t.kind === 'drum') post({ type: 'drumParams', track: i, params: t.params as DrumParams });
        if (t.patterns[pat] !== o.patterns[prevPat] || pat !== prevPat) post({ type: 'pattern', track: i, pattern: t.patterns[pat] });
        if (t.mute !== o.mute) post({ type: 'mute', track: i, mute: t.mute });
      });
    }
    prev = p;
    prevPat = pat;
  });
  effect(() => post({ type: 'transport', playing: playing.value }));
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

/** Audition a drum track immediately (pads, step preview). */
export async function audition(track: number, vel = 100): Promise<void> {
  await startAudio();
  post({ type: 'trigger', track, vel });
}
