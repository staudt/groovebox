import { useEffect, useRef, useState } from 'preact/hooks';
import { askAssistant } from '../assist/client';
import { soundTakes } from '../assist/apply';
import { apply, track } from '../store/project';
import type { FmPatch } from '../store/types';
import { previewNotes } from '../engine/host';
import { assistantOn } from '../app/features';
import './assist.css';

type Take = { id: 'A' | 'B' | 'C'; description: string; patch: FmPatch };
const PREVIEW_NOTE = 48;

/** "Describe a sound" (FM tracks): three takes as cyan chips; tapping one applies it (one undo step each). */
export function DescribeSound(props: { track: number; patch: FmPatch }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [takes, setTakes] = useState<Take[]>([]);
  const [original, setOriginal] = useState<FmPatch | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  // A different track starts a fresh session.
  useEffect(() => { ctl.current?.abort(); setBusy(false); setTakes([]); setOriginal(null); setActive(null); setNone(false); }, [props.track]);
  if (!assistantOn.value) return null;

  const make = async () => {
    const q = text.trim();
    if (!q || busy) return;
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    setNone(false);
    const before = structuredClone(props.patch);
    const r = await askAssistant({ feature: 'sound', text: q.slice(0, 400), trackKind: 'fm', currentPatch: before }, c.signal);
    if (c.signal.aborted) return;
    ctl.current = null;
    setBusy(false);
    const patches = r ? soundTakes(r) : [];
    if (patches.length === 0) { setNone(true); return; }
    setTakes(patches.map((patch, i) => ({ id: (['A', 'B', 'C'] as const)[i]!, description: r!.takes[i]!.description.slice(0, 120), patch })));
    setOriginal((o) => o ?? before); // Original = the patch from before the first Make
    setActive(null);
  };
  const pick = (id: string, patch: FmPatch) => {
    apply({ type: 'setFmPatch', track: props.track, patch: structuredClone(patch) });
    setActive(id);
    void previewNotes(props.track, [PREVIEW_NOTE], 100, 450);
  };

  return (
    <div class="sn-assist live">
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#5CC8FF" stroke-width="1.6" stroke-linecap="round"><path d="M9 2 L10.6 7.4 L16 9 L10.6 10.6 L9 16 L7.4 10.6 L2 9 L7.4 7.4 Z" /></svg>
      <input aria-label="Describe a sound" placeholder="Describe a sound: glassy bell, slow attack…" value={text} maxLength={400} disabled={busy}
        onInput={(e) => { setText(e.currentTarget.value); setNone(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void make(); else if (e.key === 'Escape') e.currentTarget.blur(); }} />
      {busy
        ? <button class="as-cancel" aria-label="Cancel" onClick={() => { ctl.current?.abort(); ctl.current = null; setBusy(false); }}>Cancel</button>
        : <button disabled={!text.trim()} onClick={() => void make()}>Make</button>}
      {busy && <span class="as-wait" role="status" style={{ flex: '1 1 100%', fontSize: '12px' }}>Thinking…</span>}
      {none && <span class="as-muted" role="status" style={{ flex: '1 1 100%', margin: 0 }}>No suggestion this time.</span>}
      {takes.length > 0 && (
        <div class="as-takes" role="group" aria-label="Takes">
          {takes.map((t) => (
            <button key={t.id} class="as-take" aria-pressed={active === t.id} aria-label={`Take ${t.id}: ${t.patch.name}`} title={t.description} onClick={() => pick(t.id, t.patch)}>
              <b>{t.id}</b><span>{t.description}</span>
            </button>
          ))}
          {original && <button class="as-take" aria-pressed={active === 'orig'} aria-label="Original" onClick={() => pick('orig', original)}><b>↺</b><span>Original</span></button>}
        </div>
      )}
    </div>
  );
}
