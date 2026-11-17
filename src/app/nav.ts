import { signal } from '@preact/signals';

export type ScreenId = 'play' | 'sound' | 'perform' | 'song';
export const screen = signal<ScreenId>('play');
/** The FX sheet floats over whatever screen is current. */
export const fxSheetOpen = signal(false);

/** The Capture and Place screens float over the whole shell (phone: full screen, desktop: a card). */
export type CaptureView = 'off' | 'capture' | 'place';
export const captureView = signal<CaptureView>('off');
