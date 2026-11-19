// Compact project summary for the assistant: text pattern notation, not raw state (spec).
import type { DrumParams, FmPatch, Project, SamplerParams } from '../store/types';
import { PATTERN_IDS } from '../store/types';
import { formatPattern } from '../store/notation';
import { pcName } from '../harmony/theory';

const isEmpty = (txt: string) => /^(\.\s*)*$/.test(txt.trim());

export function projectSummary(p: Project, current: string): string {
  const lines: string[] = [];
  lines.push(`Song: "${p.name}", ${p.bpm} BPM, swing ${Math.round(p.swing)} %, key ${pcName(p.key)} ${p.scale}. Mode: ${p.playMode === 'song' ? 'song (sections)' : `loop on pattern ${current}`}.`);
  if (p.sections.length) {
    lines.push('Sections in order:');
    for (const s of p.sections) {
      const per = p.tracks.map((t) => `${t.name} ${s.patternByTrack[t.id] ?? '-'}`).join(', ');
      lines.push(`- ${s.name}, ${s.bars} bars: ${per}`);
    }
  }
  lines.push('Tracks:');
  p.tracks.forEach((t, i) => {
    const m = p.mixer.tracks[i];
    let sound = '';
    if (t.kind === 'drum') sound = `drum synth (${(t.params as DrumParams).model})`;
    else if (t.kind === 'fm') sound = `FM patch "${(t.params as FmPatch).name}"`;
    else {
      const sp = t.params as SamplerParams;
      sound = `sampler ${sp.sampleId ? `"${sp.name}"` : '(empty)'} ${sp.mode}`;
    }
    const mix = m ? `, level ${m.level.toFixed(2)}, pan ${m.pan.toFixed(2)}${t.mute ? ', muted' : ''}` : '';
    lines.push(`${t.name}: ${sound}${mix}`);
    for (const id of PATTERN_IDS) {
      const txt = formatPattern(t.patterns[id]);
      if (!isEmpty(txt)) lines.push(`  ${id}: ${txt}`);
    }
  });
  return lines.join('\n');
}
