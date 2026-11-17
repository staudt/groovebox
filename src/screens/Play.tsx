import { useEffect, useState } from 'preact/hooks';
import { currentPattern, selectedTrack, track } from '../store/project';
import { StepGrid } from '../ui/StepGrid';
import { PageBar } from '../ui/PageBar';
import { Macros } from '../ui/Macros';
import { AskBar } from '../ui/AskBar';
import { RhythmPanel } from '../ui/RhythmPanel';
import { KeyboardDrawer } from '../ui/KeyboardDrawer';
import { isMelodic } from '../store/defaults';
import { ASSISTANT_ENABLED } from '../app/features';
import { SoloButton } from '../ui/SoloButton';
import { PatternChips } from '../ui/PatternChips';
import { openCapture } from '../capture/session';

/** `desktop`: the desktop shell lays the grid beside the macros and owns the keyboard and the Capture card. */
export function Play(props: { desktop?: boolean } = {}) {
  const [rhythmOpen, setRhythmOpen] = useState(false);
  // Changing track or pattern closes the panel and keeps the result.
  useEffect(() => { setRhythmOpen(false); }, [selectedTrack.value, currentPattern.value]);
  if (props.desktop) {
    return (
      <div class="dsk-play">
        <div class="dsk-play-head">
          <span data-testid="track-title" style={{ fontSize: '15px', fontWeight: 700, flexGrow: 1 }}>{track.value.name}<span class="hint-wide"> · 16 steps</span></span>
          <PatternChips />
          <button class="solo-btn" aria-pressed={rhythmOpen} onClick={() => setRhythmOpen((o) => !o)}>Rhythm</button>
          <SoloButton />
        </div>
        <div class="dsk-play-body">
          <div class="dsk-play-grid"><PageBar length={track.value.patterns[currentPattern.value].length} /><StepGrid /></div>
          <div class="dsk-play-side">
            {rhythmOpen ? <RhythmPanel onClose={() => setRhythmOpen(false)} /> : <Macros />}
            {ASSISTANT_ENABLED && <AskBar />}
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
        {/* On narrow phones the title would truncate to "B.."; the track strip already shows the selection,
            so it is only visually hidden there (still read by screen readers). */}
        <span class="track-title" data-testid="track-title" style={{ fontSize: '15px', fontWeight: 700, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.value.name}</span>
        <PatternChips />
        <button aria-label="Capture" onClick={openCapture} style={{ flexShrink: 0, height: '44px', minWidth: '44px', justifyContent: 'center', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--assist-border)', background: 'var(--assist-bg)', color: 'var(--assist-text)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="9" rx="2.5" /><path d="M3 8 a5 5 0 0 0 10 0 M8 13 v2" /></svg><span class="cap-label">Capture</span>
        </button>
        <button class="solo-btn" aria-pressed={rhythmOpen} onClick={() => setRhythmOpen((o) => !o)}>Rhythm</button>
        <SoloButton />
      </div>
      <PageBar length={track.value.patterns[currentPattern.value].length} />
      <StepGrid />
      {rhythmOpen ? <RhythmPanel onClose={() => setRhythmOpen(false)} /> : <Macros />}
      {ASSISTANT_ENABLED && <AskBar />}
      {isMelodic(track.value) && <KeyboardDrawer initialLayout="scale" trackIndex={selectedTrack.value} />}
    </>
  );
}
