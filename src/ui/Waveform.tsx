import { useEffect, useRef, useState } from 'preact/hooks';
import { getSample, type Sample } from '../store/samples';
import { computePeaks } from './peaks';

const H = 96;
const MIN_GAP = 0.005;

/**
 * Sample waveform (canvas, DPR aware) with draggable Start and End trim handles.
 * The canvas area scrolls the page vertically; only the handles capture touches.
 * onTrim(patch, merge): merge is false for the first change of a drag (pass to apply({merge})).
 */
export function Waveform(props: { sampleId: string | null; start: number; end: number; onTrim: (patch: { start?: number; end?: number }, merge: boolean) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Sample | null>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef({ which: '' as '' | 'start' | 'end', first: true });
  // Peaks cache, keyed by canvas width and the loaded audio itself (not just the id: the first
  // render happens before the audio arrives, and those empty peaks must not stick).
  const peaksRef = useRef<{ w: number; d: Sample | null; p: Float32Array } | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    if (props.sampleId) void getSample(props.sampleId).then((s) => { if (live) setData(s); });
    return () => { live = false; };
  }, [props.sampleId]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(width * dpr);
    const ph = Math.round(H * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    const g = c.getContext('2d');
    if (!g) return;
    if (!peaksRef.current || peaksRef.current.w !== pw || peaksRef.current.d !== data) {
      peaksRef.current = { w: pw, d: data, p: data ? computePeaks(data.l, data.r, pw) : new Float32Array(pw * 2) };
    }
    const p = peaksRef.current.p;
    g.clearRect(0, 0, pw, ph);
    const mid = ph / 2;
    const a = props.start * pw;
    const b = props.end * pw;
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, mid, pw, 1);
    for (let x = 0; x < pw; x++) {
      const lo = p[x * 2]!;
      const hi = p[x * 2 + 1]!;
      g.fillStyle = x >= a && x <= b ? '#FFB547' : '#4a4d57';
      const y0 = mid - hi * mid * 0.95;
      const y1 = mid - lo * mid * 0.95;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.fillStyle = 'rgba(18,19,22,0.55)';
    g.fillRect(0, 0, a, ph);
    g.fillRect(b, 0, pw - b, ph);
  }, [data, width, props.start, props.end, props.sampleId]);

  const frac = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const set = (which: 'start' | 'end', v: number, merge: boolean) => {
    const val = Math.round(v * 1000) / 1000;
    if (which === 'start') props.onTrim({ start: Math.min(val, props.end - MIN_GAP) }, merge);
    else props.onTrim({ end: Math.max(val, props.start + MIN_GAP) }, merge);
  };
  const handle = (which: 'start' | 'end') => {
    const v = which === 'start' ? props.start : props.end;
    return (
      <div
        class={`wf-handle ${which}`}
        style={{ left: `${v * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label={which === 'start' ? 'Start' : 'End'}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v}
        data-testid={`trim-${which}`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { which, first: true };
        }}
        onPointerMove={(e) => {
          if (drag.current.which !== which) return;
          set(which, frac(e), !drag.current.first);
          drag.current.first = false;
        }}
        onPointerUp={() => { drag.current.which = ''; }}
        onPointerCancel={() => { drag.current.which = ''; }}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.01 : 0;
          if (!d) return;
          e.preventDefault();
          set(which, Math.min(1, Math.max(0, v + d)), false);
        }}
      >
        <i />
      </div>
    );
  };

  return (
    <div class="wf" ref={wrap} data-testid="waveform">
      <canvas ref={canvas} style={{ width: '100%', height: `${H}px` }} data-testid="waveform-canvas" data-loaded={data ? '1' : '0'} />
      {handle('start')}
      {handle('end')}
    </div>
  );
}
