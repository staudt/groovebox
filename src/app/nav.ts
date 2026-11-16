import { signal } from '@preact/signals';

export type ScreenId = 'play' | 'sound' | 'perform';
export const screen = signal<ScreenId>('play');
/** The FX sheet floats over whatever screen is current. */
export const fxSheetOpen = signal(false);
