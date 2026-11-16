import type { ComponentChildren } from 'preact';

const base = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '12px', background: 'none', border: 'none' } as const;

function Item(props: { label: string; active?: boolean; children: ComponentChildren }) {
  return (
    <button disabled={!props.active} aria-current={props.active ? 'page' : undefined} style={{ ...base, color: props.active ? 'var(--accent)' : 'var(--muted)', opacity: props.active ? 1 : 0.4 }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">{props.children}</svg>
      {props.label}
    </button>
  );
}

export function BottomNav() {
  return (
    <nav style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', height: '68px', flex: '0 0 auto', borderTop: '1px solid var(--bar-border)', background: 'var(--bar)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <Item label="Play" active><rect x="2" y="2" width="7" height="7" rx="1.5" /><rect x="11" y="2" width="7" height="7" rx="1.5" /><rect x="2" y="11" width="7" height="7" rx="1.5" /><rect x="11" y="11" width="7" height="7" rx="1.5" /></Item>
      <Item label="Sound"><path d="M1 10 C4 2 6 2 8 10 S12 18 14 10 S17 4 19 10" /></Item>
      <button disabled aria-label="FX" style={{ ...base, opacity: 0.4 }}>
        <span style={{ width: '54px', height: '42px', borderRadius: '14px', background: 'var(--fx)', color: 'var(--ground)', fontWeight: 700, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>FX</span>
      </button>
      <Item label="Perform"><rect x="2" y="2" width="16" height="16" rx="2" /><circle cx="12" cy="8" r="2.5" /></Item>
      <Item label="Song"><path d="M2 5 h6 M10 5 h8 M2 10 h10 M14 10 h4 M2 15 h4 M8 15 h10" /></Item>
    </nav>
  );
}
