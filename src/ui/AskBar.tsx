import { useEffect, useRef, useState } from 'preact/hooks';
import { assistStatus, askAssistant } from '../assist/client';
import { askProposals, type Proposal } from '../assist/apply';
import { projectSummary } from '../assist/summary';
import { apply, currentPattern, project, track } from '../store/project';
import '../ui/assist.css';

type Result = { summary: string; proposals: Proposal[] };

/**
 * Assistant entry point. Hidden unless the proxy answers; with a proxy but no key it is one muted hint.
 * Nothing changes until the user presses Apply on the result card, and Apply is one undo step.
 */
export function AskBar() {
  const status = assistStatus.value;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [none, setNone] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    if (!result) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setResult(null); setChecked([]); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result]);

  if (status === 'no-key') return <div class="as-muted" data-testid="assist-hint">Assistant: add ANTHROPIC_API_KEY to .env and restart the dev server</div>;
  if (status !== 'on') return null;

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    setNone(false);
    const r = await askAssistant({ feature: 'ask', summary: projectSummary(project.peek(), currentPattern.peek()), text: q.slice(0, 500) }, c.signal);
    if (c.signal.aborted) return;
    ctl.current = null;
    setBusy(false);
    const out = r ? askProposals(project.peek(), r) : null;
    if (!out || out.proposals.length === 0) { setNone(true); return; }
    setResult(out);
    setChecked(out.proposals.map(() => true));
  };
  const cancel = () => { ctl.current?.abort(); ctl.current = null; setBusy(false); };
  const close = () => { setResult(null); setChecked([]); };
  const applyChecked = () => {
    if (!result) return;
    const cmds = result.proposals.flatMap((p, i) => (checked[i] ? p.commands : []));
    if (cmds.length) apply(cmds);
    setText('');
    close();
  };
  const any = checked.some(Boolean);

  return (
    <div class="as-bar">
      <div class="as-row">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#5CC8FF" stroke-width="1.6" stroke-linecap="round"><path d="M9 2 L10.6 7.4 L16 9 L10.6 10.6 L9 16 L7.4 10.6 L2 9 L7.4 7.4 Z" /></svg>
        {busy ? (
          <>
            <span class="as-wait" role="status">Thinking…</span>
            <button class="as-cancel" aria-label="Cancel" onClick={cancel}>Cancel</button>
          </>
        ) : (
          <>
            <input data-ask-input aria-label="Ask the assistant" placeholder={`Ask: make this ${track.value.name.toLowerCase()} part busier…`} value={text} maxLength={500}
              onInput={(e) => { setText(e.currentTarget.value); setNone(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); else if (e.key === 'Escape') e.currentTarget.blur(); }} />
            <button aria-label="Send" disabled={!text.trim()} onClick={() => void send()}>Send</button>
          </>
        )}
      </div>
      {none && <div class="as-muted" role="status">No suggestion this time.</div>}
      {result && (
        <div class="sheet-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div class="as-card" role="dialog" aria-label="Assistant suggestion">
            <h3 data-testid="ask-summary">{result.summary}</h3>
            {result.proposals.map((p, i) => (
              <label class="as-prop" key={i}>
                <input type="checkbox" checked={checked[i] ?? false} onChange={(e) => { const v = e.currentTarget.checked; setChecked((c) => c.map((x, j) => (j === i ? v : x))); }} />
                <span>{p.label}</span>
              </label>
            ))}
            <div class="as-actions">
              <button onClick={close}>Skip</button>
              <button class="as-go" disabled={!any} onClick={applyChecked}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
