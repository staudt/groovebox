import { useRef } from 'preact/hooks';
import type { FmOperator } from '../store/types';

export type EnvChange = Partial<Pick<FmOperator, 'a' | 'd' | 's' | 'r'>>;

const W = 334, H = 70, PAD = 8;
const SEG = (W - PAD * 2) / 4;
const Y_TOP = PAD, Y_BOT = H - 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));

/** The mockup's point math: [start, ATK peak, DEC/sustain start, sustain end / REL start, end]. */
export function envPoints(o: Pick<FmOperator, 'a' | 'd' | 's' | 'r'>): [number, number][] {
  const x1 = PAD + o.a * SEG * 1.4;
  const x2 = x1 + 20 + o.d * SEG * 1.2;
  const x3 = W - PAD - (20 + o.r * SEG * 1.2);
  const yS = Y_TOP + (1 - o.s) * (Y_BOT - Y_TOP);
  return [[PAD, Y_BOT], [x1, Y_TOP], [x2, yS], [x3, yS], [W - PAD, Y_BOT]];
}

const NAMES = ['Attack', 'Decay', 'Sustain', 'Release'] as const;

/**
 * Draggable ATK / DEC / SUS / REL points. ATK: x -> a. DEC: x -> d (and y -> s). SUS: y -> s.
 * REL (end point, fixed on screen): dragging left lengthens r. onChange(changes, merge) as in DragValue.
 */
export function EnvelopeEditor(props: { op: FmOperator; onChange: (c: EnvChange, merge: boolean) => void }) {
  const g = useRef({ which: -1, first: true, x0: 0, r0: 0 });
  const pts = envPoints(props.op);
  const line = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');
  const fill = `${line} L${W - PAD} ${H} L${PAD} ${H} Z`;

  const local = (e: PointerEvent): [number, number] => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  };
  const yToS = (y: number) => clamp01(1 - (y - Y_TOP) / (Y_BOT - Y_TOP));
  const move = (e: PointerEvent) => {
    const s = g.current;
    if (s.which < 0) return;
    const [x, y] = local(e);
    const o = props.op;
    let c: EnvChange;
    if (s.which === 0) c = { a: clamp01((x - PAD) / (SEG * 1.4)) };
    else if (s.which === 1) c = { d: clamp01((x - (PAD + o.a * SEG * 1.4) - 20) / (SEG * 1.2)), s: yToS(y) };
    else if (s.which === 2) c = { s: yToS(y) };
    else c = { r: clamp01(s.r0 - (x - s.x0) / (SEG * 1.2)) };
    props.onChange(c, !s.first);
    s.first = false;
  };
  const key = (i: number, e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.02 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.02 : 0;
    if (!d) return;
    e.preventDefault();
    const o = props.op;
    const k = (['a', 'd', 's', 'r'] as const)[i]!;
    props.onChange({ [k]: clamp01(o[k] + d) }, false);
  };

  return (
    <svg class="env" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Envelope: drag the points to shape attack, decay, sustain and release" style={{ touchAction: 'pan-y' }}>
      <path d={`M0 ${H - 0.5} H${W}`} stroke="#2A2D34" />
      <path d={fill} fill="rgba(255,181,71,0.12)" />
      <path d={line} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" />
      {pts.slice(1).map((p, i) => (
        <g
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={`${NAMES[i]} handle`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={props.op[(['a', 'd', 's', 'r'] as const)[i]!]}
          data-testid={`env-handle-${i}`}
          style={{ cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(e) => {
            (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
            g.current = { which: i, first: true, x0: local(e)[0], r0: props.op.r };
          }}
          onPointerMove={move}
          onPointerUp={() => { g.current.which = -1; }}
          onPointerCancel={() => { g.current.which = -1; }}
          onKeyDown={(e) => key(i, e)}
        >
          <circle cx={p[0]} cy={p[1]} r={22} fill="transparent" />
          <circle cx={p[0]} cy={p[1]} r={7} fill="#121316" stroke="var(--accent)" stroke-width="2.5" />
        </g>
      ))}
    </svg>
  );
}
