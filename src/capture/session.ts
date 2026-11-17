// Shared state between the Capture and Place screens.
import { signal } from '@preact/signals';
import { captureView } from '../app/nav';
import { playing } from '../store/project';
import type { CaptureSource, PitchFrame, Transcription } from './types';

export type CaptureResult = {
  transcription: Transcription;
  /** Full-rate mono recording (for "Keep as clip"). */
  audio: { l: Float32Array; rate: number };
  bars: number;
  bpm: number;
  /** Live tracker frames, times in seconds from bar 1 (latency removed); for the raw-trace overlay. */
  frames: PitchFrame[];
};

export const captureResult = signal<CaptureResult | null>(null);

// Capture settings survive Redo.
export const captureSource = signal<CaptureSource>('voice');
export const COUNT_IN_OPTIONS = [1, 2, 0] as const;
export const LENGTH_OPTIONS = [1, 2, 4, 8] as const;
export const countInBars = signal<number>(1);
export const captureBars = signal<number>(2);

/** Opens the Capture screen (stops the transport first: the loop would bleed into the mic). */
export function openCapture(): void {
  playing.value = false;
  captureView.value = 'capture';
}

// Test builds only: lets Playwright jump straight to the Place screen with known notes.
if (import.meta.env.MODE === 'test' && typeof window !== 'undefined') {
  (window as unknown as { __groovebox: unknown }).__groovebox = {
    place(notes: { start: number; end: number; midi: number }[], bars: number, bpm = 92) {
      captureResult.value = {
        transcription: { source: 'voice', model: true, notes: notes.map((n) => ({ ...n, velocity: 100 })) },
        audio: { l: new Float32Array(4800), rate: 48000 },
        bars,
        bpm,
        frames: [],
      };
      captureView.value = 'place';
    },
  };
}
