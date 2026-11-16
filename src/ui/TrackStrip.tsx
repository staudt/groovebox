import { project, selectedTrack, soloSelected } from '../store/project';
import { isMelodic, isPlayable } from '../store/defaults';
import { audition, previewNotes } from '../engine/host';
import { defaultNote } from './keysState';

const KIND_LABEL = { drum: 'drum', fm: 'FM', sampler: 'sample' } as const;

export function TrackStrip() {
  const tracks = project.value.tracks;
  const sel = selectedTrack.value;
  const solo = soloSelected.value;
  return (
    <div class="strip">
      {tracks.map((t, i) => {
        const ok = isPlayable(t);
        const on = i === sel;
        const silenced = solo && !on;
        return (
          <button
            key={t.id}
            aria-pressed={on}
            aria-disabled={!ok}
            title={ok ? undefined : 'Coming in a later phase'}
            onClick={() => {
              if (!ok) return;
              if (on) { if (isMelodic(t)) void previewNotes(i, [defaultNote(i)], 100); else void audition(i, 100); }
              else selectedTrack.value = i;
            }}
            style={{
              flexShrink: 0, minWidth: '56px', height: '48px', padding: '0 9px', borderRadius: '12px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: '1px',
              opacity: !ok ? 0.4 : silenced ? 0.45 : 1,
              ...(on ? { background: 'var(--accent)', color: 'var(--ground)', border: '1px solid var(--accent)' } : { background: 'var(--raised)', color: 'var(--text)', border: '1px solid var(--border)' }),
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700 }}>{t.name}</span>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', opacity: 0.8 }}>{!ok ? 'soon' : silenced ? 'muted' : KIND_LABEL[t.kind]}</span>
          </button>
        );
      })}
    </div>
  );
}
