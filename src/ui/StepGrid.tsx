import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, currentPattern, selectedTrack, track } from '../store/project';
import type { Step } from '../store/types';
import { audibleStep, audition } from '../engine/host';
import { Sheet } from './Sheet';
import { isMelodic } from '../store/defaults';
import { MelodicGrid } from './MelodicGrid';

const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 8;

/** Drum tracks get the hit grid, melodic tracks the note/hold/chord grid. */
export function StepGrid() {
  return isMelodic(track.value) ? <MelodicGrid /> : <DrumGrid />;
}

function DrumGrid() {
  const t = track.value;
  const pat = t.patterns[currentPattern.value];
  const ti = selectedTrack.value;
  const [editing, setEditing] = useState<number | null>(null);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const press = useRef<{ i: number; x: number; y: number; timer: number; long: boolean; cancelled: boolean } | null>(null);

  // Playhead: one rAF loop, DOM attribute only. No signals, no re-renders.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const loop = () => {
      const g = audibleStep();
      const len = pat.length;
      const idx = g < 0 ? -1 : g % len;
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

  const endPress = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    els.current[p.i]?.removeAttribute('data-pressing');
    press.current = null;
  };

  const toggle = (i: number) => {
    const cur = pat.steps[i]!;
    const step: Step = cur.t === 'hit' ? { t: 'rest' } : { t: 'hit', vel: 100 };
    apply({ type: 'setStep', track: ti, pattern: currentPattern.value, index: i, step });
    if (step.t === 'hit') void audition(ti, step.vel);
  };

  const onDown = (i: number, e: PointerEvent) => {
    endPress();
    const p = { i, x: e.clientX, y: e.clientY, timer: 0, long: false, cancelled: false };
    p.timer = window.setTimeout(() => {
      p.long = true;
      els.current[i]?.removeAttribute('data-pressing');
      if (navigator.vibrate) navigator.vibrate(10);
      if (pat.steps[i]!.t !== 'hit') {
        apply({ type: 'setStep', track: ti, pattern: currentPattern.value, index: i, step: { t: 'hit', vel: 100 } });
      }
      setEditing(i);
    }, LONG_PRESS_MS);
    press.current = p;
    els.current[i]?.setAttribute('data-pressing', '');
  };

  const onMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.long || p.cancelled) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_CANCEL_PX) {
      p.cancelled = true;
      clearTimeout(p.timer);
      els.current[p.i]?.removeAttribute('data-pressing');
    }
  };

  const onUp = (i: number) => {
    const p = press.current;
    if (!p || p.i !== i) return;
    const tap = !p.long && !p.cancelled;
    endPress();
    if (tap) toggle(i);
  };

  const editStep = editing !== null ? pat.steps[editing] : undefined;

  return (
    <>
      <div class="step-grid">
        {pat.steps.slice(0, 16).map((s, i) => {
          const on = s.t === 'hit';
          const vel = s.t === 'hit' ? s.vel : 0;
          const chance = s.t === 'hit' ? s.chance : undefined;
          const beat = i % 4 === 0;
          return (
            <button
              key={i}
              ref={(el) => { els.current[i] = el; }}
              class="step noselect"
              aria-label={`Step ${i + 1}`}
              aria-pressed={on}
              onPointerDown={(e) => onDown(i, e)}
              onPointerMove={onMove}
              onPointerUp={() => onUp(i)}
              onPointerCancel={endPress}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); toggle(i); } }}
              style={{
                borderRadius: '12px',
                background: on ? 'var(--accent)' : beat ? 'var(--step-beat)' : 'var(--step-off)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--step-border)'}`,
                color: on ? 'var(--ground)' : 'var(--muted)',
                display: 'block',
                padding: '6px', minWidth: 0, minHeight: 0, overflow: 'hidden',
              }}
            >
              <span style={{ position: 'absolute', top: '4px', left: '6px', fontSize: '10px', lineHeight: '12px', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{i + 1}</span>
              <span style={{ position: 'absolute', top: '4px', right: '6px', fontSize: '10px', lineHeight: '12px', fontFamily: 'var(--font-mono)', fontWeight: 700, opacity: 0.9 }}>
                {chance !== undefined && chance < 1 ? `${Math.round(chance * 100)}%` : ''}
              </span>
              <span style={{ position: 'absolute', left: '6px', right: '6px', bottom: '6px', display: 'block', height: '6px', borderRadius: '3px', background: on ? 'rgba(18,19,22,0.25)' : 'transparent', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(vel / 127) * 100}%`, background: on ? 'var(--ground)' : 'transparent' }} />
              </span>
            </button>
          );
        })}
      </div>
      <div class="hint" style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', flex: '0 0 auto' }}>Tap to add · long-press for velocity and chance</div>
      {editing !== null && editStep?.t === 'hit' && (
        <StepEditor track={ti} index={editing} step={editStep} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function StepEditor(props: { track: number; index: number; step: Extract<Step, { t: 'hit' }>; onClose: () => void }) {
  const first = useRef(true);
  const { step } = props;
  const write = (patch: { vel?: number; chance?: number }) => {
    const vel = patch.vel ?? step.vel;
    const chance = patch.chance ?? step.chance ?? 1;
    const next: Step = chance >= 1 ? { t: 'hit', vel, ...(step.nudge !== undefined ? { nudge: step.nudge } : {}) } : { t: 'hit', vel, chance, ...(step.nudge !== undefined ? { nudge: step.nudge } : {}) };
    apply({ type: 'setStep', track: props.track, pattern: currentPattern.value, index: props.index, step: next }, { merge: !first.current });
    first.current = false;
  };
  const chancePct = Math.round((step.chance ?? 1) * 100);
  return (
    <Sheet title={`Step ${props.index + 1}`} onClose={props.onClose}>
      <label>
        <div class="row" style={{ justifyContent: 'space-between', fontSize: '13px' }}><span>Velocity</span><span class="mono">{step.vel}</span></div>
        <input type="range" min={1} max={127} step={1} value={step.vel} aria-label="Velocity"
          onInput={(e) => write({ vel: Number(e.currentTarget.value) })}
          onChange={() => { first.current = true; }} />
      </label>
      <label>
        <div class="row" style={{ justifyContent: 'space-between', fontSize: '13px' }}><span>Chance</span><span class="mono">{chancePct}%</span></div>
        <input type="range" min={0} max={100} step={1} value={chancePct} aria-label="Chance"
          onInput={(e) => write({ chance: Number(e.currentTarget.value) / 100 })}
          onChange={() => { first.current = true; }} />
      </label>
      <button class="btn" onClick={() => void audition(props.track, step.vel)}>Audition</button>
    </Sheet>
  );
}
