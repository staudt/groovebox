import type { ComponentChildren } from 'preact';

/** Bottom sheet with a dimmed backdrop; tapping the backdrop closes it. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-back" onPointerDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="sheet" role="dialog" aria-label={props.title}>
        <div class="row">
          <h3 style={{ flexGrow: 1 }}>{props.title}</h3>
          <button class="btn" onClick={props.onClose}>Done</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Stepper(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => props.onChange(Math.min(props.max, Math.max(props.min, v)));
  return (
    <div class="row">
      <span style={{ flexGrow: 1, fontSize: '14px' }}>{props.label}</span>
      <button class="btn square" aria-label={`${props.label} down`} onClick={() => set(props.value - 1)}>−</button>
      <span class="mono" style={{ width: '40px', textAlign: 'center', fontSize: '16px' }}>{props.value}</span>
      <button class="btn square" aria-label={`${props.label} up`} onClick={() => set(props.value + 1)}>+</button>
    </div>
  );
}
