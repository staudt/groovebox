import { useRef } from 'preact/hooks';

const DEAD_PX = 6;

/**
 * Horizontal-drag numeric control (touch and mouse), 44 px tall, keyboard adjustable.
 * `onChange(v, merge)`: merge is false for the first change of a gesture, true after
 * (pass it straight to apply({merge})). `onCommit` fires when the gesture ends.
 */
export function DragValue(props: {
  label: string;
  /** Accessible name when it differs from the short visible label. */
  aria?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Pixels for a full min..max sweep. */
  span?: number;
  fmt?: (v: number) => string;
  onChange: (v: number, merge: boolean) => void;
  onCommit?: () => void;
  testId?: string;
}) {
  // `engaged`: the gesture is a sideways drag (past DEAD_PX, mostly horizontal). Until then a
  // vertical swipe can still become a page scroll (touch-action: pan-y), so nothing changes.
  const g = useRef({ active: false, engaged: false, x0: 0, y0: 0, v0: 0, first: true, last: NaN });
  const snap = (v: number) => {
    const s = Math.round((v - props.min) / props.step) * props.step + props.min;
    return Math.min(props.max, Math.max(props.min, Math.round(s * 1e6) / 1e6));
  };
  const emit = (v: number) => {
    if (v === g.current.last) return;
    g.current.last = v;
    props.onChange(v, !g.current.first);
    g.current.first = false;
  };
  const fmt = props.fmt ?? ((v: number) => String(v));
  return (
    <div
      class="dv"
      role="slider"
      tabIndex={0}
      aria-label={props.aria ?? props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={fmt(props.value)}
      data-testid={props.testId}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        g.current = { active: true, engaged: false, x0: e.clientX, y0: e.clientY, v0: props.value, first: true, last: props.value };
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (!s.active) return;
        if (!s.engaged) {
          const dx = Math.abs(e.clientX - s.x0);
          if (dx < DEAD_PX || dx < Math.abs(e.clientY - s.y0)) return;
          s.engaged = true;
          s.x0 = e.clientX; // start from here so the dead zone doesn't jump the value
        }
        const per = (props.max - props.min) / (props.span ?? 200);
        emit(snap(s.v0 + (e.clientX - s.x0) * per));
      }}
      onPointerUp={() => {
        if (!g.current.active) return;
        g.current.active = false;
        if (!g.current.first) props.onCommit?.();
      }}
      onPointerCancel={() => { g.current.active = false; }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        g.current = { active: false, engaged: false, x0: 0, y0: 0, v0: props.value, first: true, last: NaN };
        emit(snap(props.value + d * props.step));
        props.onCommit?.();
      }}
    >
      <span class="dv-label">{props.label}</span>
      <span class="dv-val mono">{fmt(props.value)}</span>
    </div>
  );
}
