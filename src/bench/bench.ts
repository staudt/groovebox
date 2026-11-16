// On-device engine benchmark (bench.html): same Engine code as the worklet, timed on the main thread.
import { Engine } from '../engine/core';
import { defaultProject } from '../store/defaults';
import { parsePattern } from '../store/notation';
import { presetByName } from '../store/fmPresets';
import type { DrumParams, FmPatch } from '../store/types';

type Scenario = { name: string; setup: (e: Engine) => void };

function loadProject(e: Engine): void {
  const p = defaultProject();
  e.command({ type: 'tempo', bpm: 200, swing: 50 });
  p.tracks.forEach((t, i) => {
    e.command({ type: 'trackKind', track: i, kind: t.kind === 'drum' ? 'drum' : t.kind === 'fm' ? 'fm' : 'off' });
    if (t.kind === 'drum') e.command({ type: 'drumParams', track: i, params: t.params as DrumParams });
    if (t.kind === 'fm') {
      e.command({ type: 'fmPatch', track: i, patch: t.params as FmPatch });
      e.command({ type: 'macros', track: i, values: [0.5, 0.5, 0.2, 0] });
    }
    e.command({ type: 'pattern', track: i, pattern: t.patterns.A });
  });
}

const allDrums16ths = (e: Engine) => {
  for (const t of [0, 1, 2, 6]) e.command({ type: 'pattern', track: t, pattern: parsePattern(Array(16).fill('x').join(' ')) });
};

const eightFmVoices = (e: Engine) => {
  const ep = presetByName('Electric Piano');
  ep.ops = ep.ops.map((o) => ({ ...o, s: 1 })) as FmPatch['ops'];
  e.command({ type: 'fmPatch', track: 4, patch: ep });
  e.command({ type: 'fmPatch', track: 5, patch: ep });
  e.command({ type: 'pattern', track: 3, pattern: parsePattern('') });
  e.command({ type: 'pattern', track: 5, pattern: parsePattern('Cm7* ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~') });
  e.command({ type: 'pattern', track: 4, pattern: parsePattern('Abmaj7* ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~') });
};

const SCENARIOS: Scenario[] = [
  { name: 'Default song (drums, bass, pad)', setup: (e) => loadProject(e) },
  { name: 'Drums: 4 tracks on every 16th at 200 BPM', setup: (e) => { loadProject(e); for (const t of [3, 4, 5]) e.command({ type: 'trackKind', track: t, kind: 'off' }); allDrums16ths(e); } },
  { name: '8 FM voices, all 6 operators (E. piano chords)', setup: (e) => { loadProject(e); for (const t of [0, 1, 2, 6]) e.command({ type: 'trackKind', track: t, kind: 'off' }); eightFmVoices(e); } },
  { name: 'Worst case: both of the above together', setup: (e) => { loadProject(e); allDrums16ths(e); eightFmVoices(e); } },
];

function measure(s: Scenario, seconds: number): number {
  const sr = 48000;
  const e = new Engine(sr);
  s.setup(e);
  e.command({ type: 'transport', playing: true });
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  for (let i = 0; i < 1500; i++) e.process(l, r, 128); // warm up the JIT
  const blocks = Math.round((seconds * sr) / 128);
  const t0 = performance.now();
  for (let i = 0; i < blocks; i++) e.process(l, r, 128);
  return ((performance.now() - t0) / 1000 / seconds) * 100;
}

const out = document.getElementById('out')!;
const btn = document.getElementById('run') as HTMLButtonElement;
btn.onclick = async () => {
  btn.disabled = true;
  const lines = [`${navigator.userAgent}`, `cores: ${navigator.hardwareConcurrency ?? '?'}`, ''];
  out.textContent = lines.join('\n') + 'running…';
  for (const s of SCENARIOS) {
    await new Promise((r) => setTimeout(r, 50)); // let the page paint between scenarios
    const pct = measure(s, 4);
    lines.push(`${pct.toFixed(1).padStart(5)} %  ${s.name}`);
    out.textContent = lines.join('\n');
  }
  lines.push('', 'Budget (spec): under 30 % of one core for the worst case plus 2 FX.');
  out.textContent = lines.join('\n');
  btn.disabled = false;
};
