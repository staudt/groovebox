import { useEffect, useRef } from 'preact/hooks';
import { apply, currentPattern, project, selectedTrack, soloSelected, track } from '../store/project';
import { isMelodic } from '../store/defaults';
import type { Step } from '../store/types';
import { addNote, removeAt } from '../store/stepEdit';
import { audibleStep, audition, previewNotes } from '../engine/host';
import { defaultNote, getOctave, setLastNote } from '../ui/keysState';
import { pcName } from '../harmony/theory';
import { Transport } from '../ui/Transport';
import { Macros } from '../ui/Macros';
import { KeyboardDrawer } from '../ui/KeyboardDrawer';
import { ResetToast } from '../ui/ProjectSheet';
import { Play } from '../screens/Play';
import { Sound } from '../screens/Sound';
import { Perform } from '../screens/Perform';
import { Song } from '../screens/Song';
import { SectionChain } from '../ui/SectionChain';
import { FxSheet } from '../screens/FxSheet';
import { openCapture } from '../capture/session';
import { fxSheetOpen, screen, type ScreenId } from './nav';
import '../ui/desktop.css';

// Desktop shell (viewport >= 1024 px): all tracks in one step matrix, the selected track's sound
// beside it, the keyboard labeled with computer keys below. Musical typing is owned by the single
// KeyboardDrawer mounted here; global shortcuts live in shortcuts.ts.

const KIND_LABEL = { drum: 'drum', fm: 'FM', sampler: 'sample' } as const;
const CELLS = 16;

function NavButton(props: { label: string; target?: ScreenId }) {
  const enabled = props.target !== undefined;
  return (
    <button class="dsk-nav-btn" disabled={!enabled} aria-current={props.target === screen.value ? 'page' : undefined}
      onClick={() => { if (props.target) screen.value = props.target; }}>{props.label}</button>
  );
}

function TopBar() {
  return (
    <header class="dsk-top">
      <div class="dsk-transport"><Transport /></div>
      <nav class="dsk-nav">
        <NavButton label="Play" target="play" />
        <NavButton label="Sound" target="sound" />
        <NavButton label="Perform" target="perform" />
        <NavButton label="Song" target="song" />
        <button class="dsk-fx" aria-label="FX" aria-pressed={fxSheetOpen.value} onClick={() => { fxSheetOpen.value = !fxSheetOpen.value; }}>FX</button>
      </nav>
    </header>
  );
}

/** Live chain of the project's sections: playing progress, tap to select (editing is on the Song screen). */
function DesktopChain() {
  if (project.value.sections.length === 0) {
    return (
      <div class="dsk-chain" aria-label="Section chain">
        <div class="dsk-sec" data-active=""><b>Loop · pattern {currentPattern.value}</b></div>
      </div>
    );
  }
  return <SectionChain variant="desktop" />;
}

function Matrix() {
  const tracks = project.value.tracks;
  const pid = currentPattern.value;
  const sel = selectedTrack.value;
  const solo = soloSelected.value;
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const lens = useRef<number[]>([]);
  lens.current = tracks.map((t) => t.patterns[pid].length);

  // Playhead: one rAF loop that moves a data attribute. No signals, no re-renders.
  useEffect(() => {
    let raf = 0;
    const last = new Array<number>(tracks.length).fill(-1);
    const loop = () => {
      const g = audibleStep();
      for (let r = 0; r < last.length; r++) {
        const len = lens.current[r] ?? CELLS;
        const idx = g < 0 ? -1 : g % len;
        const at = idx < CELLS ? idx : -1;
        if (at !== last[r]) {
          if (last[r]! >= 0) cells.current[r * CELLS + last[r]!]?.removeAttribute('data-ph');
          if (at >= 0) cells.current[r * CELLS + at]?.setAttribute('data-ph', '');
          last[r] = at;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tracks.length]);

  const toggle = (r: number, i: number) => {
    const t = project.value.tracks[r]!;
    const pat = t.patterns[currentPattern.value];
    const cur = pat.steps[i]!;
    if (selectedTrack.value !== r) selectedTrack.value = r;
    if (!isMelodic(t)) {
      const step: Step = cur.t === 'hit' ? { t: 'rest' } : { t: 'hit', vel: 100 };
      apply({ type: 'setStep', track: r, pattern: currentPattern.value, index: i, step });
      if (step.t === 'hit') void audition(r, step.vel);
    } else if (cur.t === 'rest') {
      const note = defaultNote(r);
      apply({ type: 'setSteps', track: r, pattern: currentPattern.value, steps: addNote(pat.steps, i, note) });
      setLastNote(r, note);
      void previewNotes(r, [note], 100);
    } else {
      apply({ type: 'setSteps', track: r, pattern: currentPattern.value, steps: removeAt(pat.steps, i) });
    }
  };

  // The container carries .strip so it answers to the same track-button queries as the phone strip.
  return (
    <div class="strip dsk-matrix" aria-label="Step matrix">
      {tracks.map((t, r) => {
        const on = r === sel;
        const pat = t.patterns[pid];
        return (
          <div key={t.id} class="dsk-row" data-sel={on ? '' : undefined} data-muted={solo && !on ? '' : undefined}>
            <button class="dsk-name" aria-pressed={on} aria-disabled="false"
              onClick={() => {
                if (!on) selectedTrack.value = r;
                else if (isMelodic(t)) void previewNotes(r, [defaultNote(r)], 100);
                else void audition(r, 100);
              }}>
              <span>{t.name}</span><small>{solo && !on ? 'muted' : KIND_LABEL[t.kind]}</small>
            </button>
            <div class="dsk-cells">
              {Array.from({ length: CELLS }, (_, i) => {
                const s = pat.steps[i];
                const start = s?.t === 'hit' || s?.t === 'note' || s?.t === 'chord';
                return (
                  <button key={i} class="dsk-cell" ref={(el) => { cells.current[r * CELLS + i] = el; }}
                    aria-label={`Row ${r + 1} step ${i + 1}`} aria-pressed={start}
                    data-on={start ? '' : undefined} data-hold={s?.t === 'hold' ? '' : undefined}
                    data-beat={i % 4 === 0 ? '' : undefined} onClick={() => toggle(r, i)} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KeysPanel() {
  const t = track.value;
  if (screen.value === 'perform') return null; // the pads replace the keyboard there
  if (!isMelodic(t)) {
    return <div class="dsk-card dsk-keys-idle">Pick a melodic track (BASS, KEYS, PAD) to play the on-screen keys.</div>;
  }
  const p = project.value;
  return (
    <div class="dsk-card dsk-keys">
      <div class="dsk-keys-title">
        <b>KEYS · {pcName(p.key)} {p.scale} · from C{getOctave(selectedTrack.value)}</b>
        <span><kbd>Z</kbd> / <kbd>X</kbd> octave</span>
        <span><kbd>`</kbd> hold note</span>
      </div>
      <KeyboardDrawer initialLayout="piano" trackIndex={selectedTrack.value} desktop />
    </div>
  );
}

function CapturePanel() {
  return (
    <div class="dsk-card dsk-capture">
      <div class="dsk-card-title"><b>Capture a melody</b></div>
      <div class="dsk-chips">
        {['Voice', 'Whistle', 'Guitar', 'Chords'].map((c) => <span key={c}>{c}</span>)}
      </div>
      <button class="btn primary" onClick={openCapture}>Capture <kbd>R</kbd></button>
    </div>
  );
}

const SHORTCUTS: readonly [string, string][] = [['Space', 'play'], ['Tab', 'next track'], ['Shift+Tab', 'previous'], ['1–8', 'hold FX'], ['R', 'capture']];

export function DesktopApp() {
  const screenId = screen.value;
  return (
    <div class="dsk noselect">
      <TopBar />
      <div class="dsk-body">
        <main class="dsk-main">
          <DesktopChain />
          {screenId !== 'song' && <Matrix />}
          <section class="dsk-detail" aria-label={screenId === 'perform' ? 'Perform' : screenId === 'song' ? 'Song' : 'Editor'}>
            {screenId === 'perform' ? <Perform /> : screenId === 'song' ? <Song desktop /> : <Play desktop />}
          </section>
          {screenId !== 'song' && <KeysPanel />}
        </main>
        <aside class="dsk-aside">
          <div class="dsk-sound" aria-label="Sound panel"><Sound embedded /></div>
          <CapturePanel />
          <div class="dsk-hints">
            {SHORTCUTS.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}
          </div>
        </aside>
      </div>
      <ResetToast />
      {fxSheetOpen.value && <FxSheet />}
    </div>
  );
}
