import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';

const MOVE_CANCEL_PX = 8;

/**
 * Button with tap and long-press. A long press fires `onLong` once (after `ms`) and swallows the
 * click that follows the release. Moving more than a few px cancels it so scrolling still works.
 */
export function PressButton(props: { onTap: () => void; onLong: () => void; ms?: number; children?: ComponentChildren } & Omit<JSX.IntrinsicElements['button'], 'onClick' | 'children' | 'ref'>) {
  const { onTap, onLong, ms, children, ...rest } = props;
  const st = useRef({ timer: 0, x: 0, y: 0, fired: false });
  const clear = () => { clearTimeout(st.current.timer); st.current.timer = 0; };
  return (
    <button
      {...rest}
      onPointerDown={(e) => {
        clear();
        st.current.fired = false;
        st.current.x = e.clientX;
        st.current.y = e.clientY;
        st.current.timer = window.setTimeout(() => {
          st.current.fired = true;
          if (navigator.vibrate) navigator.vibrate(10);
          onLong();
        }, ms ?? 450);
      }}
      onPointerMove={(e) => { if (st.current.timer && Math.hypot(e.clientX - st.current.x, e.clientY - st.current.y) > MOVE_CANCEL_PX) clear(); }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (st.current.fired) { st.current.fired = false; return; }
        onTap();
      }}
    >
      {children}
    </button>
  );
}
