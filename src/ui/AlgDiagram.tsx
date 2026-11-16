import { useMemo } from 'preact/hooks';
import { ALGORITHMS } from '../engine/fm/algorithms';
import type { FmPatch } from '../store/types';
import { layoutAlgorithm } from './algLayout';

export function AlgDiagram(props: { patch: FmPatch; selected: number; onSelect: (op: number) => void }) {
  const alg = props.patch.algorithm;
  const L = useMemo(() => layoutAlgorithm(alg), [alg]);
  const a = ALGORITHMS[alg - 1]!;
  const box = (op: number) => L.boxes[op - 1]!;

  const lines: string[] = [];
  for (const [m, t] of L.edges) {
    const s = box(m), d = box(t);
    const sx = s.x + s.w / 2, dx = d.x + d.w / 2;
    const y1 = s.y + s.h, y2 = d.y;
    const mid = y2 - 12;
    lines.push(`M${sx} ${y1} V${mid} H${dx} V${y2}`);
  }
  const carriers = a.carriers.map(box).filter((b) => b.row === 0);
  if (carriers.length) {
    const bottom = Math.max(...carriers.map((b) => b.y + b.h));
    const xs = carriers.map((b) => b.x + b.w / 2);
    for (const x of xs) lines.push(`M${x} ${bottom} V${bottom + 6}`);
    if (xs.length > 1) lines.push(`M${Math.min(...xs)} ${bottom + 6} H${Math.max(...xs)}`);
  }

  const [fs, fd] = a.fb;
  const dst = box(fd);
  let fb: string;
  if (fs === fd) {
    const rx = dst.x + dst.w;
    fb = `M${rx} ${dst.y + 14} h8 V${dst.y - 7} H${rx - 12} v7`;
  } else {
    const src = box(fs);
    const X = Math.max(src.x + src.w, dst.x + dst.w) + 7;
    fb = `M${src.x + src.w} ${src.y + src.h / 2} H${X} V${dst.y + dst.h / 2} H${dst.x + dst.w}`;
  }
  const narrow = L.boxes[0]!.w < 60;

  return (
    <div class="alg" style={{ width: `${L.width}px`, height: `${L.height}px` }} data-testid="alg-diagram" data-algorithm={alg}>
      <svg width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true" fill="none" stroke="#3A3E48" stroke-width="2">
        <path d={lines.join(' ')} />
        <path d={fb} stroke="#5A5F6B" stroke-dasharray={fs === fd ? undefined : '4 3'} />
      </svg>
      {L.boxes.map((b) => {
        const on = b.op - 1 === props.selected;
        const isCarrier = a.carriers.includes(b.op);
        return (
          <button
            key={b.op}
            class={`alg-op${on ? ' on' : ''}${narrow ? ' narrow' : ''}`}
            data-op={b.op}
            data-carrier={isCarrier}
            aria-pressed={on}
            aria-label={`OP${b.op}`}
            onClick={() => props.onSelect(b.op - 1)}
            style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
          >
            <span class="alg-op-n mono">OP{b.op}</span>
            <span class="alg-op-r">×{props.patch.ops[b.op - 1]!.ratio.toFixed(2)}</span>
          </button>
        );
      })}
    </div>
  );
}
