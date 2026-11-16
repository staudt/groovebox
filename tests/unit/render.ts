// Offline render helpers: drive the engine core directly in Node (no browser needed).
import { Engine } from '../../src/engine/core';
import type { EngineCommand, EngineEvent } from '../../src/engine/protocol';
import { drumParams } from '../../src/store/defaults';
import { parsePattern } from '../../src/store/notation';
import type { DrumModel, DrumParams, FmPatch, Project } from '../../src/store/types';

export type Render = { left: Float32Array; right: Float32Array; events: EngineEvent[]; engine: Engine; sr: number };

/** Commands to set one drum track with a pattern (all other tracks off). */
export function drumTrack(track: number, model: DrumModel, pattern: string, params: Partial<DrumParams> = {}): EngineCommand[] {
  return [
    { type: 'trackKind', track, kind: 'drum' },
    { type: 'drumParams', track, params: { ...drumParams(model), ...params } },
    { type: 'pattern', track, pattern: parsePattern(pattern) },
  ];
}

/**
 * Renders `seconds` of audio. `at` lets tests inject commands at given times (seconds),
 * applied at the start of the block containing that time (like the worklet port would).
 */
export function render(
  cmds: EngineCommand[],
  seconds: number,
  opts: { sr?: number; block?: number; at?: { time: number; cmd: EngineCommand }[] } = {},
): Render {
  const sr = opts.sr ?? 48000;
  const block = opts.block ?? 128;
  const engine = new Engine(sr);
  const events: EngineEvent[] = [];
  engine.emit = (e) => events.push(structuredClone(e));
  for (const c of cmds) engine.command(c);
  const total = Math.round(seconds * sr);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const bl = new Float32Array(block);
  const br = new Float32Array(block);
  const pending = [...(opts.at ?? [])].sort((a, b) => a.time - b.time);
  for (let off = 0; off < total; off += block) {
    while (pending.length && pending[0]!.time * sr < off + block) engine.command(pending.shift()!.cmd);
    engine.process(bl, br, block);
    const n = Math.min(block, total - off);
    left.set(bl.subarray(0, n), off);
    right.set(br.subarray(0, n), off);
  }
  return { left, right, events, engine, sr };
}

/** Exact onset for sparse hits separated by silence: first sample above `thr` after each silent gap. */
export function sparseOnsets(buf: Float32Array, sr: number, thr = 1e-3, gapMs = 20): number[] {
  const gap = Math.round((gapMs / 1000) * sr);
  const out: number[] = [];
  let quiet = gap;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]!) > thr) {
      if (quiet >= gap) out.push(i);
      quiet = 0;
    } else quiet++;
  }
  return out;
}

/** Engine commands that load a whole project (pattern A of every track). */
export function projectCommands(p: Project): EngineCommand[] {
  const cmds: EngineCommand[] = [{ type: 'tempo', bpm: p.bpm, swing: p.swing }];
  p.tracks.forEach((t, i) => {
    cmds.push({ type: 'trackKind', track: i, kind: t.kind === 'drum' ? 'drum' : t.kind === 'fm' ? 'fm' : 'off' });
    if (t.kind === 'drum') cmds.push({ type: 'drumParams', track: i, params: t.params as DrumParams });
    if (t.kind === 'fm') {
      cmds.push({ type: 'fmPatch', track: i, patch: t.params as FmPatch });
      cmds.push({ type: 'macros', track: i, values: [t.macros[0].value, t.macros[1].value, t.macros[2].value, t.macros[3].value] });
    }
    cmds.push({ type: 'pattern', track: i, pattern: t.patterns.A });
  });
  return cmds;
}


/** Commands to set one FM track with a patch and a pattern. */
export function fmTrack(track: number, patch: FmPatch, pattern: string): EngineCommand[] {
  return [
    { type: 'trackKind', track, kind: 'fm' },
    { type: 'fmPatch', track, patch },
    { type: 'macros', track, values: [0.5, 0.5, 0, 0] },
    { type: 'pattern', track, pattern: parsePattern(pattern) },
  ];
}
