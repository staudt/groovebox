// Project store: single source of truth on the main thread.
// Every mutation goes through `apply(cmd)`, which records its inverse for undo/redo.
import { batch, computed, signal } from '@preact/signals';
import type { DrumParams, FmOpKey, FmPatch, PatternId, PitchClass, Project, SamplerParams, ScaleName, Step, Track } from './types';
import { BPM_MAX, BPM_MIN, SWING_MAX, SWING_MIN } from './types';
import { defaultProject } from './defaults';

export type Command =
  | { type: 'setStep'; track: number; pattern: PatternId; index: number; step: Step }
  | { type: 'setSteps'; track: number; pattern: PatternId; steps: Step[] }
  | { type: 'setBpm'; bpm: number }
  | { type: 'setSwing'; swing: number }
  | { type: 'setDrumParam'; track: number; key: Exclude<keyof DrumParams, 'model'>; value: number }
  | { type: 'setMacro'; track: number; macro: number; value: number }
  | { type: 'setMute'; track: number; mute: boolean }
  /** Replace a whole FM patch (preset load, random, undo of a patch swap). */
  | { type: 'setFmPatch'; track: number; patch: FmPatch }
  /** One operator parameter; op is 0..5 (OP1..OP6). */
  | { type: 'setFmOp'; track: number; op: number; key: FmOpKey; value: number }
  | { type: 'setFmGlobal'; track: number; key: 'algorithm' | 'feedback'; value: number }
  /** Change some sampler settings (sample choice, trim, pitch, mode...). Values are clamped. */
  | { type: 'setSampler'; track: number; patch: Partial<Omit<SamplerParams, 'kind'>> }
  | { type: 'setKey'; key: PitchClass }
  | { type: 'setScale'; scale: ScaleName };

export const project = signal<Project>(defaultProject());
export const selectedTrack = signal(0);
export const currentPattern = signal<PatternId>('A');
export const playing = signal(false);

export const track = computed<Track>(() => project.value.tracks[selectedTrack.value]!);
/**
 * Monitoring solo: when on, only the selected track is heard, following the selection.
 * A listening aid (not saved, not undoable); per-track mute/solo in the mixer is separate.
 */
export const soloSelected = signal(false);
/** Step index (in the current pattern of the selected track) that keyboard input writes to; -1 = none. */
export const selectedStep = signal(-1);

const undoStack: Command[][] = [];
const redoStack: Command[][] = [];
export const canUndo = signal(false);
export const canRedo = signal(false);
const UNDO_LIMIT = 200;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Legal ranges for FM operator params (see FmOperator). */
export const FM_OP_RANGE: Record<FmOpKey, [number, number]> = {
  ratio: [0.5, 31.99],
  detune: [-7, 7],
  level: [0, 99],
  a: [0, 1],
  d: [0, 1],
  s: [0, 1],
  r: [0, 1],
  velSens: [0, 7],
};

/** Clamps sampler settings to legal ranges (keeps end > start). */
export function clampSampler(s: SamplerParams): SamplerParams {
  const start = clamp(s.start, 0, 0.999);
  return {
    ...s,
    kind: 'sampler',
    name: String(s.name ?? 'Sample').slice(0, 40),
    start,
    end: clamp(Math.max(s.end, start + 0.001), 0.001, 1),
    pitch: clamp(Math.round(s.pitch), -24, 24),
    root: clamp(Math.round(s.root), 0, 127),
    level: clamp(s.level, 0, 1),
    attack: clamp(s.attack, 0, 1),
    release: clamp(s.release, 0, 1),
    mode: s.mode === 'chromatic' ? 'chromatic' : 'oneshot',
    reverse: !!s.reverse,
  };
}

/** Clamps every number in a patch to its legal range (used for presets, random, imports and LLM output). */
export function clampPatch(p: FmPatch): FmPatch {
  const ops = p.ops.map((o) => {
    const c = { ...o };
    for (const k of Object.keys(FM_OP_RANGE) as FmOpKey[]) {
      const [lo, hi] = FM_OP_RANGE[k];
      const v = Number.isFinite(c[k]) ? c[k] : lo;
      c[k] = k === 'detune' || k === 'level' || k === 'velSens' ? Math.round(clamp(v, lo, hi)) : clamp(v, lo, hi);
    }
    return c;
  }) as FmPatch['ops'];
  return {
    kind: 'fm',
    name: String(p.name ?? 'Patch').slice(0, 32),
    algorithm: Math.round(clamp(p.algorithm, 1, 32)),
    feedback: Math.round(clamp(p.feedback, 0, 7)),
    ops,
  };
}

function mapTrack(p: Project, i: number, f: (t: Track) => Track): Project {
  const tracks = p.tracks.slice();
  tracks[i] = f(tracks[i]!);
  return { ...p, tracks };
}

/** Applies a command immutably; returns the new project and the inverse command. */
export function reduce(p: Project, cmd: Command): [Project, Command] {
  switch (cmd.type) {
    case 'setStep': {
      const pat = p.tracks[cmd.track]!.patterns[cmd.pattern];
      const prev = pat.steps[cmd.index]!;
      const next = mapTrack(p, cmd.track, (t) => {
        const steps = pat.steps.slice();
        steps[cmd.index] = cmd.step;
        return { ...t, patterns: { ...t.patterns, [cmd.pattern]: { ...pat, steps } } };
      });
      return [next, { ...cmd, step: prev }];
    }
    case 'setSteps': {
      const pat = p.tracks[cmd.track]!.patterns[cmd.pattern];
      const next = mapTrack(p, cmd.track, (t) => ({
        ...t,
        patterns: { ...t.patterns, [cmd.pattern]: { ...pat, steps: cmd.steps.slice() } },
      }));
      return [next, { ...cmd, steps: pat.steps }];
    }
    case 'setBpm':
      return [{ ...p, bpm: clamp(Math.round(cmd.bpm), BPM_MIN, BPM_MAX) }, { type: 'setBpm', bpm: p.bpm }];
    case 'setSwing':
      return [{ ...p, swing: clamp(cmd.swing, SWING_MIN, SWING_MAX) }, { type: 'setSwing', swing: p.swing }];
    case 'setDrumParam': {
      const params = p.tracks[cmd.track]!.params as DrumParams;
      const prev = params[cmd.key];
      const lo = cmd.key === 'tune' ? -12 : 0;
      const hi = cmd.key === 'tune' ? 12 : 1;
      const next = mapTrack(p, cmd.track, (t) => ({ ...t, params: { ...params, [cmd.key]: clamp(cmd.value, lo, hi) } }));
      return [next, { ...cmd, value: prev }];
    }
    case 'setMacro': {
      const t0 = p.tracks[cmd.track]!;
      const m = t0.macros[cmd.macro]!;
      const value = clamp(cmd.value, 0, 1);
      // Phase 1: a macro writes its value straight into each drum param it targets.
      let next = mapTrack(p, cmd.track, (t) => {
        const macros = t.macros.slice() as Track['macros'];
        macros[cmd.macro] = { ...m, value };
        return { ...t, macros };
      });
      if (t0.kind === 'drum') {
        for (const key of m.targets) {
          if (key === 'decay' || key === 'tone' || key === 'drive' || key === 'level') {
            next = mapTrack(next, cmd.track, (t) => ({ ...t, params: { ...(t.params as DrumParams), [key]: value } }));
          }
        }
      }
      return [next, { ...cmd, value: m.value }];
    }
    case 'setFmPatch': {
      const prev = p.tracks[cmd.track]!.params as FmPatch;
      return [mapTrack(p, cmd.track, (t) => ({ ...t, params: clampPatch(cmd.patch) })), { ...cmd, patch: prev }];
    }
    case 'setFmOp': {
      const patch = p.tracks[cmd.track]!.params as FmPatch;
      const prev = patch.ops[cmd.op]![cmd.key];
      const [lo, hi] = FM_OP_RANGE[cmd.key];
      const ops = patch.ops.slice() as FmPatch['ops'];
      ops[cmd.op] = { ...ops[cmd.op]!, [cmd.key]: clamp(cmd.value, lo, hi) };
      return [mapTrack(p, cmd.track, (t) => ({ ...t, params: { ...patch, ops } })), { ...cmd, value: prev }];
    }
    case 'setFmGlobal': {
      const patch = p.tracks[cmd.track]!.params as FmPatch;
      const prev = patch[cmd.key];
      const value = cmd.key === 'algorithm' ? Math.round(clamp(cmd.value, 1, 32)) : Math.round(clamp(cmd.value, 0, 7));
      return [mapTrack(p, cmd.track, (t) => ({ ...t, params: { ...patch, [cmd.key]: value } })), { ...cmd, value: prev }];
    }
    case 'setSampler': {
      const prev = p.tracks[cmd.track]!.params as SamplerParams;
      const next = clampSampler({ ...prev, ...cmd.patch });
      const inverse: Partial<Omit<SamplerParams, 'kind'>> = {};
      for (const k of Object.keys(cmd.patch) as (keyof Omit<SamplerParams, 'kind'>)[]) (inverse as Record<string, unknown>)[k] = prev[k];
      return [mapTrack(p, cmd.track, (t) => ({ ...t, params: next })), { ...cmd, patch: inverse }];
    }
    case 'setKey':
      return [{ ...p, key: (((Math.round(cmd.key) % 12) + 12) % 12) as PitchClass }, { type: 'setKey', key: p.key }];
    case 'setScale':
      return [{ ...p, scale: cmd.scale }, { type: 'setScale', scale: p.scale }];
    case 'setMute': {
      const prev = p.tracks[cmd.track]!.mute;
      return [mapTrack(p, cmd.track, (t) => ({ ...t, mute: cmd.mute })), { ...cmd, mute: prev }];
    }
  }
}

/**
 * Applies one command (or a group that undoes as one step).
 * `merge`: fold into the previous undo entry if it is the same kind of continuous gesture (knob drags).
 */
export function apply(cmds: Command | Command[], opts: { merge?: boolean } = {}): void {
  const list = Array.isArray(cmds) ? cmds : [cmds];
  let p = project.value;
  const inverses: Command[] = [];
  for (const c of list) {
    const [np, inv] = reduce(p, c);
    p = np;
    inverses.unshift(inv);
  }
  batch(() => {
    project.value = p;
    if (opts.merge && undoStack.length > 0) {
      // Keep the oldest inverse so one undo returns to the state before the gesture began.
    } else {
      undoStack.push(inverses);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    redoStack.length = 0;
    canUndo.value = undoStack.length > 0;
    canRedo.value = false;
  });
}

function replay(from: Command[][], to: Command[][]): void {
  const cmds = from.pop();
  if (!cmds) return;
  let p = project.value;
  const inverses: Command[] = [];
  for (const c of cmds) {
    const [np, inv] = reduce(p, c);
    p = np;
    inverses.unshift(inv);
  }
  batch(() => {
    project.value = p;
    to.push(inverses);
    canUndo.value = undoStack.length > 0;
    canRedo.value = redoStack.length > 0;
  });
}

/** Number of entries on the undo stack (lets a tool detect whether anything else was recorded since). */
export const undoDepth = (): number => undoStack.length;

export const undo = () => replay(undoStack, redoStack);
export const redo = () => replay(redoStack, undoStack);

/** Test helper: replace the project and clear history. */
export function resetProject(p: Project = defaultProject()): void {
  batch(() => {
    project.value = p;
    undoStack.length = 0;
    redoStack.length = 0;
    canUndo.value = false;
    canRedo.value = false;
  });
}
