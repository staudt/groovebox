// Inline, live Rhythm tool for the Play screen: re-times the selected pattern onto an Euclidean grid while the loop plays.
// The whole session is one undo step; Cancel restores the pattern as it was when the panel opened.
import { useRef, useState } from 'preact/hooks';
import { apply, currentPattern, project, selectedTrack, track, undo, undoDepth } from '../store/project';
import type { Step } from '../store/types';
import { isMelodic } from '../store/defaults';
import { countOnsets, rhythmize, shiftSteps } from '../store/rhythm';
import { defaultNote } from './keysState';

const btn = {
  height: '44px', minWidth: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-2)', fontSize: '12px', cursor: 'pointer', flexShrink: 0,
} as const;

export function RhythmPanel(props: { onClose: () => void }) {
  const t = useRef(selectedTrack.value);
  const pat = useRef(currentPattern.value);
  const read = (): Step[] => project.value.tracks[t.current]!.patterns[pat.current].steps;
  const session = useRef<{ original: Step[]; base: Step[]; wrote: boolean; depth: number } | null>(null);
  if (!session.current) {
    const s = read().slice();
    session.current = { original: s, base: s, wrote: false, depth: -1 };
  }
  const ses = session.current;
  const [hits, setHits] = useState(() => countOnsets(ses.base));
  const [rotate, setRotate] = useState(0);

  const write = (steps: Step[]) => {
    const merge = ses.wrote && undoDepth() === ses.depth;
    apply({ type: 'setSteps', track: t.current, pattern: pat.current, steps }, { merge });
    if (!merge) ses.depth = undoDepth();
    ses.wrote = true;
  };
  const fallback = (): Step =>
    isMelodic(track.value) ? { t: 'note', note: defaultNote(t.current), vel: 100 } : { t: 'hit', vel: 100 };
  const regen = (h: number, r: number) => write(rhythmize(ses.base, h, r, fallback()));
  const shift = (by: number) => {
    ses.base = shiftSteps(ses.base, by);
    write(shiftSteps(read(), by));
  };
  const clear = () => {
    const rests: Step[] = read().map(() => ({ t: 'rest' }));
    ses.base = rests;
    setHits(0);
    setRotate(0);
    write(rests);
  };
  const cancel = () => {
    if (ses.wrote) {
      if (undoDepth() === ses.depth) undo();
      else apply({ type: 'setSteps', track: t.current, pattern: pat.current, steps: ses.original });
    }
    props.onClose();
  };

  const row = { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' } as const;
  return (
    <div role="group" aria-label="Rhythm" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
      <label style={row}>
        <span style={{ width: '56px', fontSize: '13px' }}>Hits</span>
        <input
          type="range" min={0} max={16} step={1} value={hits} aria-label="Hits" style={{ flex: 1, minWidth: 0 }}
          onInput={(e) => { const v = Number(e.currentTarget.value); setHits(v); regen(v, rotate); }}
        />
        <span class="mono" style={{ width: '24px', textAlign: 'right', fontSize: '13px' }}>{hits}</span>
      </label>
      <label style={row}>
        <span style={{ width: '56px', fontSize: '13px' }}>Rotate</span>
        <input
          type="range" min={0} max={15} step={1} value={rotate} aria-label="Rotate" style={{ flex: 1, minWidth: 0 }}
          onInput={(e) => { const v = Number(e.currentTarget.value); setRotate(v); regen(hits, v); }}
        />
        <span class="mono" style={{ width: '24px', textAlign: 'right', fontSize: '13px' }}>{rotate}</span>
      </label>
      <div style={{ ...row, gap: '6px' }}>
        <button style={btn} aria-label="Shift left" onClick={() => shift(-1)}>◀</button>
        <button style={btn} aria-label="Shift right" onClick={() => shift(1)}>▶</button>
        <button style={btn} onClick={clear}>Clear</button>
        <span style={{ flex: 1 }} />
        <button style={btn} onClick={cancel}>Cancel</button>
        <button style={{ ...btn, background: 'var(--accent)', color: 'var(--ground)', borderColor: 'var(--accent)', fontWeight: 700 }} onClick={props.onClose}>Done</button>
      </div>
    </div>
  );
}
