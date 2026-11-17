import { useEffect, useRef } from 'preact/hooks';
import { apply, project } from '../store/project';
import { readMeters } from '../engine/host';

// Mixer view: one compact strip per track plus a master strip. Meters are painted from
// requestAnimationFrame straight to element styles (no re-renders per frame).

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const UNITY = 0.8;
const THUMB = 22;

type Axis = 'x' | 'y' | 'xy';

/**
 * Pointer drag for a 0..1 (or -1..1) value. Relative: the value moves with the finger from where it
 * was grabbed. `onChange(v, merge)`: merge is false for the first change of a gesture (one undo
 * per drag). A tap without moving twice quickly resets to `def`.
 */
function useDrag(o: { value: number; min: number; max: number; def: number; axis: Axis; span: () => number; onChange: (v: number, merge: boolean) => void }) {
  const g = useRef<{ x: number; y: number; v0: number; first: boolean; moved: boolean; span: number } | null>(null);
  const lastTap = useRef(0);
  const range = o.max - o.min;
  const snap = (v: number) => Math.round(Math.min(o.max, Math.max(o.min, v)) * 1000) / 1000;
  return {
    onPointerDown(e: PointerEvent) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      g.current = { x: e.clientX, y: e.clientY, v0: o.value, first: true, moved: false, span: Math.max(20, o.span()) };
    },
    onPointerMove(e: PointerEvent) {
      const d = g.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = d.y - e.clientY;
      const delta = o.axis === 'x' ? dx : o.axis === 'y' ? dy : dx + dy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      const v = snap(d.v0 + (delta / d.span) * range);
      if (v === o.value && !d.first) return;
      o.onChange(v, !d.first);
      d.first = false;
    },
    onPointerUp() {
      const d = g.current;
      g.current = null;
      if (!d || d.moved) return;
      const now = performance.now();
      if (now - lastTap.current < 320) { o.onChange(o.def, false); lastTap.current = 0; }
      else lastTap.current = now;
    },
    onPointerCancel() { g.current = null; },
    onKeyDown(e: KeyboardEvent) {
      const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
      const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
      if (!up && !down) return;
      e.preventDefault();
      o.onChange(snap(o.value + (up ? 1 : -1) * range * 0.02), false);
    },
  };
}

function VFader(props: { label: string; value: number; def: number; onChange: (v: number, merge: boolean) => void; meterRef: (el: HTMLElement | null) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useDrag({ value: props.value, min: 0, max: 1, def: props.def, axis: 'y', span: () => (rail.current?.clientHeight ?? 100) - THUMB, onChange: props.onChange });
  const pos = (v: number) => `calc(${v} * (100% - ${THUMB}px) + ${THUMB / 2}px)`;
  return (
    <div
      ref={rail}
      class="mx-fader"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value * 100)}
      aria-valuetext={`${Math.round(props.value * 100)} percent`}
      {...drag}
    >
      <div class="mx-meter"><i ref={props.meterRef} /></div>
      <div class="mx-rail" />
      <div class="mx-unity" style={{ bottom: pos(props.def) }}><span>0 dB</span></div>
      <div class="mx-thumb" style={{ bottom: `calc(${props.value} * (100% - ${THUMB}px))` }} />
    </div>
  );
}

const ARC = 94.2;

function MiniKnob(props: { label: string; aria: string; value: number; def?: number; disabled?: boolean; onChange: (v: number, merge: boolean) => void }) {
  const drag = useDrag({ value: props.value, min: 0, max: 1, def: props.def ?? 0, axis: 'xy', span: () => 140, onChange: props.onChange });
  const off = props.disabled === true;
  return (
    <div
      class="mx-knob"
      role="slider"
      tabIndex={off ? -1 : 0}
      aria-label={props.aria}
      aria-disabled={off}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value * 100)}
      {...(off ? {} : drag)}
    >
      <svg width="30" height="30" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="20" fill="none" stroke="#2A2D34" stroke-width="6" stroke-dasharray={`${ARC} 125.7`} transform="rotate(135 26 26)" stroke-linecap="round" />
        <circle cx="26" cy="26" r="20" fill="none" stroke="var(--accent)" stroke-width="6" stroke-dasharray={`${(ARC * props.value).toFixed(1)} 125.7`} transform="rotate(135 26 26)" stroke-linecap="round" />
      </svg>
      <span>{props.label}</span>
    </div>
  );
}

function PanControl(props: { aria: string; value: number; onChange: (v: number, merge: boolean) => void }) {
  const drag = useDrag({ value: props.value, min: -1, max: 1, def: 0, axis: 'x', span: () => 90, onChange: props.onChange });
  const pct = Math.round(props.value * 100);
  return (
    <div class="mx-pan" role="slider" tabIndex={0} aria-label={props.aria} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={pct === 0 ? 'center' : pct < 0 ? `left ${-pct}` : `right ${pct}`} {...drag}>
      <div class="mx-pan-bar"><i style={{ left: '50%', width: `${Math.abs(pct) / 2}%`, transform: pct < 0 ? 'translateX(-100%)' : 'none' }} /></div>
      <span>{pct === 0 ? 'C' : pct < 0 ? `L${-pct}` : `R${pct}`}</span>
    </div>
  );
}

export function MixView() {
  const p = project.value;
  const meterEls = useRef<(HTMLElement | null)[]>([]);
  // Meter painting: one rAF loop, no signals. Peaks fall smoothly.
  useEffect(() => {
    let raf = 0;
    const shown = new Float32Array(9);
    const loop = () => {
      const m = readMeters();
      for (let i = 0; i < 9; i++) {
        const raw = i < 8 ? m.tracks[i]! : m.master;
        const v = clamp01((20 * Math.log10(Math.max(raw, 1e-4)) + 48) / 48);
        shown[i] = Math.max(v, shown[i]! * 0.9);
        const el = meterEls.current[i];
        if (el) el.style.transform = `scaleY(${shown[i]!.toFixed(3)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const duckSrc = p.mixer.duckSource;
  return (
    <div class="mx" aria-label="Mixer">
      <div class="mx-strips">
        {p.tracks.map((t, i) => {
          const ch = p.mixer.tracks[i]!;
          const space = t.macros[3].value;
          const isSrc = i === duckSrc;
          return (
            <div class="mx-strip" key={t.id} data-muted={t.mute ? '' : undefined} aria-label={`${t.name} channel`} role="group">
              <b class="mx-name">{t.name}</b>
              <div class="mx-ms">
                <button aria-label={`Mute ${t.name}`} aria-pressed={t.mute} data-kind="mute" onClick={() => apply({ type: 'setMute', track: i, mute: !t.mute })}>M</button>
                <button aria-label={`Mixer solo ${t.name}`} aria-pressed={ch.solo} data-kind="solo" onClick={() => apply({ type: 'setChannel', track: i, patch: { solo: !ch.solo } })}>S</button>
              </div>
              <VFader label={`Level ${t.name}`} value={ch.level} def={UNITY} meterRef={(el) => { meterEls.current[i] = el; }} onChange={(v, merge) => apply({ type: 'setChannel', track: i, patch: { level: v } }, { merge })} />
              <PanControl aria={`Pan ${t.name}`} value={ch.pan} onChange={(v, merge) => apply({ type: 'setChannel', track: i, patch: { pan: v } }, { merge })} />
              <MiniKnob label="Space" aria={`Space ${t.name}`} value={space} onChange={(v, merge) => apply({ type: 'setMacro', track: i, macro: 3, value: v }, { merge })} />
              <MiniKnob label="Delay" aria={`Delay ${t.name}`} value={ch.sendB} onChange={(v, merge) => apply({ type: 'setChannel', track: i, patch: { sendB: v } }, { merge })} />
              <MiniKnob label={isSrc ? 'Key' : 'Duck'} aria={`Duck ${t.name}`} value={isSrc ? 0 : ch.duck} disabled={isSrc} onChange={(v, merge) => apply({ type: 'setChannel', track: i, patch: { duck: v } }, { merge })} />
            </div>
          );
        })}
      </div>
      <div class="mx-strip mx-master" role="group" aria-label="Master">
        <b class="mx-name">MASTER</b>
        <button class="mx-key" aria-label={`Sidechain key: ${p.tracks[duckSrc]!.name}`} title="Track that triggers the ducking; tap for the next one" onClick={() => apply({ type: 'setMixer', patch: { duckSource: (duckSrc + 1) % p.tracks.length } })}>
          <small>Duck key</small>{p.tracks[duckSrc]!.name}
        </button>
        <VFader label="Master level" value={p.mixer.master} def={0.9} meterRef={(el) => { meterEls.current[8] = el; }} onChange={(v, merge) => apply({ type: 'setMixer', patch: { master: v } }, { merge })} />
        <MiniKnob label="Release" aria="Duck release" def={0.4} value={p.mixer.duckRelease} onChange={(v, merge) => apply({ type: 'setMixer', patch: { duckRelease: v } }, { merge })} />
      </div>
    </div>
  );
}
