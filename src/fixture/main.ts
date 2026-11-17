// Fixture recorder page (fixture.html): records the user repeating a reference melody or chord
// sequence in time, scores it with the real pipeline, and downloads WAV + expected-notes JSON.
import { REF_BPM, refBeats, refChordNotes, refMelodyNotes, type RefNote } from '../capture/reference';
import { transcribe } from '../capture/transcribe';
import { gridAccuracy } from '../capture/score';
import type { CaptureSource } from '../capture/types';
import { startRecording, MicError } from '../platform/recorder';
import { ensureRunning } from '../platform/audio';
import { toWav } from '../app/wav';
import { midiToNote } from '../store/notation';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const kindSel = $<HTMLSelectElement>('kind');
const octSel = $<HTMLSelectElement>('octave');
const status = $<HTMLDivElement>('status');
const result = $<HTMLPreElement>('result');
const beat = 60 / REF_BPM;

const SOURCE: Record<string, CaptureSource> = { 'voice-da': 'voice', hum: 'voice', whistle: 'whistle', guitar: 'guitar', chords: 'chords' };
const isChords = () => kindSel.value === 'chords';
const reference = (t0: number): RefNote[] => (isChords() ? refChordNotes(t0) : refMelodyNotes(t0, kindSel.value === 'whistle' ? 0 : Number(octSel.value)));

function showRef(): void {
  const notes = reference(0);
  $('ref').textContent = isChords()
    ? 'Am | F | C | G   (one strum per bar, at 100 BPM)'
    : notes.map((n) => midiToNote(n.midi)).join('  ') + `   (at ${REF_BPM} BPM, starts on beat 1)`;
  octSel.hidden = isChords() || kindSel.value === 'whistle';
}
kindSel.onchange = showRef;
octSel.onchange = showRef;
showRef();

function click(ctx: AudioContext, t: number, accent: boolean): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.06);
}

function tone(ctx: AudioContext, t: number, dur: number, midi: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
  g.gain.setValueAtTime(0.2, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

$('listen').onclick = async () => {
  const ctx = await ensureRunning();
  const t0 = ctx.currentTime + 0.2;
  const beats = refBeats(isChords() ? 'chords' : 'melody');
  for (let b = 0; b < 4 + beats; b++) click(ctx, t0 + b * beat, b % 4 === 0);
  for (const n of reference(t0 + 4 * beat)) tone(ctx, n.start, n.end - n.start, n.midi);
};

let wav: Uint8Array | null = null;
let json = '';

$('record').onclick = async () => {
  $<HTMLButtonElement>('record').disabled = true;
  result.hidden = true;
  try {
    const ctx = await ensureRunning();
    const rec = await startRecording();
    // The recording starts roughly now; clicks begin a little later. The scorer searches the exact
    // offset (±0.3 s), so this rough alignment is enough.
    const recStart = ctx.currentTime;
    const t0 = recStart + 0.5;
    const beats = refBeats(isChords() ? 'chords' : 'melody');
    for (let b = 0; b < 4 + beats + 1; b++) click(ctx, t0 + b * beat, b % 4 === 0);
    const total = 0.5 + (4 + beats + 1.5) * beat;
    const tick = setInterval(() => {
      const left = total - (ctx.currentTime - recStart);
      const b = Math.floor((ctx.currentTime - t0) / beat);
      status.textContent = b < 0 ? 'Get ready…' : b < 4 ? `Count-in ${b + 1}` : left > 0 ? 'Go!' : '';
    }, 50);
    await new Promise((r) => setTimeout(r, total * 1000));
    clearInterval(tick);
    const { l, rate } = await rec.stop();
    status.textContent = 'Scoring…';
    const expected = reference(t0 - recStart + 4 * beat);
    const source = SOURCE[kindSel.value]!;
    const t = await transcribe(l, rate, source, { onProgress: (p) => (status.textContent = `Scoring… ${Math.round(p * 100)} %`) });
    const octaveFree = kindSel.value === 'whistle';
    const r = gridAccuracy(expected, t.notes, { bpm: REF_BPM, octaveFree });
    const target = source === 'chords' ? 75 : 90;
    status.textContent = `${Math.round(r.accuracy * 100)} % right (target ${target} %)`;
    result.hidden = false;
    result.textContent =
      `Expected: ${expected.map((n) => midiToNote(n.midi)).join(' ')}\n` +
      `Heard:    ${t.notes.map((n) => midiToNote(Math.round(n.midi))).join(' ')}\n` +
      `${r.matched}/${expected.length} on the right 1/8 step, ${r.extra} extra; offset ${(r.offset * 1000).toFixed(0)} ms; ${t.model ? 'Basic Pitch' : 'tracker fallback'}`;
    wav = toWav([l], rate);
    json = JSON.stringify({ source, bpm: REF_BPM, octaveFree, notes: expected.map((n) => ({ start: +n.start.toFixed(4), end: +n.end.toFixed(4), midi: n.midi })) }, null, 2);
    $<HTMLButtonElement>('dlwav').disabled = false;
    $<HTMLButtonElement>('dljson').disabled = false;
  } catch (e) {
    status.textContent = e instanceof MicError ? e.message : `Something went wrong: ${String(e)}`;
  } finally {
    $<HTMLButtonElement>('record').disabled = false;
  }
};

const name = () => `${kindSel.value}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
function download(data: BlobPart, file: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
$("dlwav").onclick = () => wav && download(wav.slice(), `${name()}.wav`, 'audio/wav');
$('dljson').onclick = () => json && download(json, `${name()}.json`, 'application/json');
