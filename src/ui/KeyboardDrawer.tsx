import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, currentPattern, project, selectedStep, selectedTrack } from '../store/project';
import { isMelodic } from '../store/defaults';
import type { Midi } from '../store/types';
import { midiToNote } from '../store/notation';
import { inScale, pcName, scaleNotes, SCALES } from '../harmony/theory';
import { allNotesOff, noteOff, noteOn } from '../engine/host';
import { captureView } from '../app/nav';
import { getOctave, octaveBase, setLastNote, setOctave, OCT_MAX, OCT_MIN } from './keysState';
import './keys.css';

type Layout = 'scale' | 'piano';

// Computer keys (by physical position): white keys C..C, black keys.
const WHITE_KEYS: Record<string, number> = { KeyA: 0, KeyS: 2, KeyD: 4, KeyF: 5, KeyG: 7, KeyH: 9, KeyJ: 11, KeyK: 12 };
const BLACK_KEYS: Record<string, number> = { KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10 };
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_PCS = [1, 3, 6, 8, 10];
// Black key i sits between white keys BLACK_AFTER[i] and the next one.
const BLACK_AFTER = [0, 1, 3, 4, 5];
// Desktop variant: eight white keys C..C (K plays the next C), labeled with the computer key that plays them.
const DESK_WHITE_PCS = [0, 2, 4, 5, 7, 9, 11, 12];
/** Computer key letter by semitone above the octave's C (A = 0, W = 1, S = 2, ...). */
const LETTER: Record<number, string> = {};
for (const [code, semi] of [...Object.entries(WHITE_KEYS), ...Object.entries(BLACK_KEYS)]) LETTER[semi] = code.slice(3);

function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/**
 * Keyboard drawer for melodic tracks (phone layout of the mockup). Self-contained: mount it anywhere.
 * Also owns desktop musical typing, active only while mounted.
 */
export function KeyboardDrawer(props: { initialLayout: Layout; trackIndex: number; desktop?: boolean }) {
  const { trackIndex, desktop } = props;
  const [layout, setLayout] = useState<Layout>(props.initialLayout);
  const [open, setOpen] = useState(true);
  const [hold, setHold] = useState(false);
  const [lit, setLit] = useState<ReadonlySet<Midi>>(new Set());
  const holdRef = useRef(false);
  const latched = useRef(new Set<Midi>());
  const sources = useRef(new Map<string, Midi>());
  const trackRef = useRef(trackIndex);
  trackRef.current = trackIndex;

  const oct = getOctave(trackIndex);
  const key = project.value.key;
  const scale = project.value.scale;

  const refreshLit = () => setLit(new Set([...latched.current, ...sources.current.values()]));

  const writeStep = (note: Midi) => {
    const ti = trackRef.current;
    const i = selectedStep.value;
    if (i < 0 || ti !== selectedTrack.value || !isMelodic(project.value.tracks[ti]!)) return;
    apply({ type: 'setStep', track: ti, pattern: currentPattern.value, index: i, step: { t: 'note', note, vel: 100 } });
  };

  const press = (src: string, note: Midi) => {
    const ti = trackRef.current;
    if (holdRef.current) {
      if (latched.current.has(note)) {
        latched.current.delete(note);
        noteOff(ti, note);
        refreshLit();
        return;
      }
      latched.current.add(note);
    } else {
      if (sources.current.has(src)) return;
      sources.current.set(src, note);
    }
    void noteOn(ti, note, 100);
    setLastNote(ti, note);
    writeStep(note);
    refreshLit();
  };

  const release = (src: string) => {
    const note = sources.current.get(src);
    if (note === undefined) return;
    sources.current.delete(src);
    if (!latched.current.has(note)) noteOff(trackRef.current, note);
    refreshLit();
  };

  const releaseAll = () => {
    allNotesOff(trackRef.current);
    latched.current.clear();
    sources.current.clear();
    refreshLit();
  };

  const toggleHold = () => {
    const next = !holdRef.current;
    holdRef.current = next;
    setHold(next);
    if (!next) releaseAll();
  };

  // Silence everything when the track changes or the drawer unmounts.
  useEffect(() => () => {
    allNotesOff(trackIndex);
    latched.current.clear();
    sources.current.clear();
  }, [trackIndex]);

  // Desktop musical typing.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target) || captureView.value !== 'off') return;
      const ti = trackRef.current;
      const base = octaveBase(getOctave(ti));
      const semi = WHITE_KEYS[e.code] ?? BLACK_KEYS[e.code];
      if (semi !== undefined) {
        e.preventDefault();
        if (!e.repeat) press(`k:${e.code}`, base + semi);
      } else if (e.code === 'KeyZ') {
        e.preventDefault();
        if (!e.repeat) setOctave(ti, getOctave(ti) - 1);
      } else if (e.code === 'KeyX') {
        e.preventDefault();
        if (!e.repeat) setOctave(ti, getOctave(ti) + 1);
      } else if (e.code === 'Backquote') {
        e.preventDefault();
        if (!e.repeat) toggleHold();
      }
    };
    const up = (e: KeyboardEvent) => release(`k:${e.code}`);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const pointer = (note: Midi) => ({
    onPointerDown: (e: PointerEvent) => { e.preventDefault(); press(`p${e.pointerId}`, note); },
    onPointerUp: (e: PointerEvent) => release(`p${e.pointerId}`),
    onPointerCancel: (e: PointerEvent) => release(`p${e.pointerId}`),
    onPointerLeave: (e: PointerEvent) => release(`p${e.pointerId}`),
    onContextMenu: (e: Event) => e.preventDefault(),
  });

  const base = octaveBase(oct);
  const root = base + key;
  const degrees = SCALES[scale].length;
  const pads = scaleNotes(root, scale, degrees + 1);

  return (
    <div class={`kbd noselect${desktop ? ' dsk-kbd' : ''}`} aria-label="Keyboard">
      <div class="kbd-head">
        <button class="kbd-btn kbd-keys" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d={open ? 'M2 4 L6 8 L10 4' : 'M2 8 L6 4 L10 8'} />
          </svg>Keys
        </button>
        <button class="kbd-pill" aria-pressed={layout === 'scale'} onClick={() => { setLayout('scale'); setOpen(true); }}>Scale</button>
        <button class="kbd-pill" aria-pressed={layout === 'piano'} onClick={() => { setLayout('piano'); setOpen(true); }}>Piano</button>
        <button class="kbd-btn sq" aria-label="Octave down" disabled={oct <= OCT_MIN} onClick={() => setOctave(trackIndex, oct - 1)}>−</button>
        <span class="kbd-oct" aria-label="Octave">C{oct}</span>
        <button class="kbd-btn sq" aria-label="Octave up" disabled={oct >= OCT_MAX} onClick={() => setOctave(trackIndex, oct + 1)}>+</button>
        <button class="kbd-pill hold" aria-pressed={hold} onClick={toggleHold}>Hold</button>
      </div>
      {open && layout === 'scale' && (
        <div class="kbd-pads" style={{ gridTemplateColumns: `repeat(${pads.length}, minmax(0, 1fr))` }}>
          {pads.map((n, i) => (
            <button key={i} class={`kbd-pad${i === 0 || i === pads.length - 1 ? ' root' : ''}`} aria-label={`Key ${midiToNote(n)}`}
              {...(lit.has(n) ? { 'data-lit': '' } : {})} {...pointer(n)}>
              {pcName(n)}
              {desktop && LETTER[n - base] && <small class="kbd-hint">{LETTER[n - base]}</small>}
            </button>
          ))}
        </div>
      )}
      {open && layout === 'piano' && desktop && (
        <div class="kbd-piano dsk-piano">
          <div class="kbd-whites">
            {DESK_WHITE_PCS.map((pc) => {
              const n = base + pc;
              return (
                <button key={pc} class={`kbd-white${inScale(n, key, scale) ? '' : ' out'}`} aria-label={`Key ${midiToNote(n)}`}
                  {...(lit.has(n) ? { 'data-lit': '' } : {})} {...pointer(n)}>
                  <b>{LETTER[pc]}</b><small>{pcName(n)}</small>
                </button>
              );
            })}
          </div>
          {BLACK_PCS.map((pc, i) => {
            const n = base + pc;
            return (
              <button key={pc} class={`kbd-black${inScale(n, key, scale) ? '' : ' out'}`} aria-label={`Key ${midiToNote(n)}`}
                style={{ left: `calc(${(((BLACK_AFTER[i]! + 1) / 8) * 100).toFixed(2)}% - 3.5%)` }}
                {...(lit.has(n) ? { 'data-lit': '' } : {})} {...pointer(n)}>
                <b>{LETTER[pc]}</b><small>{pcName(pc)}</small>
              </button>
            );
          })}
        </div>
      )}
      {open && layout === 'piano' && !desktop && (
        <div class="kbd-piano">
          <div class="kbd-whites">
            {WHITE_PCS.map((pc) => {
              const n = base + pc;
              return (
                <button key={pc} class={`kbd-white${inScale(n, key, scale) ? '' : ' out'}`} aria-label={`Key ${midiToNote(n)}`}
                  {...(lit.has(n) ? { 'data-lit': '' } : {})} {...pointer(n)}>{pcName(pc)}</button>
              );
            })}
          </div>
          {BLACK_PCS.map((pc, i) => {
            const n = base + pc;
            return (
              <button key={pc} class={`kbd-black${inScale(n, key, scale) ? '' : ' out'}`} aria-label={`Key ${midiToNote(n)}`}
                style={{ left: `calc(${(((BLACK_AFTER[i]! + 1) / 7) * 100).toFixed(2)}% - 4.5%)` }}
                {...(lit.has(n) ? { 'data-lit': '' } : {})} {...pointer(n)} />
            );
          })}
        </div>
      )}
    </div>
  );
}
