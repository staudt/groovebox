import { useRef, useState } from 'preact/hooks';
import { apply, currentPattern, project, selectedStep } from '../store/project';
import type { Step } from '../store/types';
import { midiToNote } from '../store/notation';
import { chordNotes, diatonicChords, pcName, scaleNotes } from '../harmony/theory';
import { previewNotes } from '../engine/host';
import { Sheet, Stepper } from './Sheet';
import { getOctave, octaveBase, setLastNote } from './keysState';

type Tab = 'note' | 'chord';

/**
 * Note / Chord picker for one melodic step. Picking writes the step (holds after it are kept),
 * previews it and STAYS OPEN so several options can be tried; Done closes. All picks made in one
 * session merge into one undo entry.
 */
export function StepPicker(props: { track: number; index: number; step: Step; onClose: () => void }) {
  const { track, index, step } = props;
  const { key, scale } = project.value;
  const [tab, setTab] = useState<Tab>(step.t === 'chord' ? 'chord' : 'note');
  const [oct, setOct] = useState(step.t === 'note' ? Math.floor(step.note / 12) - 1 : getOctave(track));
  const [chordOct, setChordOct] = useState(step.t === 'chord' ? Math.floor(Math.min(...step.notes) / 12) - 1 : 3);
  const [chromatic, setChromatic] = useState(false);
  const [sevenths, setSevenths] = useState(step.t === 'chord' && /7/.test(step.symbol));
  const [vel, setVel] = useState(step.t === 'note' || step.t === 'chord' ? step.vel : 100);
  const first = useRef(true);

  const write = (next: Step, notes: number[]) => {
    apply({ type: 'setStep', track, pattern: currentPattern.value, index, step: next }, { merge: !first.current });
    first.current = false;
    selectedStep.value = index;
    if (notes.length) setLastNote(track, notes[notes.length - 1]!);
    void previewNotes(track, notes, next.t === 'note' || next.t === 'chord' ? next.vel : 100);
  };

  const pickNote = (note: number) => write({ t: 'note', note, vel }, [note]);
  const pickChord = (symbol: string) => {
    const notes = chordNotes(symbol, octaveBase(chordOct));
    write({ t: 'chord', notes, symbol, vel }, notes);
  };
  const onVel = (v: number) => {
    setVel(v);
    // Live velocity for the step being edited.
    if (step.t === 'note' || step.t === 'chord') {
      apply({ type: 'setStep', track, pattern: currentPattern.value, index, step: { ...step, vel: v } }, { merge: !first.current });
      first.current = false;
    }
  };

  const base = octaveBase(oct);
  const noteList = chromatic
    ? Array.from({ length: 13 }, (_, i) => base + i)
    : scaleNotes(base + key, scale, (scale === 'pentatonic' ? 5 : 7) + 1);
  const chords = diatonicChords(key, scale, sevenths);
  const curNote = step.t === 'note' ? step.note : -1;
  const curChord = step.t === 'chord' ? step.symbol : '';

  const tabBtn = (t: Tab, label: string) => (
    <button class="kbd-pill" style={{ flexGrow: 1, height: '44px' }} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
  );
  const optBtn = (label: string, name: string, on: boolean, f: () => void, root = false) => (
    <button key={name} class={`kbd-pad${root ? ' root' : ''}`} style={{ height: '48px' }} aria-label={name} aria-pressed={on}
      {...(on ? { 'data-lit': '' } : {})} onClick={f}>{label}</button>
  );

  return (
    <Sheet title={`Step ${index + 1}`} onClose={props.onClose}>
      <div class="row" style={{ gap: '6px' }}>{tabBtn('note', 'Note')}{tabBtn('chord', 'Chord')}</div>
      {tab === 'note' ? (
        <>
          <Stepper label="Octave" value={oct} min={1} max={7} onChange={setOct} />
          <div class="kbd-pads" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {noteList.map((n, i) => optBtn(pcName(n), midiToNote(n), n === curNote, () => pickNote(n), !chromatic && (i === 0 || i === noteList.length - 1)))}
          </div>
          <button class="kbd-pill" style={{ height: '40px' }} aria-pressed={chromatic} onClick={() => setChromatic(!chromatic)}>Chromatic</button>
        </>
      ) : (
        <>
          <Stepper label="Root octave" value={chordOct} min={1} max={6} onChange={setChordOct} />
          <div class="kbd-pads" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            {chords.map((c) => optBtn(c.symbol, c.symbol, c.symbol === curChord, () => pickChord(c.symbol)))}
          </div>
          <button class="kbd-pill" style={{ height: '40px' }} aria-pressed={sevenths} onClick={() => setSevenths(!sevenths)}>7ths</button>
        </>
      )}
      <label>
        <div class="row" style={{ justifyContent: 'space-between', fontSize: '13px' }}><span>Velocity</span><span class="mono">{vel}</span></div>
        <input type="range" min={1} max={127} step={1} value={vel} aria-label="Velocity" style={{ width: '100%' }}
          onInput={(e) => onVel(Number(e.currentTarget.value))} />
      </label>
    </Sheet>
  );
}
