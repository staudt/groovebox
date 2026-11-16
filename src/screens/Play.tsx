import { useState } from 'preact/hooks';
import { apply, currentPattern, selectedTrack, track } from '../store/project';
import type { Step } from '../store/types';
import { euclid } from '../store/euclid';
import { StepGrid } from '../ui/StepGrid';
import { Macros } from '../ui/Macros';
import { AskBar } from '../ui/AskBar';
import { Sheet, Stepper } from '../ui/Sheet';

function EuclidSheet(props: { onClose: () => void }) {
  const [hits, setHits] = useState(4);
  const [rotate, setRotate] = useState(0);
  const pattern = euclid(hits, 16, rotate);
  return (
    <Sheet title="Euclid" onClose={props.onClose}>
      <Stepper label="Hits" value={hits} min={0} max={16} onChange={setHits} />
      <Stepper label="Rotate" value={rotate} min={0} max={15} onChange={setRotate} />
      <div class="mono" aria-label="Preview" style={{ letterSpacing: '2px', fontSize: '14px', color: 'var(--accent)', textAlign: 'center' }}>
        {pattern.map((b) => (b ? 'x' : '.')).join('')}
      </div>
      <button
        class="btn primary"
        onClick={() => {
          const steps: Step[] = pattern.map((b) => (b ? { t: 'hit', vel: 100 } : { t: 'rest' }));
          apply({ type: 'setSteps', track: selectedTrack.value, pattern: currentPattern.value, steps });
          props.onClose();
        }}
      >Apply</button>
    </Sheet>
  );
}

export function Play() {
  const [euclidOpen, setEuclidOpen] = useState(false);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, flexGrow: 1 }}>{track.value.name} · 16 steps</span>
        <button disabled title="Capture arrives in a later phase" style={{ height: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--assist-border)', background: 'var(--assist-bg)', color: 'var(--assist-text)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.5 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="9" rx="2.5" /><path d="M3 8 a5 5 0 0 0 10 0 M8 13 v2" /></svg>Capture
        </button>
        <button onClick={() => setEuclidOpen(true)} style={{ height: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', fontSize: '12px' }}>Euclid</button>
      </div>
      <StepGrid />
      <Macros />
      <AskBar />
      {euclidOpen && <EuclidSheet onClose={() => setEuclidOpen(false)} />}
    </>
  );
}
