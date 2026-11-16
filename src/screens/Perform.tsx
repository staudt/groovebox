import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { apply, project, selectedTrack, track } from '../store/project';
import { isMelodic } from '../store/defaults';
import type { Midi, PitchClass, ScaleName } from '../store/types';
import { chordNotes, diatonicChords, pcName, scaleNotes } from '../harmony/theory';
import { audition, noteOff, noteOn } from '../engine/host';
import type { FxId } from '../engine/fx/ids';
import { getOctave, octaveBase } from '../ui/keysState';
import { FxHoldButton } from '../ui/FxHoldButton';
import { Sheet } from '../ui/Sheet';
import '../ui/perform.css';

const chordsMode = signal(true);
const tiltOn = signal(false);

const QUICK_FX: readonly { fx: FxId; label: string }[] = [
  { fx: 'stutter16', label: 'Stutter' },
  { fx: 'tapeStop', label: 'Tape stop' },
  { fx: 'lowSweep', label: 'Sweep' },
  { fx: 'reverbThrow', label: 'Throw' },
];
const SCALE_LABELS: Record<ScaleName, string> = { minor: 'minor', major: 'major', dorian: 'dorian', mixolydian: 'mixolydian', pentatonic: 'pentatonic' };
const SCALE_ORDER: ScaleName[] = ['minor', 'major', 'dorian', 'mixolydian', 'pentatonic'];
const DRUM_VELS = [127, 100, 70, 40] as const;

type Pad = { label: string; sub?: string; chord?: boolean; notes: Midi[]; drum?: { track: number; vel: number } };

function melodicPads(key: PitchClass, scale: ScaleName, oct: number): Pad[] {
  const root = octaveBase(oct) + key;
  const arrows = (n: Midi) => '↑'.repeat(Math.floor((n - root) / 12));
  const noteLabel = (n: Midi) => pcName(n) + arrows(n);
  if (!chordsMode.value) return scaleNotes(root, scale, 16).map((n) => ({ label: noteLabel(n), notes: [n] }));
  const triads = diatonicChords(key, scale);
  const sevenths = diatonicChords(key, scale, true);
  const chords = [...triads, sevenths[0]!].map((c) => ({ label: c.symbol, chord: true, notes: chordNotes(c.symbol, octaveBase(oct)) }));
  return [...chords, ...scaleNotes(root, scale, 8).map((n) => ({ label: noteLabel(n), notes: [n] }))];
}

function drumPads(): Pad[] {
  // Finger drumming: drum synth tracks and one-shot sampler tracks (e.g. PERC), in track order.
  const cols = project.value.tracks.map((t, i) => ({ t, i })).filter((c) => c.t.kind === 'drum' || (c.t.kind === 'sampler' && !isMelodic(c.t))).slice(0, 4);
  const pads: Pad[] = [];
  for (const vel of DRUM_VELS) {
    for (let c = 0; c < 4; c++) {
      const col = cols[c];
      pads.push(col ? { label: col.t.name, sub: String(vel), notes: [], drum: { track: col.i, vel } } : { label: '', notes: [] });
    }
  }
  return pads;
}

function PadGrid() {
  const melodic = isMelodic(track.value);
  const ti = selectedTrack.value;
  const pads = melodic ? melodicPads(project.value.key, project.value.scale, getOctave(ti)) : drumPads();
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const down = useRef(new Map<number, { index: number; track: number; notes: Midi[] }>());

  const refresh = () => setLit(new Set([...down.current.values()].map((d) => d.index)));
  const release = (id: number) => {
    const d = down.current.get(id);
    if (!d) return;
    down.current.delete(id);
    for (const n of d.notes) noteOff(d.track, n);
    refresh();
  };
  // Silence held pads when the track changes or the screen goes away.
  useEffect(() => () => {
    for (const d of down.current.values()) for (const n of d.notes) noteOff(d.track, n);
    down.current.clear();
  }, [ti]);

  return (
    <div class="perf-pads" aria-label="Pads">
      {pads.map((p, i) => (
        <button
          key={i}
          class={`perf-pad${p.chord ? ' chord' : ''}${p.drum ? ' drum' : ''}`}
          disabled={p.label === ''}
          {...(lit.has(i) ? { 'data-lit': '' } : {})}
          onPointerDown={(e) => {
            e.preventDefault();
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
            if (p.drum) { void audition(p.drum.track, p.drum.vel); down.current.set(e.pointerId, { index: i, track: p.drum.track, notes: [] }); refresh(); return; }
            down.current.set(e.pointerId, { index: i, track: ti, notes: p.notes });
            for (const n of p.notes) void noteOn(ti, n, 100);
            refresh();
          }}
          onPointerUp={(e) => release(e.pointerId)}
          onPointerCancel={(e) => release(e.pointerId)}
          onLostPointerCapture={(e) => release(e.pointerId)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span class="perf-pad-label">{p.label}</span>
          {p.sub && <span class="perf-pad-sub">{p.sub}</span>}
        </button>
      ))}
    </div>
  );
}

const DRAG_FIRST = { merge: false } as const;

/** X = Tone macro, Y = Space macro. One undo step per drag. */
function XyPad() {
  const m = track.value.macros;
  const x = m[0].value;
  const y = m[3].value;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; first: boolean } | null>(null);
  const tilting = useRef(false);
  tilting.current = tiltOn.value;

  const set = (tone: number, space: number, first: boolean) => {
    const t = selectedTrack.value;
    apply([{ type: 'setMacro', track: t, macro: 0, value: tone }, { type: 'setMacro', track: t, macro: 3, value: space }], first ? DRAG_FIRST : { merge: true });
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const cl = (v: number) => Math.min(1, Math.max(0, v));
    set(cl((e.clientX - r.left) / r.width), cl(1 - (e.clientY - r.top) / r.height), d.first);
    d.first = false;
  };
  return (
    <div
      ref={ref}
      class="perf-xy"
      role="group"
      aria-label="XY pad"
      data-tone={Math.round(x * 100)}
      data-space={Math.round(y * 100)}
      onPointerDown={(e) => {
        if (drag.current) return;
        e.preventDefault();
        try { ref.current?.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
        drag.current = { id: e.pointerId, first: true };
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}
      onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}
    >
      <svg class="perf-xy-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M25 0 V100 M50 0 V100 M75 0 V100 M0 25 H100 M0 50 H100 M0 75 H100" vector-effect="non-scaling-stroke" />
        <path class="cross" d={`M0 ${(1 - y) * 100} H100 M${x * 100} 0 V100`} vector-effect="non-scaling-stroke" />
      </svg>
      <span class="perf-dot" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
      <span class="perf-xy-label" style={{ left: '12px', bottom: '10px' }}>X  FM AMOUNT</span>
      <span class="perf-xy-label" style={{ left: '12px', top: '10px' }}>Y  SPACE</span>
      <span class="perf-xy-label" style={{ right: '12px', top: '10px' }}>{tiltOn.value ? 'tilt on: phone = Y' : 'drag to shape'}</span>
    </div>
  );
}

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Tilt (DeviceOrientation beta) drives the Space macro while on. */
function useTilt(): void {
  const on = tiltOn.value;
  useEffect(() => {
    if (!on) return;
    let first = true;
    let last = -1;
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta === null) return;
      const v = Math.min(1, Math.max(0, (e.beta - 15) / 60));
      if (Math.abs(v - last) < 0.01) return;
      last = v;
      apply({ type: 'setMacro', track: selectedTrack.value, macro: 3, value: v }, { merge: !first });
      first = false;
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [on]);
}

const tiltSupported = (): boolean =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches;

async function toggleTilt(): Promise<void> {
  if (tiltOn.value) { tiltOn.value = false; return; }
  const ctor = window.DeviceOrientationEvent as unknown as OrientationCtor;
  if (typeof ctor.requestPermission === 'function') {
    try {
      if ((await ctor.requestPermission()) !== 'granted') return;
    } catch { return; }
  }
  tiltOn.value = true;
}

function KeySheet(props: { onClose: () => void }) {
  const p = project.value;
  return (
    <Sheet title="Key and scale" onClose={props.onClose}>
      <div class="perf-keys" role="group" aria-label="Key">
        {Array.from({ length: 12 }, (_, pc) => (
          <button key={pc} class="perf-opt" aria-pressed={p.key === pc} onClick={() => apply({ type: 'setKey', key: pc as PitchClass })}>{pcName(pc)}</button>
        ))}
      </div>
      <div class="perf-scales" role="group" aria-label="Scale">
        {SCALE_ORDER.map((s) => (
          <button key={s} class="perf-opt" aria-pressed={p.scale === s} onClick={() => apply({ type: 'setScale', scale: s })}>{SCALE_LABELS[s]}</button>
        ))}
      </div>
    </Sheet>
  );
}

export function Perform() {
  const [keyOpen, setKeyOpen] = useState(false);
  const melodic = isMelodic(track.value);
  useTilt();
  // Tilt only makes sense on this screen.
  useEffect(() => () => { tiltOn.value = false; }, []);
  const p = project.value;
  return (
    <>
      <div class="perf-row">
        <button class="perf-key" onClick={() => setKeyOpen(true)}>Key: {pcName(p.key)} {p.scale}</button>
        {melodic && <button class="perf-toggle" aria-pressed={chordsMode.value} onClick={() => { chordsMode.value = !chordsMode.value; }}>Chords</button>}
        <span style={{ flexGrow: 1 }} />
        {tiltSupported() && <button class="perf-toggle" aria-pressed={tiltOn.value} onClick={() => void toggleTilt()}>Tilt</button>}
      </div>
      <XyPad />
      <div class="perf-fx">
        {QUICK_FX.map((q) => (
          <FxHoldButton key={q.fx} fx={q.fx} class="perf-fxbtn" label={q.label}>
            <span class="perf-fx-name">{q.label}</span>
            <span class="perf-fx-sub">hold</span>
          </FxHoldButton>
        ))}
      </div>
      <PadGrid />
      {keyOpen && <KeySheet onClose={() => setKeyOpen(false)} />}
    </>
  );
}
