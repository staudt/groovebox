import { useRef } from 'preact/hooks';
import { apply, selectedTrack, track } from '../store/project';

const ARC = 94.2; // 270 degrees of r=20 circle
const DRAG_PX = 160; // full range
const DEFAULT = 0.5;

function Knob(props: { index: number; label: string; value: number; color: string; inert: boolean }) {
  const drag = useRef<{ y: number; x: number; v: number; first: boolean; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const { index, value } = props;

  const set = (v: number, merge: boolean) => apply({ type: 'setMacro', track: selectedTrack.value, macro: index, value: v }, { merge });

  return (
    <div
      role="slider"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-disabled={props.inert}
      tabIndex={props.inert ? -1 : 0}
      class="noselect"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', touchAction: 'pan-y', opacity: props.inert ? 0.4 : 1, minHeight: '44px', cursor: props.inert ? 'default' : 'ns-resize' }}
      onPointerDown={(e) => {
        if (props.inert) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, x: e.clientX, v: value, first: true, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = (d.y - e.clientY + (e.clientX - d.x)) / DRAG_PX;
        if (!d.moved && Math.abs(d.y - e.clientY) + Math.abs(e.clientX - d.x) < 3) return;
        d.moved = true;
        set(Math.min(1, Math.max(0, d.v + delta)), !d.first);
        d.first = false;
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        const now = performance.now();
        if (now - lastTap.current < 320) { set(DEFAULT, false); lastTap.current = 0; }
        else lastTap.current = now;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(e) => {
        if (props.inert) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(Math.min(1, value + 0.05), false); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(Math.max(0, value - 0.05), false); }
      }}
    >
      {/* The dial itself takes all touch directions (vertical drag turns it); the label scrolls. */}
      <svg width="40" height="40" viewBox="0 0 52 52" aria-hidden="true" style={{ touchAction: 'none' }}>
        <circle cx="26" cy="26" r="20" fill="none" stroke="#2A2D34" stroke-width="5" stroke-dasharray={`${ARC} 125.7`} transform="rotate(135 26 26)" stroke-linecap="round" />
        <circle cx="26" cy="26" r="20" fill="none" stroke={props.color} stroke-width="5" stroke-dasharray={`${(ARC * value).toFixed(1)} 125.7`} transform="rotate(135 26 26)" stroke-linecap="round" />
      </svg>
      <span style={{ fontSize: '11px', color: 'var(--text-2)' }}>{props.label}</span>
    </div>
  );
}

export function Macros() {
  const macros = track.value.macros;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', flex: '0 0 auto' }}>
      {macros.map((m, i) => (
        <Knob key={i} index={i} label={m.label} value={m.value} color={i === 3 ? 'var(--assist)' : 'var(--accent)'} inert={false} />
      ))}
    </div>
  );
}
