import { useEffect, useRef, useState, useLayoutEffect } from 'preact/hooks';
import { captureView } from '../app/nav';
import { COUNT_IN_OPTIONS, LENGTH_OPTIONS, captureBars, captureResult, captureSource, countInBars } from '../capture/session';
import { startLive, type LiveSession } from '../capture/live';
import { transcribe } from '../capture/transcribe';
import { hzToMidi } from '../capture/pitch';
import type { CaptureSource, PitchFrame } from '../capture/types';
import { MicError } from '../platform/recorder';
import { calibrateLatency, getLatencyMs, scheduleClick } from '../platform/latency';
import { ensureRunning, getAudioContext } from '../platform/audio';
import { project } from '../store/project';
import { midiToNote } from '../store/notation';
import { Sheet } from '../ui/Sheet';
import '../ui/capture.css';

const SOURCES: { id: CaptureSource; label: string; sub: string; tip: string }[] = [
  { id: 'voice', label: 'Voice', sub: 'sing “da”', tip: 'Sing “da” or “doo” rather than “mmm”: the consonants mark where notes start.' },
  { id: 'whistle', label: 'Whistle', sub: 'cleanest', tip: 'Whistling is the cleanest signal for pitch. It lands an octave or two high; that is fixed after.' },
  { id: 'guitar', label: 'Guitar', sub: 'single notes', tip: 'Pick single notes. Each pluck is a clear note start, so rhythm comes out tight.' },
  { id: 'chords', label: 'Chords', sub: 'strum, ML', tip: 'Strum or play chords. A small on-device model picks out several notes at once.' },
];

/** Starting pitch window (lowest semitone of 12 shown) per source; it re-centers when you sing outside it. */
const START_LO: Record<CaptureSource, number> = { voice: 53, whistle: 79, guitar: 52, chords: 50 };
const ROWS = 12;
const LABEL_W = 34;

type Phase = 'idle' | 'starting' | 'countin' | 'recording' | 'processing';

type Run = {
  live: LiveSession;
  ctx: AudioContext;
  clicks: { stop(): void }[];
  clicksStart: number;
  tBar1: number;
  barDur: number;
  bars: number;
  total: number; // beats scheduled
  offset: number; // s to subtract from audio time to get bar time (pre-roll + count-in + latency)
  source: CaptureSource;
  bpm: number;
  lo: number;
  finishing: boolean;
};

const micMessage = (e: unknown): string =>
  e instanceof MicError
    ? e.reason === 'denied'
      ? 'Microphone access is blocked. Allow it in the browser’s site settings, then try again.'
      : e.reason === 'nomic'
        ? 'No microphone found. Plug one in or check that another app is not using it.'
        : e.message
    : 'Could not start the microphone.';

export function Capture() {
  const source = captureSource.value;
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const [latency, setLatency] = useState(getLatencyMs());
  const run = useRef<Run | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const raf = useRef(0);
  const timer = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const noteEl = useRef<HTMLElement>(null);
  const centsEl = useRef<HTMLSpanElement>(null);
  const knobEl = useRef<HTMLElement>(null);
  const meterEls = useRef<(HTMLSpanElement | null)[]>([]);
  const idleLo = useRef(START_LO[source]);
  const statusRef = useRef('');

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const say = (s: string) => { if (s !== statusRef.current) { statusRef.current = s; setStatus(s); } };

  useEffect(() => { idleLo.current = START_LO[source]; }, [source]);

  // Drawing and the status text run in one rAF loop; nothing here re-renders per frame.
  useEffect(() => {
    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const cv = canvas.current;
      if (!cv) return;
      const r = run.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d');
      if (!g || w === 0) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // Latest voiced frame drives the readout and re-centers the pitch window.
      let cur: PitchFrame | null = null;
      if (r) {
        const fr = r.live.frames;
        for (let i = fr.length - 1; i >= Math.max(0, fr.length - 6); i--) if (fr[i]!.hz > 0) { cur = fr[i]!; break; }
        if (cur) {
          const m = hzToMidi(cur.hz);
          if (m < r.lo || m > r.lo + ROWS - 1) r.lo = Math.round(m) - Math.floor(ROWS / 2);
        }
      }
      const lo = r ? r.lo : idleLo.current;
      const rowH = h / ROWS;
      const plotW = w - LABEL_W;
      g.font = '10px "IBM Plex Mono", monospace';
      g.textBaseline = 'middle';
      for (let i = 0; i < ROWS; i++) {
        const midi = lo + ROWS - 1 - i;
        const y = i * rowH;
        if (midi % 12 === 0) { g.fillStyle = '#1e2128'; g.fillRect(0, y, w, rowH); }
        g.fillStyle = '#22252b';
        g.fillRect(0, y + rowH - 1, w, 1);
        g.fillStyle = '#9a9da6';
        g.fillText(midiToNote(midi), 8, y + rowH / 2);
      }
      const bars = r ? r.bars : captureBars.value;
      g.fillStyle = '#2e313a';
      for (let b = 0; b <= bars; b++) g.fillRect(LABEL_W + (plotW * b) / bars - (b === bars ? 1 : 0), 0, 1, h);
      g.fillStyle = '#9a9da6';
      for (let b = 0; b < bars; b++) g.fillText(`BAR ${b + 1}`, LABEL_W + (plotW * b) / bars + 4, 9);

      if (r) {
        const totalS = r.bars * r.barDur;
        const now = r.ctx.currentTime;
        const xOf = (t: number) => LABEL_W + (plotW * (t - r.offset)) / totalS;
        const yOf = (m: number) => h - (m - lo + 0.5) * rowH;
        g.strokeStyle = '#5cc8ff';
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        let pen = false;
        let prev = 0;
        for (const f of r.live.frames) {
          if (f.hz <= 0) { pen = false; continue; }
          const x = xOf(f.t);
          if (x < LABEL_W - 4 || x > w) { pen = false; continue; }
          const m = hzToMidi(f.hz);
          if (pen && Math.abs(m - prev) > 2.5) pen = false;
          if (pen) g.lineTo(x, yOf(m)); else g.moveTo(x, yOf(m));
          pen = true;
          prev = m;
        }
        g.stroke();
        const head = (now - r.tBar1) / r.barDur;
        if (head >= 0 && head <= r.bars) {
          g.fillStyle = '#ffb547';
          g.fillRect(LABEL_W + (plotW * head) / r.bars - 1, 0, 2, h);
        }

        // Status text and automatic stop.
        const rel = now - r.tBar1;
        if (r.finishing) {
          /* already stopping */
        } else if (rel < 0) {
          const countBars = Math.round((r.tBar1 - r.clicksStart) / r.barDur);
          const into = now - r.clicksStart;
          const b = Math.max(1, Math.min(countBars, Math.floor(into / r.barDur) + 1));
          say(`Count-in${countBars > 1 ? `, bar ${b} of ${countBars}` : ''}…`);
          if (phaseRef.current !== 'countin') go('countin');
        } else {
          if (phaseRef.current !== 'recording') go('recording');
          const b = Math.min(r.bars, Math.floor(rel / r.barDur) + 1);
          say(`Recording bar ${b} of ${r.bars}, clicks on`);
          if (rel >= totalS + latencyS() + 0.2) void finish(false);
        }
        // Level meter
        const lvl = r.live.level();
        meterEls.current.forEach((el, i) => { if (el) el.toggleAttribute('data-on', lvl * 5 > i + 0.2); });
      }

      // Readout
      if (noteEl.current && centsEl.current && knobEl.current) {
        if (cur) {
          const m = hzToMidi(cur.hz);
          const n = Math.round(m);
          const c = Math.round((m - n) * 100);
          noteEl.current.textContent = midiToNote(n);
          centsEl.current.textContent = `${c >= 0 ? '+' : '−'}${Math.abs(c)}¢`;
          knobEl.current.style.left = `${50 + Math.max(-50, Math.min(50, c))}%`;
        } else if (!r) {
          noteEl.current.textContent = '–';
          centsEl.current.textContent = '';
        }
      }
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const latencyS = () => getLatencyMs() / 1000;

  async function start() {
    if (phaseRef.current !== 'idle') return;
    setError('');
    go('starting');
    say('Opening the microphone…');
    try {
      const ctx = await ensureRunning();
      const bpm = project.value.bpm;
      const beat = 60 / bpm;
      const barDur = beat * 4;
      const bars = captureBars.value;
      const countBars = countInBars.value;
      const live = await startLive(source, { onLimit: () => void finish(false) });
      const lat = latencyS();
      const clicksStart = ctx.currentTime + 0.25;
      const tBar1 = clicksStart + countBars * barDur;
      const total = (countBars + bars) * 4;
      const clicks: { stop(): void }[] = [];
      for (let k = 0; k < total; k++) clicks.push(scheduleClick(ctx, clicksStart + k * beat, k % 4 === 0));
      const r: Run = { live, ctx, clicks, tBar1, clicksStart, barDur, bars, total, offset: tBar1 - live.startTime + lat, source, bpm, lo: START_LO[source], finishing: false };
      run.current = r;
      go(countBars > 0 ? 'countin' : 'recording');
      timer.current = window.setTimeout(() => void finish(false), (tBar1 + bars * barDur + lat + 0.6 - ctx.currentTime) * 1000);
    } catch (e) {
      setError(micMessage(e));
      say('');
      go('idle');
    }
  }

  async function finish(cancel: boolean) {
    const r = run.current;
    if (!r || r.finishing) return;
    r.finishing = true;
    window.clearTimeout(timer.current);
    r.clicks.forEach((c) => c.stop());
    const now = r.ctx.currentTime;
    const rel = now - r.tBar1;
    if (cancel || rel < 0.3) {
      r.live.cancel();
      run.current = null;
      say('');
      go('idle');
      return;
    }
    const bars = Math.max(1, Math.min(r.bars, Math.ceil((rel - latencyS()) / r.barDur)));
    go('processing');
    setProgress(0);
    say('Listening back…');
    try {
      const audio = await r.live.stop();
      const frames = r.live.frames.map((f) => ({ ...f, t: f.t - r.offset }));
      const tr = await transcribe(audio.l, audio.rate, r.source, {
        offset: r.offset,
        onProgress: (p) => { setProgress(p); say(p < 0.05 ? 'Loading the note model (first time takes a few seconds)…' : 'Reading your notes…'); },
      });
      const inRange = tr.notes.filter((n) => n.start < bars * r.barDur + 0.05);
      if (inRange.length === 0) {
        setError('No notes heard. Sing, whistle or play a little louder and closer to the microphone, then try again.');
        say('');
        go('idle');
        return;
      }
      captureResult.value = { transcription: { ...tr, notes: inRange }, audio: { l: audio.l, rate: audio.rate }, bars, bpm: r.bpm, frames };
      captureView.value = 'place';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong while reading the recording.');
      say('');
      go('idle');
    } finally {
      run.current = null;
    }
  }

  // Leaving the screen releases the mic and cancels pending clicks.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    const r = run.current;
    if (r && !r.finishing) { r.clicks.forEach((c) => c.stop()); r.live.cancel(); }
    run.current = null;
  }, []);

  const recording = phase === 'countin' || phase === 'recording';
  const busy = phase === 'starting' || phase === 'processing';

  // Layout effect: the key handler is attached before the screen is painted, so a key pressed
  // the moment Capture appears (Escape, R) is never lost.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (calOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); if (recording) void finish(true); else if (!busy) captureView.value = 'off'; }
      else if (e.key.toLowerCase() === 'r' && !e.repeat) { e.preventDefault(); if (recording) void finish(false); else if (phaseRef.current === 'idle') void start(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cycle = <T extends number>(opts: readonly T[], cur: number): T => opts[(opts.indexOf(cur as T) + 1) % opts.length]!;
  const countLabel = countInBars.value === 0 ? 'off' : `${countInBars.value} bar${countInBars.value > 1 ? 's' : ''}`;
  const tip = SOURCES.find((s) => s.id === source)!.tip;

  return (
    <div class="cap-back">
      <div class="cap noselect" role="dialog" aria-label="Capture a melody">
        <div class="cap-head">
          <button class="cap-icon" aria-label="Close" disabled={busy} onClick={() => { if (recording) void finish(true); captureView.value = 'off'; }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg>
          </button>
          <div class="col" style={{ flexGrow: 1, minWidth: 0 }}>
            <h2>Capture a melody</h2>
            <span class="cap-sub">sing, whistle or play · any key, fixed after</span>
          </div>
          <button class="cap-small" disabled={recording || busy} onClick={() => setCalOpen(true)} aria-label="Calibrate latency">
            Calibrate<span class="mono hint-wide" data-testid="latency-chip" style={{ color: 'var(--muted)', marginLeft: '6px', fontSize: '11px' }}>{latency > 0 ? `${latency} ms` : ''}</span>
          </button>
        </div>

        <div class="cap-sources" role="group" aria-label="Source">
          {SOURCES.map((s) => (
            <button key={s.id} class="cap-src" aria-pressed={s.id === source} disabled={recording || busy} onClick={() => { captureSource.value = s.id; }}>
              <b>{s.label}</b><span>{s.sub}</span>
            </button>
          ))}
        </div>
        <span class="cap-tip">{tip} Headphones help: without them the clicks leak into the mic.</span>

        <div class="cap-readout">
          <div class="cap-note"><b ref={noteEl} data-testid="note-readout">–</b><span ref={centsEl} /></div>
          <div class="cap-tune" role="img" aria-label="Tuning">
            <i style={{ left: 0, right: 0, top: '8px', height: '2px' }} />
            <i style={{ left: '25%', top: '4px', width: '2px', height: '10px' }} />
            <i style={{ left: '50%', top: 0, width: '2px', height: '18px', background: 'var(--muted)' }} />
            <i style={{ left: '75%', top: '4px', width: '2px', height: '10px' }} />
            <i class="knob" ref={knobEl} />
          </div>
          <span class="cap-help">Sing in any key. Only the shape matters; you fit it to the song next.</span>
        </div>

        <div class="cap-grid"><canvas ref={canvas} aria-label="Pitch trace" /></div>

        {phase === 'processing' && <div class="cap-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        <div class="cap-status" data-rec={recording ? '' : undefined}>
          <span class="dot" />
          <p role={error ? 'alert' : 'status'} data-error={error ? '' : undefined} data-testid="cap-status">{error || status || 'Ready. Tap record when you are.'}</p>
          <div class="cap-meter" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} ref={(el) => { meterEls.current[i] = el; }} />)}</div>
        </div>

        <div class="cap-bottom">
          <button class="cap-small" disabled={recording || busy} onClick={() => { countInBars.value = cycle(COUNT_IN_OPTIONS, countInBars.value); }}>Count-in: {countLabel}</button>
          <button class="cap-rec" aria-label={recording ? 'Stop' : 'Record'} data-on={recording ? '' : undefined} disabled={busy} onClick={() => { if (recording) void finish(false); else void start(); }}>
            <i />
          </button>
          <button class="cap-small" disabled={recording || busy} onClick={() => { captureBars.value = cycle(LENGTH_OPTIONS, captureBars.value); }}>Length: {captureBars.value} bar{captureBars.value > 1 ? 's' : ''}</button>
        </div>

        {calOpen && <CalibrateSheet onClose={() => { setCalOpen(false); setLatency(getLatencyMs()); }} />}
      </div>
    </div>
  );
}

function CalibrateSheet(props: { onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'silent' | 'error'>('idle');
  const [ms, setMs] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const go = async () => {
    setState('running');
    try {
      const v = await calibrateLatency();
      setMs(v);
      setState(v === null ? 'silent' : 'done');
    } catch (e) {
      setErr(micMessage(e));
      setState('error');
    }
  };
  const saved = getLatencyMs();
  return (
    <Sheet title="Calibrate latency" onClose={props.onClose}>
      <p class="cap-cal">
        Plays six clicks and listens for them through the microphone to measure the round trip, so your takes land on the beat.
        Quiet room, phone speaker on, no headphones, volume up.
      </p>
      {state === 'done' && <p class="cap-cal" data-testid="latency-result">Round trip: <b class="v" data-testid="latency-value">{ms} ms</b>. Saved for this device.</p>}
      {state === 'silent' && <p class="cap-cal" role="alert">Could not hear the clicks. Turn the volume up, take headphones off and try again.</p>}
      {state === 'error' && <p class="cap-cal" role="alert">{err}</p>}
      {state === 'idle' && saved > 0 && <p class="cap-cal">Saved for this device: <b class="v" data-testid="latency-value">{saved} ms</b></p>}
      <button class="btn primary" disabled={state === 'running'} onClick={() => void go()}>{state === 'running' ? 'Listening…' : state === 'idle' ? 'Start' : 'Measure again'}</button>
    </Sheet>
  );
}
