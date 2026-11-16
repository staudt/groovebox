// `pnpm render:demo` writes WAV files to renders/ so a human can listen on desktop.
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { toWav } from '../audio/analysis';
import { defaultProject } from '../../src/store/defaults';
import type { EngineCommand } from '../../src/engine/protocol';
import { drumTrack, projectCommands, render } from '../unit/render';

const OUT = 'renders';
const START: EngineCommand = { type: 'transport', playing: true };
const save = (name: string, l: Float32Array, r: Float32Array, sr: number) => {
  writeFileSync(`${OUT}/${name}.wav`, toWav([l, r], sr));
  console.log(`wrote ${OUT}/${name}.wav`);
};

it('renders demo files', () => {
  mkdirSync(OUT, { recursive: true });
  const p = defaultProject();
  let r = render([...projectCommands(p), START], (60 / p.bpm) * 4 * 4);
  save('01-default-beat', r.left, r.right, r.sr);

  // Each model: tone 0 / 0.5 / 1 at decay 0.5, then decay 0 / 0.5 / 1 at tone 0.5. One hit per beat at 100 BPM.
  for (const m of ['kick', 'snare', 'hat', 'perc'] as const) {
    const at: { time: number; cmd: EngineCommand }[] = [];
    const settings = [
      { tone: 0, decay: 0.5 }, { tone: 0.5, decay: 0.5 }, { tone: 1, decay: 0.5 },
      { tone: 0.5, decay: 0 }, { tone: 0.5, decay: 0.5 }, { tone: 0.5, decay: 1 },
    ];
    settings.forEach((s, i) => {
      at.push({ time: i * 1.2, cmd: drumTrack(0, m, 'x', s)[1]! });
    });
    r = render([{ type: 'tempo', bpm: 200, swing: 50 }, ...drumTrack(0, m, 'x', settings[0]), START], 7.2, { at });
    save(`02-${m}-tone-then-decay`, r.left, r.right, r.sr);
  }

  for (const bpm of [60, 200]) {
    const q = { ...p, bpm };
    r = render([...projectCommands(q), START], (60 / bpm) * 4 * 2);
    save(`03-default-beat-${bpm}bpm`, r.left, r.right, r.sr);
  }
  r = render([...projectCommands({ ...p, swing: 66 }), START], (60 / p.bpm) * 4 * 2);
  save('04-default-beat-swing66', r.left, r.right, r.sr);
});
