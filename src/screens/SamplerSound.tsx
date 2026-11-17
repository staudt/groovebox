import { useState } from 'preact/hooks';
import { apply, selectedTrack, track } from '../store/project';
import type { SamplerParams } from '../store/types';
import { midiToNote } from '../store/notation';
import { samplerAttackS, samplerReleaseS } from '../engine/sampler/voice';
import { audition } from '../engine/host';
import { DragValue } from '../ui/DragValue';
import { KeyboardDrawer } from '../ui/KeyboardDrawer';
import { SoloButton } from '../ui/SoloButton';
import { Waveform } from '../ui/Waveform';
import { SampleBrowser, type BrowserTab } from '../ui/SampleBrowser';

const fmtMs = (s: number) => (s < 0.1 ? `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms` : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);

/** Sound screen panel for sampler tracks. */
export function SamplerSound(props: { p: SamplerParams; embedded?: boolean }) {
  const t = selectedTrack.value;
  const p = props.p;
  const [browse, setBrowse] = useState<BrowserTab | null>(null);
  const set = (patch: Partial<Omit<SamplerParams, 'kind'>>, merge = false) => apply({ type: 'setSampler', track: t, patch }, { merge });
  const play = () => void audition(t, 100);
  const chromatic = p.mode === 'chromatic';

  return (
    <>
      <div class="sn-head">
        <div class="sn-title">
          <button class="sn-name" data-testid="sample-name" aria-label={`Sample: ${p.sampleId ? p.name : 'none'}. Browse samples`} onClick={() => setBrowse('kit')}>
            {p.sampleId ? p.name : 'No sample'} ▾
          </button>
          <span class="sn-sub">{track.value.name} · sampler</span>
        </div>
        <button class="sn-btn" aria-label="Audition" disabled={!p.sampleId} onClick={play}>▶ Play</button>
        {!props.embedded && <SoloButton />}
      </div>

      {!p.sampleId ? (
        <div class="sn-card sn-empty" data-testid="sampler-empty">
          <span class="sn-card-title">Pick a sound</span>
          <p>This track has no sample yet. Choose one from the kit, record with the mic, or import a file.</p>
          <div class="sn-row-actions" style={{ alignSelf: 'stretch' }}>
            <button class="btn primary" onClick={() => setBrowse('kit')}>Kit</button>
            <button class="btn" onClick={() => setBrowse('record')}>Record</button>
            <button class="btn" onClick={() => setBrowse('yours')}>Import</button>
          </div>
        </div>
      ) : (
        <>
          <div class="sn-card">
            <div class="sn-card-head">
              <span class="sn-card-title">Trim</span>
              <span class="sn-mono" data-testid="trim-readout">{Math.round(p.start * 100)}% – {Math.round(p.end * 100)}%</span>
            </div>
            <Waveform sampleId={p.sampleId} start={p.start} end={p.end} onTrim={(patch, merge) => set(patch, merge)} />
          </div>

          <div class="sn-card">
            <div class="sn-grid">
              <DragValue label="Pitch" value={p.pitch} min={-24} max={24} step={1} span={240} fmt={(v) => (v > 0 ? '+' : '') + v + ' st'} onChange={(v, m) => set({ pitch: v }, m)} onCommit={play} testId="s-pitch" />
              <DragValue label="Level" value={p.level} min={0} max={1} step={0.01} fmt={(v) => Math.round(v * 100) + '%'} onChange={(v, m) => set({ level: v }, m)} onCommit={play} testId="s-level" />
              <DragValue label="Attack" value={p.attack} min={0} max={1} step={0.01} fmt={(v) => fmtMs(samplerAttackS(v))} onChange={(v, m) => set({ attack: v }, m)} onCommit={play} testId="s-attack" />
              <DragValue label="Release" value={p.release} min={0} max={1} step={0.01} fmt={(v) => fmtMs(samplerReleaseS(v))} onChange={(v, m) => set({ release: v }, m)} onCommit={play} testId="s-release" />
              {chromatic && (
                <DragValue label="Root" value={p.root} min={24} max={96} step={1} span={240} fmt={(v) => midiToNote(v)} onChange={(v, m) => set({ root: v }, m)} onCommit={play} testId="s-root" />
              )}
            </div>
            <div class="sn-chips">
              <button class="sn-chip" aria-pressed={p.reverse} onClick={() => { set({ reverse: !p.reverse }); setTimeout(play, 30); }}>Reverse</button>
              <button class="sn-chip" aria-pressed={!chromatic} onClick={() => set({ mode: 'oneshot' })}>One-shot</button>
              <button class="sn-chip" aria-pressed={chromatic} onClick={() => set({ mode: 'chromatic' })}>Chromatic</button>
            </div>
          </div>

          {chromatic && !props.embedded && (
            <div class="sn-kb-slot">
              <KeyboardDrawer initialLayout="piano" trackIndex={t} />
            </div>
          )}
        </>
      )}
      {browse && <SampleBrowser track={t} current={p.sampleId} initialTab={browse} onClose={() => setBrowse(null)} />}
    </>
  );
}
