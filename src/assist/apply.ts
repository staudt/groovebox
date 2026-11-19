// Turns validated assistant answers into ordinary store commands (the undo format), checking every
// reference (track names, slots, notation) and clamping numbers. Anything that doesn't check out is
// dropped, never guessed. Nothing is applied here: the UI shows the result and the user decides.
import type { Command } from '../store/project';
import { clampPatch } from '../store/project';
import { parsePattern, noteToMidi } from '../store/notation';
import { isMelodic } from '../store/defaults';
import type { FmOperator, FmPatch, PatternId, PatternLength, PitchClass, Project, ScaleName, Step } from '../store/types';
import type { AskCommand, AskResponse, JamResponse, PlaceResponse, SoundResponse } from './schemas';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const SCALES: ScaleName[] = ['minor', 'major', 'dorian', 'mixolydian', 'pentatonic'];

export function trackIndex(p: Project, name: string | null | undefined): number {
  if (!name) return -1;
  const n = name.trim().toUpperCase();
  return p.tracks.findIndex((t) => t.name.toUpperCase() === n);
}

const offOp = (): FmOperator => ({ ratio: 1, detune: 0, level: 0, a: 0, d: 0.5, s: 1, r: 0.3, velSens: 0 });

/** Three playable patches (6 operators each, every number clamped). */
export function soundTakes(r: SoundResponse): FmPatch[] {
  return r.takes.slice(0, 3).map((t, i) => {
    const ops = [...t.patch.ops.slice(0, 6), ...Array.from({ length: Math.max(0, 6 - t.patch.ops.length) }, offOp)] as FmPatch['ops'];
    return clampPatch({ kind: 'fm', name: (t.patch.name || `Take ${'ABC'[i]}`).slice(0, 24), algorithm: t.patch.algorithm, feedback: t.patch.feedback, ops });
  });
}

/**
 * Parses notation for a track: lengths 16/32/64 by token count; drum tracks keep only hits and
 * rests (notes become hits). Returns null if the text isn't valid notation.
 */
export function patternFor(p: Project, track: number, text: string): { length: PatternLength; steps: Step[] } | null {
  try {
    const n = text.trim().split(/\s+/).filter(Boolean).length;
    if (n === 0 || n > 64) return null;
    const pat = parsePattern(text, n <= 16 ? 16 : n <= 32 ? 32 : 64);
    const t = p.tracks[track]!;
    if (!isMelodic(t)) {
      pat.steps = pat.steps.map((s) => (s.t === 'hit' || s.t === 'rest' ? s : s.t === 'note' || s.t === 'chord' ? { t: 'hit', vel: s.vel } : { t: 'rest' }));
    }
    return pat;
  } catch {
    return null;
  }
}

/** One editable chip per command: what it does in plain words, plus the store command(s). */
export type Proposal = { label: string; commands: Command[] };

function askOne(p: Project, c: AskCommand): Proposal | null {
  const ti = trackIndex(p, c.track);
  const tname = ti >= 0 ? p.tracks[ti]!.name : '';
  switch (c.op) {
    case 'set_pattern': {
      if (ti < 0 || !c.slot || !c.pattern) return null;
      const pat = patternFor(p, ti, c.pattern);
      if (!pat) return null;
      return { label: `${tname} pattern ${c.slot}: ${c.pattern.trim()}`, commands: [{ type: 'setSteps', track: ti, pattern: c.slot, steps: pat.steps }] };
    }
    case 'copy_pattern': {
      if (!c.slot || !c.to || c.slot === c.to) return null;
      const all = (c.track ?? '').toUpperCase() === 'ALL';
      if (!all && ti < 0) return null;
      return { label: `Copy pattern ${c.slot} to ${c.to} on ${all ? 'every track' : tname}`, commands: [{ type: 'copyPattern', track: all ? -1 : ti, from: c.slot, to: c.to }] };
    }
    case 'set_bpm':
      if (c.value == null) return null;
      return { label: `Tempo ${Math.round(clamp(c.value, 40, 240))} BPM`, commands: [{ type: 'setBpm', bpm: c.value }] };
    case 'set_swing':
      if (c.value == null) return null;
      return { label: `Swing ${Math.round(clamp(c.value, 50, 75))} %`, commands: [{ type: 'setSwing', swing: c.value }] };
    case 'set_mute':
      if (ti < 0 || c.value == null) return null;
      return { label: `${c.value > 0.5 ? 'Mute' : 'Unmute'} ${tname}`, commands: [{ type: 'setMute', track: ti, mute: c.value > 0.5 }] };
    case 'set_macro': {
      if (ti < 0 || c.value == null || !c.param) return null;
      const mi = p.tracks[ti]!.macros.findIndex((m) => m.label.toLowerCase() === c.param!.toLowerCase());
      if (mi < 0) return null;
      const v = clamp(c.value, 0, 1);
      return { label: `${tname} ${p.tracks[ti]!.macros[mi]!.label} ${Math.round(v * 100)} %`, commands: [{ type: 'setMacro', track: ti, macro: mi, value: v }] };
    }
    case 'set_mix': {
      if (ti < 0 || c.value == null || !c.param) return null;
      const param = c.param.toLowerCase();
      if (param === 'level') return { label: `${tname} level ${Math.round(clamp(c.value, 0, 1) * 100)} %`, commands: [{ type: 'setChannel', track: ti, patch: { level: c.value } }] };
      if (param === 'pan') return { label: `${tname} pan ${clamp(c.value, -1, 1).toFixed(2)}`, commands: [{ type: 'setChannel', track: ti, patch: { pan: c.value } }] };
      if (param === 'delay') return { label: `${tname} delay send ${Math.round(clamp(c.value, 0, 1) * 100)} %`, commands: [{ type: 'setChannel', track: ti, patch: { sendB: c.value } }] };
      if (param === 'duck') return { label: `${tname} sidechain ${Math.round(clamp(c.value, 0, 1) * 100)} %`, commands: [{ type: 'setChannel', track: ti, patch: { duck: c.value } }] };
      return null;
    }
    case 'set_key': {
      const m = noteToMidi(`${(c.text ?? '').trim()}4`);
      if (m === null) return null;
      const key = (((m % 12) + 12) % 12) as PitchClass;
      const scale = SCALES.find((s) => s === (c.param ?? '').toLowerCase());
      const cmds: Command[] = [{ type: 'setKey', key }];
      if (scale) cmds.push({ type: 'setScale', scale });
      return { label: `Key ${(c.text ?? '').trim()}${scale ? ` ${scale}` : ''}`, commands: cmds };
    }
  }
}

/** Ask bar answer -> proposals (invalid commands dropped and counted). */
export function askProposals(p: Project, r: AskResponse): { summary: string; proposals: Proposal[]; dropped: number } {
  const proposals: Proposal[] = [];
  let dropped = 0;
  for (const c of r.commands.slice(0, 12)) {
    const prop = askOne(p, c);
    if (prop) proposals.push(prop);
    else dropped++;
  }
  return { summary: r.summary.slice(0, 200), proposals, dropped };
}

/** Jam variations -> queue items (each a group of pattern replacements). */
export function jamItems(p: Project, r: JamResponse): { description: string; commands: Command[]; tracks: string[] }[] {
  const out: { description: string; commands: Command[]; tracks: string[] }[] = [];
  for (const v of r.variations.slice(0, 3)) {
    const commands: Command[] = [];
    const tracks: string[] = [];
    for (const ch of v.changes.slice(0, 3)) {
      const ti = trackIndex(p, ch.track);
      if (ti < 0) continue;
      const pat = patternFor(p, ti, ch.pattern);
      if (!pat) continue;
      commands.push({ type: 'setSteps', track: ti, pattern: ch.slot as PatternId, steps: pat.steps });
      tracks.push(p.tracks[ti]!.name);
    }
    if (commands.length) out.push({ description: v.description.slice(0, 160), commands, tracks });
  }
  return out;
}

/** Placement suggestion checked against the project (melodic track, valid section, clamped numbers). */
export function placeSuggestion(p: Project, r: PlaceResponse): { track: number; slot: PatternId; sectionId: string | null; startStep: number; repeats: 1 | 2 | 4; octaveShift: number; reason: string } | null {
  const track = trackIndex(p, r.track);
  if (track < 0 || !isMelodic(p.tracks[track]!)) return null;
  const sec = r.section ? p.sections.find((s) => s.name.toLowerCase() === r.section!.toLowerCase()) : undefined;
  const repeats = r.repeats >= 3 ? 4 : r.repeats >= 1.5 ? 2 : 1;
  return {
    track,
    slot: r.slot,
    sectionId: sec?.id ?? null,
    startStep: Math.round(clamp(r.startStep, 0, 63)),
    repeats,
    octaveShift: Math.round(clamp(r.octaveShift, -2, 2)),
    reason: r.reason.slice(0, 160),
  };
}
