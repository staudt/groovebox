import { signal } from '@preact/signals';

/** Song screen view: the section chain and lanes, or the mixer. */
export const songView = signal<'arrange' | 'mix'>('arrange');
/** Section being edited on the Song screen (index; clamp before use). */
export const selectedSection = signal(0);
