import { track } from '../store/project';

/** Assistant entry point. Disabled until Phase 6. */
export function AskBar() {
  return (
    <button disabled title="Assistant arrives in a later phase" style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '52px', padding: '0 14px', borderRadius: '14px', border: '1px solid var(--assist-border)', background: 'var(--assist-bg)', color: 'var(--assist-text)', textAlign: 'left', marginTop: '4px', opacity: 0.5, flexShrink: 0 }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#5CC8FF" stroke-width="1.6" stroke-linecap="round"><path d="M9 2 L10.6 7.4 L16 9 L10.6 10.6 L9 16 L7.4 10.6 L2 9 L7.4 7.4 Z" /></svg>
      <span style={{ flexGrow: 1, fontSize: '14px' }}>Ask: make this {track.value.name.toLowerCase()} part busier…</span>
    </button>
  );
}
