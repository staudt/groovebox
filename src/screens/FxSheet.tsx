import { useLayoutEffect, useRef } from 'preact/hooks';
import { FX_DEFS } from '../engine/fx/ids';
import { fxTarget, fxXYState, heldFx, latch, moveXY, recordMoves, setLatch } from '../app/fxState';
import { clearFxMoves, hasFxMoves } from '../app/fxMoves';
import { currentPattern } from '../store/project';
import { fxSheetOpen } from '../app/nav';
import { track } from '../store/project';
import { FxHoldButton } from '../ui/FxHoldButton';
import '../ui/fx.css';

/** Effect XY pad: dragging moves every held effect. Per-pointer so it works while another finger holds a button. */
function XyPad() {
  const held = heldFx.value;
  const active = held.length > 0 ? held[held.length - 1]! : null;
  const def = active ? FX_DEFS.find((d) => d.id === active) : undefined;
  const [x, y] = (active && fxXYState.value[active]) || [0.5, 0.5];
  const ref = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Set<number>());

  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    moveXY((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  };
  return (
    <div
      ref={ref}
      class="fx-pad"
      role="group"
      aria-label="Effect XY pad"
      data-x={active ? Math.round(x * 100) : ''}
      data-y={active ? Math.round(y * 100) : ''}
      onPointerDown={(e) => {
        e.preventDefault();
        try { ref.current?.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
        pointers.current.add(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={(e) => { pointers.current.delete(e.pointerId); }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); }}
    >
      <svg class="fx-pad-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M25 0 V100 M50 0 V100 M75 0 V100 M0 50 H100" vector-effect="non-scaling-stroke" />
      </svg>
      {active && (
        <span class="fx-dot" data-testid="fx-dot" data-x={Math.round(x * 100)} data-y={Math.round(y * 100)} style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
      )}
      <span class="fx-pad-label" style={{ left: '10px', bottom: '8px' }}>X  {(def?.x ?? 'amount').toUpperCase()}</span>
      <span class="fx-pad-label" style={{ left: '10px', top: '8px' }}>Y  {(def?.y ?? 'mix').toUpperCase()}</span>
      <span class="fx-pad-label" style={{ right: '10px', top: '8px' }}>slide while holding</span>
    </div>
  );
}

export function FxSheet() {
  const close = () => { fxSheetOpen.value = false; };
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const target = fxTarget.value;
  return (
    <div class="fx-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="fx-sheet noselect" role="dialog" aria-label="FX">
        <button class="fx-grab" aria-label="Close FX" onClick={close}><span /></button>
        <div class="fx-head">
          <span class="fx-title">FX</span>
          <button class="fx-chip" aria-pressed={target === 'master'} onClick={() => { fxTarget.value = 'master'; }}>Master</button>
          <button class="fx-chip fx-track" aria-pressed={target === 'track'} onClick={() => { fxTarget.value = 'track'; }}>{track.value.name}</button>
          <button class="fx-chip" aria-pressed={latch.value} onClick={() => setLatch(!latch.value)}>Latch</button>
          <button class="fx-chip fx-rec" aria-label="Record FX moves into the pattern" aria-pressed={recordMoves.value} onClick={() => { recordMoves.value = !recordMoves.value; }}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>Moves
          </button>
        </div>
        {hasFxMoves() && (
          <div class="fx-moves">
            <span>Moves recorded in pattern {currentPattern.value}</span>
            <button class="fx-chip" onClick={clearFxMoves}>Clear moves</button>
          </div>
        )}
        <div class="fx-grid">
          {FX_DEFS.map((d) => (
            <FxHoldButton key={d.id} fx={d.id} class="fx-btn" label={`${d.label} ${d.sub}`}>
              <span class="fx-btn-name">{d.label}</span>
              <span class="fx-btn-sub">{d.sub}</span>
            </FxHoldButton>
          ))}
        </div>
        <XyPad />
      </div>
    </div>
  );
}
