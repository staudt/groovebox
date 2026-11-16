import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { FxId } from '../engine/fx/ids';
import { heldFx, pressFx, releaseFx } from '../app/fxState';

/** Hold-to-play effect button. Per-pointer, so several fingers can hold several effects. */
export function FxHoldButton(props: { fx: FxId; class: string; label: string; children: ComponentChildren }) {
  const { fx } = props;
  const pointers = useRef(new Set<number>());
  const lit = heldFx.value.includes(fx);

  const end = (e: PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) releaseFx(fx);
  };

  // Closing the sheet while a finger is down must not leave the effect stuck on.
  useEffect(() => () => { if (pointers.current.size > 0) { pointers.current.clear(); releaseFx(fx); } }, [fx]);

  return (
    <button
      class={props.class}
      aria-label={props.label}
      aria-pressed={lit}
      data-fx={fx}
      onPointerDown={(e) => {
        e.preventDefault();
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
        pointers.current.add(e.pointerId);
        pressFx(fx);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.children}
    </button>
  );
}
