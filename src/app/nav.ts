import { signal } from '@preact/signals';

export type ScreenId = 'play' | 'sound';
export const screen = signal<ScreenId>('play');
