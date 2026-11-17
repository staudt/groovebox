// Project -> engine commands. One pure translation used by the live host, offline renders
// (export) and tests, so a project always sounds the same wherever it is played.
import type { EngineCommand } from './protocol';
import { PATTERN_IDS, type DrumParams, type FmPatch, type PatternId, type Project, type SamplerParams, type Track } from '../store/types';

export const slotOf = (id: PatternId): number => PATTERN_IDS.indexOf(id);

export const macroValues = (t: Track): [number, number, number, number] => [t.macros[0].value, t.macros[1].value, t.macros[2].value, t.macros[3].value];

/** Commands for one track's sound (kind + params + macros). */
export function trackSoundCommands(t: Track, i: number): EngineCommand[] {
  const out: EngineCommand[] = [{ type: 'trackKind', track: i, kind: t.kind }];
  if (t.kind === 'drum') out.push({ type: 'drumParams', track: i, params: t.params as DrumParams });
  else if (t.kind === 'fm') out.push({ type: 'fmPatch', track: i, patch: t.params as FmPatch });
  else out.push({ type: 'samplerParams', track: i, params: t.params as SamplerParams });
  if (t.kind !== 'drum') out.push({ type: 'macros', track: i, values: macroValues(t) });
  return out;
}

export function channelCommands(p: Project, i: number): EngineCommand[] {
  const t = p.tracks[i]!;
  const c = p.mixer.tracks[i]!;
  return [
    { type: 'channel', track: i, level: c.level, pan: c.pan, sendB: c.sendB, duck: c.duck, solo: c.solo },
    { type: 'sends', track: i, a: t.macros[3].value, b: c.sendB },
    { type: 'mute', track: i, mute: t.mute },
  ];
}

export function patternCommands(t: Track, i: number): EngineCommand[] {
  return PATTERN_IDS.map((id, slot) => ({ type: 'pattern', track: i, pattern: t.patterns[id], slot }) as EngineCommand);
}

export function songCommand(p: Project): EngineCommand {
  return {
    type: 'song',
    enabled: p.playMode === 'song',
    sections: p.sections.map((s) => ({
      bars: s.bars,
      slots: p.tracks.map((t) => {
        const id = s.patternByTrack[t.id];
        return id ? slotOf(id) : -1;
      }),
    })),
  };
}

export const mixerCommands = (p: Project): EngineCommand[] => [
  { type: 'master', gain: p.mixer.master },
  { type: 'duck', source: p.mixer.duckSource, release: p.mixer.duckRelease },
];

/** Everything the engine needs to play `p` with `current` as the loop pattern (samples are loaded separately). */
export function projectToCommands(p: Project, current: PatternId = 'A'): EngineCommand[] {
  const cmds: EngineCommand[] = [{ type: 'tempo', bpm: p.bpm, swing: p.swing }, ...mixerCommands(p)];
  p.tracks.forEach((t, i) => {
    cmds.push(...trackSoundCommands(t, i), ...channelCommands(p, i), ...patternCommands(t, i));
  });
  cmds.push({ type: 'patternSelect', slot: slotOf(current), quantize: false });
  cmds.push(songCommand(p));
  cmds.push({ type: 'fxLane', moves: p.fxMoves?.[current] ?? [], length: 16 });
  return cmds;
}
