import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, currentPattern, selectedStep, selectedTrack, track } from '../store/project';
import type { Step } from '../store/types';
import { midiToNote } from '../store/notation';
import { audibleStep, previewNotes } from '../engine/host';
import { addNote, extendHold, isNoteStart, removeAt } from '../store/stepEdit';
import { defaultNote, setLastNote } from './keysState';
import { StepPicker } from './StepPicker';
import './keys.css';

const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 8;
const COLS = 4;
const VISIBLE = 16;

type Press = { i: number; x: number; y: number; timer: number; long: boolean; cancelled: boolean; drag: boolean };

function stepText(s: Step): { main: string; sub: string } {
  if (s.t === 'chord') return { main: s.symbol, sub: 'chord' };
  if (s.t === 'hold') return { main: '', sub: 'hold' };
  return { main: s.t === 'note' ? midiToNote(s.note) : '', sub: '' };
}

/** Step grid for melodic (FM) tracks: notes, holds and chords. Drum grid lives in StepGrid.tsx. */
export function MelodicGrid() {
  const pat = track.value.patterns[currentPattern.value];
  const ti = selectedTrack.value;
  const [picker, setPicker] = useState<number | null>(null);
  const [draft, setDraft] = useState<Step[] | null>(null);
  const draftRef = useRef<Step[] | null>(null);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const gridEl = useRef<HTMLDivElement | null>(null);
  const press = useRef<Press | null>(null);
  const sel = selectedStep.value;

  // Selection belongs to one track + pattern.
  useEffect(() => { selectedStep.value = -1; setPicker(null); }, [ti, currentPattern.value]);
  useEffect(() => () => { selectedStep.value = -1; }, []);

  // Playhead: one rAF loop, DOM attribute only.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const loop = () => {
      const g = audibleStep();
      const idx = g < 0 ? -1 : g % pat.length;
      if (idx !== last) {
        if (last >= 0) els.current[last]?.removeAttribute('data-head');
        if (idx >= 0) els.current[idx]?.setAttribute('data-head', '');
        last = idx;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pat.length, ti]);

  const setDraftBoth = (d: Step[] | null) => { draftRef.current = d; setDraft(d); };

  const endPress = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    els.current[p.i]?.removeAttribute('data-pressing');
    press.current = null;
  };

  const write = (steps: Step[]) => apply({ type: 'setSteps', track: ti, pattern: currentPattern.value, steps });

  const tap = (i: number) => {
    const cur = pat.steps[i]!;
    if (cur.t === 'rest') {
      const note = defaultNote(ti);
      write(addNote(pat.steps, i, note));
      selectedStep.value = i;
      setLastNote(ti, note);
      void previewNotes(ti, [note], 100);
    } else {
      write(removeAt(pat.steps, i));
      if (selectedStep.value === i) selectedStep.value = -1;
    }
  };

  const onDown = (i: number, e: PointerEvent) => {
    endPress();
    gridEl.current?.setPointerCapture(e.pointerId);
    const p: Press = { i, x: e.clientX, y: e.clientY, timer: 0, long: false, cancelled: false, drag: false };
    p.timer = window.setTimeout(() => {
      p.long = true;
      els.current[i]?.removeAttribute('data-pressing');
      if (navigator.vibrate) navigator.vibrate(10);
      selectedStep.value = i;
      setPicker(i);
    }, LONG_PRESS_MS);
    press.current = p;
    els.current[i]?.setAttribute('data-pressing', '');
  };

  const onMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.long) return;
    if (!p.cancelled && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) {
      p.cancelled = true;
      clearTimeout(p.timer);
      els.current[p.i]?.removeAttribute('data-pressing');
    }
    if (!p.cancelled || !isNoteStart(pat.steps[p.i])) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-i]');
    if (!hit) return;
    const to = Math.min(VISIBLE - 1, Math.max(p.i, Number(hit.dataset['i'])));
    if (!p.drag && to === p.i) return;
    p.drag = true;
    const next = extendHold(pat.steps, p.i, to);
    const prev = draftRef.current ?? pat.steps;
    if (next.some((s, k) => s !== prev[k])) setDraftBoth(next);
  };

  const onUp = () => {
    const p = press.current;
    if (!p) return;
    const final = draftRef.current;
    const { long, cancelled, drag, i } = p;
    endPress();
    setDraftBoth(null);
    if (long) return;
    if (drag) { if (final) write(final); }
    else if (!cancelled) tap(i);
  };

  const onCancel = () => { endPress(); setDraftBoth(null); };

  const shown = draft ?? pat.steps;
  const pickStep = picker !== null ? pat.steps[picker] : undefined;

  return (
    <>
      <div
        ref={gridEl}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gap: '8px', touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
      >
        {shown.slice(0, VISIBLE).map((s, i) => {
          const on = s.t !== 'rest';
          const hold = s.t === 'hold';
          const beat = i % 4 === 0;
          const { main, sub } = stepText(s);
          return (
            <button
              key={i}
              data-i={i}
              {...(sel === i ? { 'data-sel': '' } : {})}
              ref={(el) => { els.current[i] = el; }}
              class="step noselect"
              aria-label={`Step ${i + 1}`}
              aria-pressed={on}
              onPointerDown={(e) => onDown(i, e)}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tap(i); } }}
              style={{
                touchAction: 'none',
                aspectRatio: '1 / 0.78', borderRadius: '12px',
                background: hold ? 'rgba(255,181,71,0.44)' : on ? 'var(--accent)' : beat ? 'var(--step-beat)' : 'var(--step-off)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--step-border)'}`,
                color: on ? 'var(--ground)' : 'var(--muted)',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '7px', minWidth: 0,
              }}
            >
              <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{i + 1}</span>
              <span style={{ fontSize: '15px', fontWeight: 700, minHeight: '18px', width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{main}</span>
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', opacity: 0.85, minHeight: '11px' }}>{sub}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center' }}>Tap to add · drag right to hold · long-press for note or chord</div>
      {picker !== null && pickStep && (
        <StepPicker track={ti} index={picker} step={pickStep} onClose={() => setPicker(null)} />
      )}
    </>
  );
}
