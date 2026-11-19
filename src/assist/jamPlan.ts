// Pure timing logic for the Jam queue: when to ask for variations and when a queued one is applied.
// The Song screen polls the transport on a slow interval and feeds the readings here; nothing in
// this file touches the audio path or the network.

export type JamTick = {
  playing: boolean;
  /** Song mode: section index and bar within it come from songPos; loop mode: the audible global step. */
  mode: 'song' | 'loop';
  section: number;
  bar: number;
  sectionBars: number;
  step: number;
};

export type JamState = {
  /** Identity of the current section / bar run; -1 before the first reading after playback starts. */
  section: number;
  bar: number;
  /** A request was already made in this section (song) or at this bar count (loop). */
  requested: boolean;
  /** Loop mode: bars heard since playback started. */
  loopBars: number;
};

export const JAM_START: JamState = { section: -1, bar: -1, requested: false, loopBars: 0 };
/** Loop mode asks once every this many bars. */
export const LOOP_REQUEST_BARS = 4;
const BAR_STEPS = 16;

export type JamDecision = { state: JamState; /** apply queued items now */ boundary: boolean; /** ask for variations now */ request: boolean };

/** One reading. `boundary` = a new section started (song) or the pattern wrapped to the next bar (loop). */
export function jamTick(s: JamState, t: JamTick): JamDecision {
  if (!t.playing) return { state: JAM_START, boundary: false, request: false };
  if (t.mode === 'song') {
    const first = s.section < 0;
    const boundary = !first && (t.section !== s.section || t.bar < s.bar);
    const fresh = first || boundary;
    const requested = fresh ? false : s.requested;
    // About two bars before the section ends (immediately for sections of one or two bars).
    const due = !requested && t.bar >= Math.max(0, t.sectionBars - 2);
    return { state: { section: t.section, bar: t.bar, requested: requested || due, loopBars: 0 }, boundary, request: due };
  }
  if (t.step < 0) return { state: s, boundary: false, request: false };
  const bar = Math.floor(t.step / BAR_STEPS);
  const first = s.bar < 0;
  const boundary = !first && bar !== s.bar;
  const loopBars = first ? 0 : boundary ? s.loopBars + 1 : s.loopBars;
  const due = (first || boundary) && loopBars % LOOP_REQUEST_BARS === 0;
  return { state: { section: 0, bar, requested: due || s.requested, loopBars }, boundary, request: due };
}

export type JamStatus = 'new' | 'queued' | 'played' | 'skipped';
export type JamItem<C> = { id: number; description: string; tracks: string[]; commands: C[]; status: JamStatus };

const MAX_ITEMS = 6;

/** New results replace unqueued ones; queued and finished items stay (finished are trimmed to the newest). */
export function mergeJam<C>(items: JamItem<C>[], fresh: JamItem<C>[]): JamItem<C>[] {
  if (fresh.length === 0) return items;
  const kept = items.filter((i) => i.status !== 'new');
  const next = [...fresh, ...kept];
  while (next.length > MAX_ITEMS) {
    const k = next.map((i) => i.status).lastIndexOf('played');
    const j = k >= 0 ? k : next.map((i) => i.status).lastIndexOf('skipped');
    next.splice(j >= 0 ? j : next.length - 1, 1);
  }
  return next;
}
