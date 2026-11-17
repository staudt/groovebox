// Page tabs for patterns longer than 16 steps (32 / 64): the step grid shows one 16-step page.
// A cyan dot marks the page the playhead is on (drawn in rAF, no re-renders).
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { audibleStep } from '../engine/host';

/** Visible page of the step grid (0-based). */
export const gridPage = signal(0);

export function PageBar(props: { length: number }) {
  const pages = Math.max(1, Math.ceil(props.length / 16));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Keep the page valid when switching to a shorter pattern.
  if (gridPage.value >= pages) gridPage.value = 0;
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const loop = () => {
      const g = audibleStep();
      const p = g < 0 ? -1 : Math.floor((g % props.length) / 16);
      if (p !== last) {
        if (last >= 0) refs.current[last]?.removeAttribute('data-playing');
        if (p >= 0) refs.current[p]?.setAttribute('data-playing', '');
        last = p;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.length]);
  if (pages < 2) return null;
  return (
    <div class="page-bar" role="tablist" aria-label="Pattern pages">
      {Array.from({ length: pages }, (_, p) => (
        <button
          key={p}
          ref={(el) => { refs.current[p] = el; }}
          role="tab"
          aria-selected={gridPage.value === p}
          onClick={() => (gridPage.value = p)}
        >
          {p * 16 + 1}–{p * 16 + 16}
        </button>
      ))}
    </div>
  );
}
