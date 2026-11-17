import { useState } from 'preact/hooks';
import { apply, currentPattern, project, selectedTrack, type Command } from '../store/project';
import { PATTERN_IDS, type PatternId, type Pattern } from '../store/types';
import { queuedPattern, songPos } from '../engine/host';
import { Sheet } from './Sheet';
import { PressButton } from './PressButton';

const hasContent = (p: Pattern) => p.steps.some((s) => s.t !== 'rest');

/**
 * Global pattern slots A-D (all tracks switch together). Amber = the pattern you are editing and
 * hearing; while playing the engine waits for the next bar, shown as a pulsing outline.
 * Long-press a chip for Copy and Clear.
 */
export function PatternChips() {
  const [sheet, setSheet] = useState<PatternId | null>(null);
  const cur = currentPattern.value;
  const queued = queuedPattern.value;
  const p = project.value;
  const t = p.tracks[selectedTrack.value]!;
  // Song mode: the section's pattern for this track is what you hear (marked, not forced).
  let heard: PatternId | null | undefined;
  if (p.playMode === 'song' && p.sections.length) {
    const sec = p.sections[Math.min(songPos.value?.section ?? 0, p.sections.length - 1)]!;
    heard = sec.patternByTrack[t.id] ?? null;
  }
  return (
    <div class="pchips" role="group" aria-label="Pattern" data-song={heard !== undefined ? '' : undefined}>
      {PATTERN_IDS.map((id) => (
        <PressButton
          key={id}
          class="pchip"
          aria-label={`Pattern ${id}`}
          aria-pressed={cur === id}
          title={heard === id ? 'Playing in the song' : 'Tap to switch, hold for copy and clear'}
          data-queued={queued === id ? '' : undefined}
          data-has={hasContent(t.patterns[id]) ? '' : undefined}
          data-heard={heard === id ? '' : undefined}
          onTap={() => { currentPattern.value = id; }}
          onLong={() => setSheet(id)}
        >{id}</PressButton>
      ))}
      {sheet && <PatternSheet target={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function clearCommands(scope: 'track' | 'all', id: PatternId): Command[] {
  const p = project.peek();
  const idx = scope === 'all' ? p.tracks.map((_, i) => i) : [selectedTrack.peek()];
  return idx.map((i) => {
    const pat = p.tracks[i]!.patterns[id];
    return { type: 'setSteps', track: i, pattern: id, steps: pat.steps.map(() => ({ t: 'rest' as const })) };
  });
}

function PatternSheet(props: { target: PatternId; onClose: () => void }) {
  const [confirm, setConfirm] = useState<null | { label: string; run: () => void }>(null);
  const from = currentPattern.value;
  const to = props.target;
  const p = project.value;
  const ti = selectedTrack.value;
  const trackFull = hasContent(p.tracks[ti]!.patterns[to]);
  const anyFull = p.tracks.some((t) => hasContent(t.patterns[to]));
  const done = (fn: () => void) => () => { fn(); props.onClose(); };
  // Overwriting a pattern that has content asks first.
  const guard = (full: boolean, label: string, fn: () => void) => () => (full ? setConfirm({ label, run: done(fn) }) : done(fn)());
  if (confirm) {
    return (
      <Sheet title={`Pattern ${to}`} onClose={props.onClose}>
        <p style={{ margin: 0, fontSize: '14px' }}>{confirm.label}</p>
        <div class="row">
          <button class="btn" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Cancel</button>
          <button class="btn primary" style={{ flex: 1 }} onClick={confirm.run}>Replace</button>
        </div>
      </Sheet>
    );
  }
  const trackName = p.tracks[ti]!.name;
  return (
    <Sheet title={`Pattern ${to}`} onClose={props.onClose}>
      {from !== to && (
        <>
          <button class="btn" onClick={guard(trackFull, `Pattern ${to} on ${trackName} already has steps. Replace them with a copy of ${from}?`, () => apply({ type: 'copyPattern', track: ti, from, to }))}>
            Copy pattern {from} → {to} ({trackName} only)
          </button>
          <button class="btn" onClick={guard(anyFull, `Pattern ${to} already has steps on some tracks. Replace them with a copy of ${from}?`, () => apply({ type: 'copyPattern', track: -1, from, to }))}>
            Copy pattern {from} → {to} (all tracks)
          </button>
        </>
      )}
      <button class="btn" disabled={!trackFull} onClick={done(() => apply(clearCommands('track', to)))}>Clear {to} ({trackName} only)</button>
      <button class="btn" disabled={!anyFull} onClick={done(() => apply(clearCommands('all', to)))}>Clear {to} (all tracks)</button>
    </Sheet>
  );
}
