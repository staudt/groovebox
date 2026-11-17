// Pure helpers for editing the section list (the Song screen applies the result with setSections).
import type { PatternId, Project, Scene, Section } from './types';
import { PATTERN_IDS } from './types';

export const MAX_SECTIONS = 32;

/** A -> B -> C -> D -> silent (null) -> A. */
export function nextPattern(p: PatternId | null): PatternId | null {
  if (p === null) return 'A';
  const i = PATTERN_IDS.indexOf(p);
  return i >= PATTERN_IDS.length - 1 ? null : PATTERN_IDS[i + 1]!;
}

let counter = 0;
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A section where every track plays `pattern`. */
export function makeSection(p: Project, pattern: PatternId, bars = 4, name?: string): Section {
  const patternByTrack: Section['patternByTrack'] = {};
  for (const t of p.tracks) patternByTrack[t.id] = pattern;
  return { id: newId('s'), name: name ?? `Sec ${p.sections.length + 1}`, bars, patternByTrack };
}

/** Cycles one lane cell; returns a new list. */
export function cycleCell(sections: Section[], index: number, trackId: string): Section[] {
  return sections.map((s, i) => (i === index ? { ...s, patternByTrack: { ...s.patternByTrack, [trackId]: nextPattern(s.patternByTrack[trackId] ?? null) } } : s));
}

export function patchSection(sections: Section[], index: number, patch: Partial<Pick<Section, 'name' | 'bars'>>): Section[] {
  return sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function moveSection(sections: Section[], index: number, dir: -1 | 1): Section[] {
  const j = index + dir;
  if (j < 0 || j >= sections.length) return sections;
  const out = sections.slice();
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}

/** Inserts a copy right after `index`. */
export function duplicateSection(sections: Section[], index: number): Section[] {
  const s = sections[index];
  if (!s || sections.length >= MAX_SECTIONS) return sections;
  const out = sections.slice();
  out.splice(index + 1, 0, { ...s, id: newId('s'), name: `${s.name} 2`.slice(0, 20), patternByTrack: { ...s.patternByTrack } });
  return out;
}

export const deleteSection = (sections: Section[], index: number): Section[] => sections.filter((_, i) => i !== index);

/** The mute set of the project right now, as a scene body. */
export function currentMutes(p: Project): Scene['mutes'] {
  const m: Scene['mutes'] = {};
  for (const t of p.tracks) m[t.id] = t.mute;
  return m;
}

export function sameMutes(p: Project, s: Scene): boolean {
  return p.tracks.every((t) => (s.mutes[t.id] ?? false) === t.mute);
}

export function sceneName(scenes: Scene[]): string {
  let n = scenes.length + 1;
  while (scenes.some((s) => s.name === `Scene ${n}`)) n++;
  return `Scene ${n}`;
}
