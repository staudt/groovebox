// The assistant (Claude Haiku via the local proxy) shows only when a proxy with an API key answers.
// On GitHub Pages there is no proxy, so every assistant control stays hidden.
import { computed } from '@preact/signals';
import { assistStatus } from '../assist/client';

export const assistantOn = computed(() => assistStatus.value === 'on');
