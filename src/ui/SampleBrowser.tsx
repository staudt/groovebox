import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, project } from '../store/project';
import { KIT_PREFIX, KIT_SOUNDS, decodeFile, deleteSample, listSamples, renameSample, saveSample, type Sample, type SampleMeta } from '../store/samples';
import { audibleStep, audition, ensureSample, resample, startAudio } from '../engine/host';
import { MicError, startRecording, type RecordingSession, MAX_RECORD_SECONDS } from '../platform/recorder';
import { trimSilence } from '../platform/trim';
import { Sheet } from './Sheet';

export type BrowserTab = 'kit' | 'yours' | 'record' | 'resample';
const TABS: [BrowserTab, string][] = [['kit', 'Kit'], ['yours', 'Your samples'], ['record', 'Record'], ['resample', 'Resample']];

/** Assigns a sample to a sampler track (resets the trim), makes sure the engine has it, and auditions. */
export async function assignSample(track: number, id: string, name: string, play = true): Promise<void> {
  await startAudio();
  apply({ type: 'setSampler', track, patch: { sampleId: id, name, start: 0, end: 1 } });
  await ensureSample(id);
  if (play) void audition(track, 100);
}

const baseName = (f: string) => f.replace(/\.[^.]+$/, '');
const nextName = (prefix: string, all: SampleMeta[]) => {
  const n = all.filter((m) => m.name.startsWith(prefix)).length + 1;
  return `${prefix} ${n}`;
};
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

function KitTab(props: { current: string | null; track: number }) {
  return (
    <div class="sn-list">
      {KIT_SOUNDS.map((k) => (
        <div class="sn-item" key={k}>
          <button class="load" aria-label={`Kit ${k}`} aria-current={props.current === KIT_PREFIX + k} onClick={() => void assignSample(props.track, KIT_PREFIX + k, k)}>
            <span>{k}</span><small>kit</small>
          </button>
        </div>
      ))}
    </div>
  );
}

function YoursTab(props: { current: string | null; track: number; list: SampleMeta[]; refresh: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  if (props.list.length === 0) return <p class="sn-msg">No samples yet. Import a file, record, or resample.</p>;
  return (
    <div class="sn-list">
      {props.list.map((m) => (
        <div class="sn-item" key={m.id}>
          {renaming === m.id ? (
            <>
              <input class="sn-text" style={{ flex: '1 1 auto', minWidth: 0 }} aria-label="Sample name" value={text} maxLength={40} autoFocus
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => {
                  const n = text.trim();
                  setRenaming(null);
                  if (!n) return;
                  void renameSample(m.id, n).then(() => {
                    props.refresh();
                    if (props.current === m.id) apply({ type: 'setSampler', track: props.track, patch: { name: n } });
                  });
                }} />
            </>
          ) : (
            <>
              <button class="load" aria-label={`Use ${m.name}`} aria-current={props.current === m.id} onClick={() => void assignSample(props.track, m.id, m.name)}>
                <span>{m.name}</span><small>{(m.frames / m.rate).toFixed(1)}s · {m.source}</small>
              </button>
              <button class="btn square" aria-label={`Rename ${m.name}`} onClick={() => { setText(m.name); setRenaming(m.id); }}>✎</button>
              {confirm === m.id ? (
                <button class="btn" style={{ borderColor: 'var(--fx, #FF6B5E)', color: '#FF6B5E' }} aria-label={`Confirm delete ${m.name}`}
                  onClick={() => void deleteSample(m.id).then(() => { setConfirm(null); props.refresh(); })}>Delete?</button>
              ) : (
                <button class="btn square" aria-label={`Delete ${m.name}`} onClick={() => setConfirm(m.id)}>×</button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function RecordTab(props: { track: number; list: SampleMeta[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<'idle' | 'starting' | 'rec' | 'saving'>('idle');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const sess = useRef<RecordingSession | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const listRef = useRef(props.list);
  listRef.current = props.list;

  useEffect(() => () => sess.current?.cancel(), []);

  useEffect(() => {
    if (busy !== 'rec') return;
    let raf = 0;
    const tick = () => {
      const s = sess.current;
      if (s) {
        if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, s.level() * 1.4).toFixed(3)})`;
        if (clock.current) clock.current.textContent = fmtT(s.elapsed());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy]);

  const stop = async () => {
    const s = sess.current;
    if (!s) return;
    sess.current = null;
    setBusy('saving');
    try {
      const rec = await s.stop();
      const t = trimSilence(rec.l, undefined, rec.rate, -45, 10, 10);
      if (!t) {
        setErr('Nothing was recorded above the noise floor. Try again closer to the mic.');
      } else {
        const name = nextName('Recording', listRef.current);
        const smp: Sample = { l: t.l, rate: rec.rate };
        const id = await saveSample(name, smp, 'record');
        await assignSample(props.track, id, name);
        props.onSaved();
        setMsg(`Saved "${name}" (${(t.l.length / rec.rate).toFixed(1)} s) and assigned.`);
      }
    } catch {
      setErr('Could not save the recording.');
    }
    setBusy('idle');
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = async () => {
    setErr('');
    setMsg('');
    setBusy('starting');
    try {
      sess.current = await startRecording(() => void stopRef.current());
      setBusy('rec');
    } catch (e) {
      setErr(e instanceof MicError ? e.message : 'Could not start recording.');
      setBusy('idle');
    }
  };

  return (
    <div class="sn-list" style={{ maxHeight: 'none' }}>
      <button class={busy === 'rec' ? 'btn primary' : 'btn'} style={{ height: '56px', fontSize: '16px' }} disabled={busy === 'starting' || busy === 'saving'}
        aria-label={busy === 'rec' ? 'Stop recording' : 'Record'} onClick={() => void (busy === 'rec' ? stop() : start())}>
        {busy === 'rec' ? '■ Stop' : busy === 'saving' ? 'Saving…' : '● Record'}
      </button>
      <div class="sn-meter" aria-hidden="true"><div ref={bar} data-testid="rec-meter" /></div>
      <span class="sn-msg" ref={clock} data-testid="rec-time">{busy === 'rec' ? '0:00.0' : `max ${MAX_RECORD_SECONDS} s`}</span>
      {err && <p class="sn-err" role="alert" data-testid="rec-error">{err}</p>}
      {msg && <p class="sn-msg" data-testid="rec-saved">{msg}</p>}
    </div>
  );
}

function ResampleTab(props: { track: number; list: SampleMeta[]; onSaved: () => void }) {
  const [source, setSource] = useState(-1);
  const [bars, setBars] = useState(1);
  const [state, setState] = useState<'idle' | 'waiting' | 'recording'>('idle');
  const [msg, setMsg] = useState('');
  const timer = useRef(0);
  const listRef = useRef(props.list);
  listRef.current = props.list;
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = async () => {
    setMsg('');
    await startAudio();
    // The engine starts at the next bar while playing; estimate that moment for the label.
    const step = audibleStep();
    if (step >= 0) {
      setState('waiting');
      const stepS = 60 / project.peek().bpm / 4;
      const toBar = (16 - (step % 16)) * stepS;
      timer.current = window.setTimeout(() => setState('recording'), Math.max(0, toBar * 1000 - 50));
    } else {
      setState('recording');
    }
    try {
      const out = await resample(source, bars);
      clearTimeout(timer.current);
      const name = nextName('Resample', listRef.current);
      const id = await saveSample(name, out, 'resample');
      await assignSample(props.track, id, name);
      props.onSaved();
      setMsg(`Saved "${name}" and assigned.`);
    } catch {
      setMsg('Resample failed.');
    }
    setState('idle');
  };

  const tracks = project.value.tracks;
  return (
    <div class="sn-list" style={{ maxHeight: 'none' }}>
      <h4>Source</h4>
      <div class="sn-chips" style={{ flexWrap: 'wrap' }}>
        <button class="sn-chip" style={{ flex: '0 0 auto', padding: '0 12px' }} aria-pressed={source === -1} onClick={() => setSource(-1)}>Master</button>
        {tracks.map((t, i) => (
          <button key={t.id} class="sn-chip" style={{ flex: '0 0 auto', padding: '0 12px' }} aria-pressed={source === i} onClick={() => setSource(i)}>{t.name}</button>
        ))}
      </div>
      <h4>Bars</h4>
      <div class="sn-chips">
        {[1, 2, 4].map((b) => <button key={b} class="sn-chip" aria-pressed={bars === b} aria-label={`${b} bar${b > 1 ? 's' : ''}`} onClick={() => setBars(b)}>{b}</button>)}
      </div>
      <button class="btn primary" disabled={state !== 'idle'} data-testid="resample-go" onClick={() => void go()}>
        {state === 'waiting' ? 'waiting for bar…' : state === 'recording' ? 'recording…' : 'Resample'}
      </button>
      <p class="sn-msg">Press play first: it records what is playing, from the next bar.</p>
      {msg && <p class="sn-msg" data-testid="resample-msg">{msg}</p>}
    </div>
  );
}

/** Sample browser sheet: Kit, Your samples, Record, Resample, plus Import. Tapping a sample assigns it and plays it. */
export function SampleBrowser(props: { track: number; current: string | null; initialTab?: BrowserTab; onClose: () => void }) {
  const [tab, setTab] = useState<BrowserTab>(props.initialTab ?? 'kit');
  const [list, setList] = useState<SampleMeta[]>([]);
  const [err, setErr] = useState('');
  const refresh = () => void listSamples().then(setList);
  useEffect(refresh, []);

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setErr('');
    try {
      const smp = await decodeFile(f);
      const name = baseName(f.name).slice(0, 40) || 'Imported';
      const id = await saveSample(name, smp, 'file');
      await assignSample(props.track, id, name);
      refresh();
      setTab('yours');
    } catch {
      setErr('Could not read that audio file.');
    }
  };

  return (
    <Sheet title="Samples" onClose={props.onClose}>
      <label class="btn sn-importlbl">
        Import file…
        <input class="sn-file" type="file" accept="audio/*" aria-label="Import audio file" onChange={(e) => void onFile(e)} />
      </label>
      {err && <p class="sn-err" role="alert">{err}</p>}
      <div class="sn-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" class="sn-chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'kit' && <KitTab current={props.current} track={props.track} />}
      {tab === 'yours' && <YoursTab current={props.current} track={props.track} list={list} refresh={refresh} />}
      {tab === 'record' && <RecordTab track={props.track} list={list} onSaved={refresh} />}
      {tab === 'resample' && <ResampleTab track={props.track} list={list} onSaved={refresh} />}
    </Sheet>
  );
}

