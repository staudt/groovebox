import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { askAssistant } from '../assist/client';
import { jamItems } from '../assist/apply';
import { projectSummary } from '../assist/summary';
import { JAM_START, jamTick, mergeJam, type JamItem, type JamState } from '../assist/jamPlan';
import { apply, currentPattern, playing, project, type Command } from '../store/project';
import { applyAtNextBar, audibleStep, songPos } from '../engine/host';
import { assistantOn } from '../app/features';
import './assist.css';

/** Jam mode survives leaving the Song screen; the queue and the polling only live while it is shown. */
export const jamOn = signal(false);
const POLL_MS = 100;
type Item = JamItem<Command>;

/**
 * Jam queue: while the song plays, variations are prepared in the background (never on the audio
 * path) and listed as queue items. A queued item is applied as one undo step at the next section
 * boundary (song mode) or the next bar of the loop. Nothing is applied without a Queue tap.
 */
export function JamPanel() {
  const on = jamOn.value && assistantOn.value;
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<Item[]>([]);
  const nextId = useRef(1);
  const setAll = (next: Item[]) => { ref.current = next; setItems(next); };
  const patch = (id: number, status: Item['status']) => setAll(ref.current.map((i) => (i.id === id ? { ...i, status } : i)));

  useEffect(() => {
    if (!on) { setAll([]); return; }
    let st: JamState = JAM_START;
    const sent = new Set<number>(); // queued items already handed to the engine for the next bar line
    let flight: AbortController | null = null;
    const stop = () => { flight?.abort(); flight = null; setBusy(false); };
    const timer = window.setInterval(() => {
      const p = project.peek();
      const song = p.playMode === 'song' && p.sections.length > 0;
      const pos = songPos.peek();
      if (!playing.peek()) { if (st !== JAM_START) { st = JAM_START; stop(); } return; }
      if (song && !pos) return; // the first section event has not been heard yet
      const sec = song ? p.sections[pos!.section] : undefined;
      const d = jamTick(st, { playing: true, mode: song ? 'song' : 'loop', section: pos?.section ?? 0, bar: pos?.bar ?? 0, sectionBars: sec?.bars ?? 0, step: song ? 0 : audibleStep() });
      st = d.state;
      // Send queued items so the engine swaps them in on the bar line: during the section's last bar
      // (song mode: lands on the next section's first beat), or right away in loop mode (next bar).
      // The engine holds them until that bar line, so nothing changes early.
      const lastBar = song ? (pos?.bar ?? 0) >= (sec?.bars ?? 1) - 1 : true;
      if (lastBar) {
        const toSend = ref.current.filter((i) => i.status === 'queued' && !sent.has(i.id));
        for (const i of toSend) {
          applyAtNextBar(i.commands); // one undo step each
          sent.add(i.id);
        }
      }
      if (d.boundary && sent.size) {
        // The bar line has been heard: what was sent is now playing.
        setAll(ref.current.map((i) => (sent.has(i.id) && i.status === 'queued' ? { ...i, status: 'played' } : i)));
        sent.clear();
      }
      if (d.request && !flight) {
        const c = new AbortController();
        flight = c;
        setBusy(true);
        void askAssistant({ feature: 'jam', summary: projectSummary(p, currentPattern.peek()), section: sec?.name ?? `loop ${currentPattern.peek()}`, bar: pos?.bar ?? 0 }, c.signal).then((r) => {
          if (c.signal.aborted) return;
          flight = null;
          setBusy(false);
          if (!r) return;
          const fresh: Item[] = jamItems(project.peek(), r).map((j) => ({ id: nextId.current++, description: j.description, tracks: j.tracks, commands: j.commands, status: 'new' }));
          setAll(mergeJam(ref.current, fresh));
        });
      }
    }, POLL_MS);
    return () => { window.clearInterval(timer); stop(); };
  }, [on]);

  if (!assistantOn.value) return null;
  const pending = items.filter((i) => i.status === 'queued').length;
  return (
    <div class="jam" aria-label="Jam queue">
      <div class="jam-head">
        <button class="jam-toggle" aria-pressed={on} aria-label="Jam mode" onClick={() => { jamOn.value = !jamOn.value; }}>Jam mode {on ? 'on' : 'off'}</button>
        <span>{on ? (busy ? 'Preparing…' : pending ? `${pending} queued for the next ${project.value.playMode === 'song' ? 'section' : 'bar'}` : items.length ? 'Up next, prepared while you play' : 'Waiting for playback') : ''}</span>
      </div>
      {on && items.map((i) => (
        <div class="jam-item" key={i.id} data-status={i.status}>
          <div class="jam-text"><span>{i.description}</span><small>{i.tracks.join(' · ')}</small></div>
          {i.status === 'new' && <>
            <button aria-label={`Skip: ${i.description}`} onClick={() => patch(i.id, 'skipped')}>Skip</button>
            <button class="q" aria-label={`Queue: ${i.description}`} onClick={() => patch(i.id, 'queued')}>Queue</button>
          </>}
          {i.status === 'queued' && <>
            <span class="st">Queued</span>
            <button aria-label={`Skip: ${i.description}`} onClick={() => patch(i.id, 'skipped')}>Skip</button>
          </>}
          {i.status === 'played' && <span class="st">Played</span>}
          {i.status === 'skipped' && <span class="st">Skipped</span>}
        </div>
      ))}
    </div>
  );
}
