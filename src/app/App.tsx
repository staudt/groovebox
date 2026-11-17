import { useEffect } from 'preact/hooks';
import { project, redo, selectedTrack, undo } from '../store/project';
import { isPlayable } from '../store/defaults';
import { togglePlay } from '../engine/host';
import { Transport } from '../ui/Transport';
import { TrackStrip } from '../ui/TrackStrip';
import { BottomNav } from '../ui/BottomNav';
import { Play } from '../screens/Play';
import { Sound } from '../screens/Sound';
import { Perform } from '../screens/Perform';
import { FxSheet } from '../screens/FxSheet';
import { fxSheetOpen, screen } from './nav';
import { pressFx, releaseFx, releaseAllFx } from './fxState';
import { FX_IDS } from '../engine/fx/ids';
import { ResetToast } from '../ui/ProjectSheet';

function nextPlayable(): void {
  const tracks = project.value.tracks;
  for (let k = 1; k <= tracks.length; k++) {
    const i = (selectedTrack.value + k) % tracks.length;
    if (isPlayable(tracks[i]!)) { selectedTrack.value = i; return; }
  }
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey && e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        el?.blur?.();
        void togglePlay();
      } else if (!mod && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        nextPlayable();
      }
    };
    // Space on a focused button would also click it on keyup.
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);
}

/** Desktop: keys 1 to 8 hold the first eight effects while pressed. */
function useFxKeys(): void {
  useEffect(() => {
    const held = new Set<string>();
    const fxOf = (code: string) => {
      const m = /^(?:Digit|Numpad)([1-8])$/.exec(code);
      return m ? FX_IDS[Number(m[1]) - 1] : undefined;
    };
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const fx = fxOf(e.code);
      if (!fx) return;
      e.preventDefault();
      held.add(e.code);
      pressFx(fx);
    };
    const up = (e: KeyboardEvent) => {
      const fx = fxOf(e.code);
      if (fx && held.delete(e.code)) releaseFx(fx);
    };
    const blur = () => { for (const c of held) { const fx = fxOf(c); if (fx) releaseFx(fx); } held.clear(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); releaseAllFx(); };
  }, []);
}

/** Block pinch and double-tap zoom (iOS ignores user-scalable=no). */
function usePreventZoom(): void {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('dblclick', stop);
    return () => { document.removeEventListener('gesturestart', stop); document.removeEventListener('dblclick', stop); };
  }, []);
}

export function App() {
  useShortcuts();
  usePreventZoom();
  useFxKeys();
  return (
    <div class="app noselect">
      <div class="app-top">
        <Transport />
        <TrackStrip />
      </div>
      <main class="app-main">
        {screen.value === 'sound' ? <Sound /> : screen.value === 'perform' ? <Perform /> : <Play />}
      </main>
      <ResetToast />
      <BottomNav />
      {fxSheetOpen.value && <FxSheet />}
    </div>
  );
}
