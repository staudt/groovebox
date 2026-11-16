import { useRef, useState } from 'preact/hooks';
import { apply, playing, project } from '../store/project';
import { BPM_MAX, BPM_MIN, SWING_MAX, SWING_MIN } from '../store/types';
import { togglePlay } from '../engine/host';
import { Sheet } from './Sheet';

const box = { border: '1px solid var(--border)', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

export function Transport() {
  const [open, setOpen] = useState(false);
  const p = project.value;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '44px' }}>
      <span style={{ fontSize: '16px', fontWeight: 700, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
      <button onClick={() => setOpen(true)} style={{ ...box, height: '44px', padding: '0 10px', borderRadius: '10px', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{p.bpm} BPM</button>
      <button aria-label="Record" disabled title="Recording arrives in a later phase" style={{ ...box, width: '44px', height: '44px', borderRadius: '12px', opacity: 0.4 }}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="var(--fx)" /></svg>
      </button>
      <button aria-label={playing.value ? 'Stop' : 'Play'} onClick={() => void togglePlay()} style={{ width: '44px', height: '44px', borderRadius: '12px', border: 'none', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          {playing.value ? <rect x="4" y="4" width="10" height="10" rx="1.5" fill="#121316" /> : <path d="M5 3 L15 9 L5 15 Z" fill="#121316" />}
        </svg>
      </button>
      {open && <TempoSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function TempoSheet(props: { onClose: () => void }) {
  const p = project.value;
  const taps = useRef<number[]>([]);
  const swingFirst = useRef(true);
  const bpmFirst = useRef(true);
  const drag = useRef<{ x: number; bpm: number; first: boolean } | null>(null);

  const tap = () => {
    const now = performance.now();
    const t = taps.current;
    if (t.length && now - t[t.length - 1]! > 2000) t.length = 0;
    t.push(now);
    if (t.length > 5) t.shift();
    if (t.length >= 2) {
      const avg = (t[t.length - 1]! - t[0]!) / (t.length - 1);
      apply({ type: 'setBpm', bpm: 60000 / avg });
    }
  };

  return (
    <Sheet title="Tempo" onClose={props.onClose}>
      <div class="row" style={{ justifyContent: 'center' }}>
        <button class="btn square" aria-label="BPM down" onClick={() => apply({ type: 'setBpm', bpm: p.bpm - 1 })}>−</button>
        <div
          class="mono noselect"
          aria-label={`${p.bpm} BPM, drag sideways to change`}
          style={{ width: '140px', height: '64px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', touchAction: 'pan-y', cursor: 'ew-resize' }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, bpm: project.value.bpm, first: true }; }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const bpm = d.bpm + Math.round((e.clientX - d.x) / 6);
            if (bpm === project.value.bpm) return;
            apply({ type: 'setBpm', bpm }, { merge: !d.first });
            d.first = false;
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        >{p.bpm}</div>
        <button class="btn square" aria-label="BPM up" onClick={() => apply({ type: 'setBpm', bpm: p.bpm + 1 })}>+</button>
      </div>
      <input
        type="range" min={BPM_MIN} max={BPM_MAX} step={1} value={p.bpm} aria-label="BPM"
        onInput={(e) => {
          apply({ type: 'setBpm', bpm: Number(e.currentTarget.value) }, { merge: !bpmFirst.current });
          bpmFirst.current = false;
        }}
        onChange={() => { bpmFirst.current = true; }}
      />
      <div class="row mono" style={{ justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginTop: '-8px' }}>
        <span>{BPM_MIN}</span><span>{BPM_MAX}</span>
      </div>
      <button class="btn" onClick={tap}>Tap tempo</button>
      <div>
        <div class="row" style={{ justifyContent: 'space-between', fontSize: '13px' }}>
          <span>Swing</span><span class="mono">{Math.round(p.swing)}%</span>
        </div>
        <input
          type="range" min={SWING_MIN} max={SWING_MAX} step={1} value={p.swing} aria-label="Swing"
          onInput={(e) => {
            apply({ type: 'setSwing', swing: Number(e.currentTarget.value) }, { merge: !swingFirst.current });
            swingFirst.current = false;
          }}
          onChange={() => { swingFirst.current = true; }}
        />
      </div>
    </Sheet>
  );
}
