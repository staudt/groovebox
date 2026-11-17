import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'preact/hooks';
import { captureView, screen } from '../app/nav';
import { captureResult } from '../capture/session';
import { quantize } from '../capture/notes';
import { detectKey, fitInterval, octaveFit, outOfKey, transposeChromatic, transposeDiatonic } from '../capture/key';
import { buildPlacement, chordSummary, meanShift, repeatOptions, type Parts } from '../capture/place';
import type { GridNote, GridSize } from '../capture/types';
import { harmonize } from '../harmony/engine';
import { STYLE_LABEL, type HarmonyResult, type HarmonyStyle } from '../harmony/types';
import { pcName } from '../harmony/theory';
import { playSequence, stopSequence } from '../engine/host';
import { apply, currentPattern, project, selectedTrack, type Command } from '../store/project';
import { isMelodic } from '../store/defaults';
import { midiToNote } from '../store/notation';
import { saveSample } from '../store/samples';
import { PATTERN_IDS, type PatternId } from '../store/types';
import '../ui/capture.css';

const STYLES: HarmonyStyle[] = ['pop', 'melancholy', 'jazzy'];
const TAKE_ID = ['A', 'B', 'C'] as const;
const SCALE_ABBR = { minor: 'min', major: 'maj', dorian: 'dor', mixolydian: 'mix', pentatonic: 'pent' } as const;

function Stepper(props: { label: string; value: string; onPrev: () => void; onNext: () => void; testId: string }) {
  return (
    <div class="pl-step">
      <button aria-label={`${props.label} down`} onClick={props.onPrev}>−</button>
      <span data-testid={props.testId} aria-label={`${props.label}: ${props.value}`}>{props.label}: {props.value}</span>
      <button aria-label={`${props.label} up`} onClick={props.onNext}>+</button>
    </div>
  );
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function Place() {
  const res = captureResult.value;
  const p = project.value;
  const bars = res?.bars ?? 1;
  const melodySteps = bars * 16;
  const stepMs = (60000 / (res?.bpm ?? p.bpm)) / 4;

  const [grid, setGrid] = useState<GridSize>(8);
  const [showRaw, setShowRaw] = useState(false);
  const [mode, setMode] = useState<'chromatic' | 'inkey'>('chromatic');
  const [steps, setSteps] = useState(0);
  const melodic = useMemo(() => p.tracks.map((t, i) => ({ t, i })).filter((x) => isMelodic(x.t)), [p.tracks]);
  const [trackI, setTrackI] = useState(() => (melodic.find((x) => x.t.name === 'KEYS') ?? melodic[0])?.i ?? 0);
  const [slot, setSlot] = useState<PatternId>(currentPattern.value);
  const [sectionI, setSectionI] = useState(-1);
  const [repeat, setRepeat] = useState(1);
  const [take, setTake] = useState(0);
  const [parts, setParts] = useState<Parts>({ bass: false, pad: false, second: false });
  const [playingPrev, setPlayingPrev] = useState(false);
  const [msg, setMsg] = useState('');
  const timers = useRef<number[]>([]);

  const base: GridNote[] = useMemo(() => (res ? quantize(res.transcription.notes, res.bpm, grid, melodySteps) : []), [res, grid, melodySteps]);
  const detected = useMemo(() => detectKey(res?.transcription.notes ?? []), [res]);
  const fitSemis = useMemo(() => fitInterval(detected, p.key, p.scale), [detected, p.key, p.scale]);
  const [semis, setSemis] = useState(fitSemis);
  // Auto-fit on entry: smallest interval into the project key, then the octave nearest the track's range.
  const [oct, setOct] = useState(() => {
    const center = /BASS/i.test(p.tracks[trackI]?.name ?? '') ? 45 : 66;
    return Math.round(octaveFit(transposeChromatic(base, fitSemis), center) / 12);
  });

  const final: GridNote[] = useMemo(() => {
    const s1 = transposeChromatic(base, semis);
    const s2 = mode === 'inkey' ? transposeDiatonic(s1, steps, p.key, p.scale) : s1;
    return transposeChromatic(s2, 12 * oct);
  }, [base, semis, mode, steps, oct, p.key, p.scale]);
  const out = useMemo(() => outOfKey(final, p.key, p.scale), [final, p.key, p.scale]);
  const anyOut = out.some(Boolean);

  const harmonies = useMemo<HarmonyResult[]>(
    () => STYLES.map((style) => harmonize({ melody: final, key: p.key, scale: p.scale, style, steps: melodySteps })),
    [final, p.key, p.scale, melodySteps],
  );
  const harm = harmonies[take]!;

  const stopPreview = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    stopSequence();
    setPlayingPrev(false);
  };
  useEffect(() => stopPreview, []);
  // Layout effect: attached before paint, so Escape works the moment Place appears.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); stopPreview(); captureView.value = 'off'; } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!res) return null;

  const padI = p.tracks.findIndex((t) => t.name === 'PAD');
  const bassI = p.tracks.findIndex((t) => t.name === 'BASS');

  // Preview: the engine plays the sequence sample-accurately through the tracks' own sounds; nothing
  // in the project changes. The only main-thread timer flips the button back when it ends.
  const playPreview = () => {
    if (playingPrev) { stopPreview(); return; }
    const seq: { track: number; note: number; vel: number; at: number; dur: number }[] = [];
    const note = (track: number, midi: number, step: number, len: number, vel: number) => {
      seq.push({ track, note: midi, vel, at: (step * stepMs) / 1000, dur: (Math.max(1, len) * 0.95 * stepMs) / 1000 });
    };
    for (const n of final) note(trackI, n.midi, n.step, n.length, n.velocity);
    if (parts.second) for (const n of harm.second) note(trackI, n.midi, n.step, n.length, n.velocity);
    for (const c of harm.chords) {
      if (parts.pad && padI >= 0 && padI !== trackI) for (const m of c.notes) note(padI, m, c.step, c.length, 80);
      if (parts.bass && bassI >= 0 && bassI !== trackI) note(bassI, c.bass, c.step, c.length, 100);
    }
    void playSequence(seq);
    setPlayingPrev(true);
    timers.current.push(window.setTimeout(stopPreview, melodySteps * stepMs + 200));
  };

  const close = () => { stopPreview(); captureView.value = 'off'; };

  const place = () => {
    stopPreview();
    const anyPart = parts.bass || parts.pad || parts.second;
    const pl = buildPlacement({ melody: final, melodySteps, repeat, harmony: anyPart ? harm : null, parts });
    const cmds: Command[] = [{ type: 'setSteps', track: trackI, pattern: slot, steps: pl.melody }];
    const written = [p.tracks[trackI]!.id];
    if (pl.pad && padI >= 0 && padI !== trackI) { cmds.push({ type: 'setSteps', track: padI, pattern: slot, steps: pl.pad }); written.push(p.tracks[padI]!.id); }
    if (pl.bass && bassI >= 0 && bassI !== trackI) { cmds.push({ type: 'setSteps', track: bassI, pattern: slot, steps: pl.bass }); written.push(p.tracks[bassI]!.id); }
    const sec = p.sections[sectionI];
    if (sec) {
      const patternByTrack = { ...sec.patternByTrack };
      for (const id of written) patternByTrack[id] = slot;
      cmds.push({ type: 'setSections', sections: p.sections.map((s) => (s === sec ? { ...s, patternByTrack } : s)) });
    }
    apply(cmds); // one undo step
    selectedTrack.value = trackI;
    currentPattern.value = slot;
    screen.value = 'play';
    captureView.value = 'off';
  };

  const keep = async () => {
    try {
      await saveSample(`Capture ${new Date().toTimeString().slice(0, 5)}`, { l: res.audio.l, rate: res.audio.rate }, 'record');
      setMsg('Saved to your samples as a clip.');
    } catch {
      setMsg('Could not save the clip (storage unavailable).');
    }
  };

  const otherSpot = () => {
    const t = p.tracks[trackI]!;
    const empty = PATTERN_IDS.filter((id) => id !== slot && t.patterns[id].steps.every((s) => s.t === 'rest'));
    const next = empty[0] ?? PATTERN_IDS[(PATTERN_IDS.indexOf(slot) + 1) % PATTERN_IDS.length]!;
    setSlot(next);
  };

  // Piano-roll style grid of the placed melody.
  const shown = [...final, ...(parts.second ? harm.second : [])];
  let lo = shown.length ? Math.min(...shown.map((n) => n.midi)) - 1 : 60;
  let hi = shown.length ? Math.max(...shown.map((n) => n.midi)) + 1 : 67;
  while (hi - lo < 7) { if ((hi - lo) % 2) hi++; else lo--; }
  const rows = hi - lo + 1;
  const labelAll = rows <= 9;
  const shiftTrace = meanShift(base, final);
  const barS = (60 / res.bpm) * 4;
  const trace: string[] = [];
  if (showRaw) {
    let pen = false;
    let prev = 0;
    for (const f of res.frames) {
      if (f.hz <= 0 || f.t < 0 || f.t > bars * barS) { pen = false; continue; }
      const m = 69 + 12 * Math.log2(f.hz / 440) + shiftTrace;
      const x = (f.t / (bars * barS)) * 100;
      const y = ((hi + 0.5 - m) / rows) * 100;
      if (pen && Math.abs(m - prev) > 2.5) pen = false;
      trace.push(`${pen ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`);
      pen = true;
      prev = m;
    }
  }

  const detName = `${pcName(detected.tonic)} ${SCALE_ABBR[detected.scale]}`;
  const songKey = `${pcName(p.key)} ${SCALE_ABBR[p.scale]}`;
  const fitted = mode === 'chromatic' && semis === fitSemis;
  const shiftLabel = mode === 'inkey' ? `${sign(steps)} scale steps` : `${sign(semis)} semitones`;
  const keyLabel = mode === 'inkey' ? `stays in ${pcName(p.key)} ${p.scale}` : fitted ? `hummed ${detName} → song key ${songKey}` : `now ${pcName(detected.tonic + semis)} ${SCALE_ABBR[detected.scale]} · tap to fit song key`;
  const nudge = (d: number) => (mode === 'inkey' ? setSteps((s) => Math.max(-7, Math.min(7, s + d))) : setSemis((s) => Math.max(-24, Math.min(24, s + d))));

  const tName = p.tracks[trackI]?.name ?? '';
  const sec = p.sections[sectionI];
  const users = p.sections.filter((s) => s.patternByTrack[p.tracks[trackI]!.id] === slot).map((s) => s.name);
  const repOpts = repeatOptions(melodySteps);
  const rep = repOpts.includes(repeat) ? repeat : 1;

  return (
    <div class="cap-back">
      <div class="cap noselect" role="dialog" aria-label="Place a melody">
        <div class="cap-head">
          <button class="cap-icon" aria-label="Close" onClick={close}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg>
          </button>
          <div class="col" style={{ flexGrow: 1, minWidth: 0 }}>
            <h2>Your melody</h2>
            <span class="cap-sub" data-testid="place-sub">{final.length} note{final.length === 1 ? '' : 's'} · {bars} bar{bars > 1 ? 's' : ''} · {res.transcription.model ? 'transcribed' : 'tracked'}</span>
          </div>
          <button class="cap-icon" aria-label={playingPrev ? 'Stop preview' : 'Play melody'} onClick={playPreview} style={{ background: 'var(--accent)', border: 'none' }} disabled={final.length === 0}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">{playingPrev ? <rect x="4" y="4" width="10" height="10" rx="1.5" fill="#121316" /> : <path d="M5 3 L15 9 L5 15 Z" fill="#121316" />}</svg>
          </button>
        </div>

        <div class="pl-grid" data-testid="melody-grid">
          {Array.from({ length: rows }, (_, i) => {
            const midi = hi - i;
            const c = midi % 12 === 0;
            return (
              <div key={i} class="pl-row" data-c={c ? '' : undefined} style={{ top: `${(i / rows) * 100}%`, height: `${100 / rows}%` }}>
                {(labelAll || c || midi % 12 === 7) && <span style={{ fontSize: rows > 12 ? '8px' : '10px' }}>{midiToNote(midi)}</span>}
              </div>
            );
          })}
          <div class="pl-area">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {Array.from({ length: bars + 1 }, (_, b) => <path key={b} d={`M${(b / bars) * 100} 0 V100`} stroke="#2e313a" stroke-width="1" vector-effect="non-scaling-stroke" />)}
              {showRaw && trace.length > 0 && <path d={trace.join(' ')} fill="none" stroke="#5cc8ff" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" data-testid="raw-trace" />}
            </svg>
            {parts.second && harm.second.map((n, i) => (
              <span key={`s${i}`} class="pl-note" data-2="" style={{ left: `calc(${(n.step / melodySteps) * 100}% + 1px)`, width: `calc(${(n.length / melodySteps) * 100}% - 2px)`, top: `calc(${((hi - n.midi) / rows) * 100}% + 2px)`, height: `calc(${100 / rows}% - 4px)` }} />
            ))}
            {final.map((n, i) => (
              <span key={i} class="pl-note" data-out={out[i] ? '' : undefined} data-testid="melody-note" data-midi={n.midi}
                style={{ left: `calc(${(n.step / melodySteps) * 100}% + 1px)`, width: `calc(${(n.length / melodySteps) * 100}% - 2px)`, top: `calc(${((hi - n.midi) / rows) * 100}% + 2px)`, height: `calc(${100 / rows}% - 4px)` }} />
            ))}
          </div>
        </div>

        <div class="pl-fit">
          <button class="cap-icon" aria-label="Transpose down" onClick={() => nudge(-1)} style={{ fontSize: '20px' }}>−</button>
          <button class="pl-fitchip" data-warn={anyOut ? '' : undefined} data-testid="fit-chip" aria-label="Fit to the song key" onClick={() => { setMode('chromatic'); setSteps(0); setSemis(fitSemis); }}>
            <b>{shiftLabel}</b><span>{anyOut ? `${out.filter(Boolean).length} out of key · tap to fit` : keyLabel}</span>
          </button>
          <button class="cap-icon" aria-label="Transpose up" onClick={() => nudge(1)} style={{ fontSize: '20px' }}>+</button>
          <button class="pl-mode" aria-pressed={mode === 'inkey'} onClick={() => { setMode(mode === 'inkey' ? 'chromatic' : 'inkey'); setSteps(0); }}>{mode === 'inkey' ? 'In key' : 'Chromatic'}</button>
        </div>

        <div class="row" style={{ gap: '6px', flex: '0 0 auto' }}>
          <button class="cap-chip" onClick={() => setGrid(grid === 8 ? 16 : 8)}>Snap 1/{grid}</button>
          <button class="cap-chip" aria-pressed={showRaw} onClick={() => setShowRaw(!showRaw)}>Show capture</button>
          <button class="cap-chip" onClick={() => { stopPreview(); captureView.value = 'capture'; }}>Redo</button>
        </div>

        <div class="pl-card assist" style={{ background: 'var(--surface)', borderColor: '#262930' }}>
          <div class="hd">
            <h3 style={{ color: 'var(--text)' }}>Where it goes</h3>
            <button onClick={otherSpot} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Other spot</button>
          </div>
          <div class="pl-where">
            <Stepper label="Track" value={tName} testId="chip-track" onPrev={() => setTrackI(melodic[wrap(melodic.findIndex((x) => x.i === trackI) - 1, melodic.length)]!.i)} onNext={() => setTrackI(melodic[wrap(melodic.findIndex((x) => x.i === trackI) + 1, melodic.length)]!.i)} />
            <Stepper label="Pattern" value={slot} testId="chip-pattern" onPrev={() => setSlot(PATTERN_IDS[wrap(PATTERN_IDS.indexOf(slot) - 1, 4)]!)} onNext={() => setSlot(PATTERN_IDS[wrap(PATTERN_IDS.indexOf(slot) + 1, 4)]!)} />
            <Stepper label="Octave" value={sign(oct)} testId="chip-octave" onPrev={() => setOct(Math.max(-4, oct - 1))} onNext={() => setOct(Math.min(4, oct + 1))} />
            <Stepper label="Repeat" value={`×${rep}`} testId="chip-repeat" onPrev={() => setRepeat(repOpts[wrap(repOpts.indexOf(rep) - 1, repOpts.length)]!)} onNext={() => setRepeat(repOpts[wrap(repOpts.indexOf(rep) + 1, repOpts.length)]!)} />
            {p.sections.length > 0 && (
              <Stepper label="Section" value={sec ? sec.name : '–'} testId="chip-section" onPrev={() => setSectionI(sectionI <= -1 ? p.sections.length - 1 : sectionI - 1)} onNext={() => setSectionI(sectionI >= p.sections.length - 1 ? -1 : sectionI + 1)} />
            )}
          </div>
          {p.sections.length > 0 && <span class="pl-note-msg" data-testid="section-uses">{users.length ? `${tName} ${slot} plays in: ${users.join(', ')}` : `${tName} ${slot} is not used in the song yet`}</span>}
        </div>

        <div class="pl-card">
          <div class="hd"><h3>Harmony</h3><small>on device, instant</small></div>
          {STYLES.map((s, i) => (
            <button key={s} class="pl-take" aria-pressed={take === i} aria-label={`Harmony ${TAKE_ID[i]} ${STYLE_LABEL[s]}`} onClick={() => setTake(i)}>
              <b>{TAKE_ID[i]}</b><span class="nm">{STYLE_LABEL[s]}</span><span class="ch" data-testid={`chords-${TAKE_ID[i]}`}>{chordSummary(harmonies[i]!)}</span>
            </button>
          ))}
          <div class="pl-parts">
            {([['bass', 'Bass'], ['pad', 'Pad'], ['second', '2nd voice']] as const).map(([k, label]) => (
              <button key={k} class="pl-part" aria-pressed={parts[k]} onClick={() => setParts({ ...parts, [k]: !parts[k] })}>{parts[k] ? '✓ ' : '+ '}{label}</button>
            ))}
          </div>
        </div>

        {msg && <span class="pl-note-msg" role="status">{msg}</span>}
        <div class="pl-actions">
          <button class="keep" onClick={() => void keep()}>Keep as clip</button>
          <button class="go" disabled={final.length === 0} onClick={place}>Place in {slot}</button>
        </div>
      </div>
    </div>
  );
}
