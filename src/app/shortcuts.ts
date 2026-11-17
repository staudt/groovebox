import { useEffect } from 'preact/hooks';
import { project, redo, selectedTrack, undo } from '../store/project';
import { isPlayable } from '../store/defaults';
import { togglePlay } from '../engine/host';
import { captureView } from './nav';
import { openCapture } from '../capture/session';
import { pressFx, releaseFx, releaseAllFx } from './fxState';
import { FX_IDS } from '../engine/fx/ids';

// Global keyboard shortcuts shared by the phone and desktop shells (mounted once, in App).

function stepTrack(dir: 1 | -1): void {
  const tracks = project.value.tracks;
  for (let k = 1; k <= tracks.length; k++) {
    const i = (((selectedTrack.value + dir * k) % tracks.length) + tracks.length) % tracks.length;
    if (isPlayable(tracks[i]!)) { selectedTrack.value = i; return; }
  }
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (captureView.value !== 'off') return; // Capture and Place own the keyboard (Escape, R)
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
      } else if (!mod && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        stepTrack(e.shiftKey ? -1 : 1);
      }
      else if (!mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r' && captureView.value === 'off') {
        e.preventDefault();
        openCapture();
      }
      // "/" (ask the assistant) arrives with Phase 6.
    };
    // Space on a focused button would also click it on keyup.
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);
}

/** Desktop: keys 1 to 8 hold the first eight effects while pressed. */
export function useFxKeys(): void {
  useEffect(() => {
    const held = new Set<string>();
    const fxOf = (code: string) => {
      const m = /^(?:Digit|Numpad)([1-8])$/.exec(code);
      return m ? FX_IDS[Number(m[1]) - 1] : undefined;
    };
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || captureView.value !== 'off') return;
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
export function usePreventZoom(): void {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('dblclick', stop);
    return () => { document.removeEventListener('gesturestart', stop); document.removeEventListener('dblclick', stop); };
  }, []);
}

