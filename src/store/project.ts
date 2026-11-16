// Project store: single source of truth on the main thread.
// Every mutation goes through `apply(cmd)`, which records its inverse for undo/redo.
import { batch, computed, signal } from '@preact/signals';
import type { DrumParams, PatternId, Project, Step, Track } from './types';
import { BPM_MAX, BPM_MIN, SWING_MAX, SWING_MIN } from './types';
import { defaultProject } from './defaults';

export type Command =
  | { type: 'setStep'; track: number; pattern: PatternId; index: number; step: Step }
  | { type: 'setSteps'; track: number; pattern: PatternId; steps: Step[] }
  | { type: 'setBpm'; bpm: number }
  | { type: 'setSwing'; swing: number }
  | { type: 'setDrumParam'; track: number; key: Exclude<keyof DrumParams, 'model'>; value: number }
  | { type: 'setMacro'; track: number; macro: number; value: number }
  | { type: 'setMute'; track: number; mute: boolean };

export const project = signal<Project>(defaultProject());
export const selectedTrack = signal(0);
export const currentPattern = signal<PatternId>('A');
export const playing = signal(false);

export const track = computed<Track>(() => project.value.tracks[selectedTrack.value]!);

const undoStack: Command[][] = [];
const redoStack: Command[][] = [];
export const canUndo = signal(false);
export const canRedo = signal(false);
const UNDO_LIMIT = 200;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
