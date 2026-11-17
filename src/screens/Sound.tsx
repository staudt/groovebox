import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { apply, selectedTrack, track } from '../store/project';
import type { DrumParams, FmOpKey, FmPatch, SamplerParams } from '../store/types';
import { FM_PRESETS, randomPatch } from '../store/fmPresets';
import { deletePatch, listPatches, savePatch } from '../store/persist';
import { ALGORITHMS, operatorRole } from '../engine/fm/algorithms';
import { audition, previewNotes } from '../engine/host';
import { Sheet } from '../ui/Sheet';
import { AlgDiagram } from '../ui/AlgDiagram';
import { DragValue } from '../ui/DragValue';
import { EnvelopeEditor, type EnvChange } from '../ui/EnvelopeEditor';
import { KeyboardDrawer } from '../ui/KeyboardDrawer';
import { SoloButton } from '../ui/SoloButton';
import { SamplerSound } from './SamplerSound';
import { ASSISTANT_ENABLED } from '../app/features';
import '../ui/sound.css';

const selOp = signal(0);
const PREVIEW_NOTE = 48;
const COARSE = [0.5, ...Array.from({ length: 31 }, (_, i) => i + 1)];

const preview = (t: number) => void previewNotes(t, [PREVIEW_NOTE], 100, 450);

function PatchBrowser(props: { patch: FmPatch; onClose: () => void }) {
  const [user, setUser] = useState<FmPatch[]>([]);
  const refresh = () => void listPatches().then(setUser);
  useEffect(refresh, []);
  const load = (p: FmPatch) => {
    const t = selectedTrack.value;
    apply({ type: 'setFmPatch', track: t, patch: structuredClone(p) });
    preview(t);
    props.onClose();
  };
  const item = (p: FmPatch, deletable: boolean) => (
    <div class="sn-item" key={(deletable ? 'u:' : 'f:') + p.name}>
      <button class="load" aria-label={`Load ${p.name}`} aria-current={p.name === props.patch.name} onClick={() => load(p)}>
        <span>{p.name}</span><small>ALG {p.algorithm}</small>
      </button>
      {deletable && (
        <button class="btn square" aria-label={`Delete ${p.name}`} onClick={() => void deletePatch(p.name).then(refresh)}>×</button>
      )}
    </div>
  );
  return (
    <Sheet title="Patches" onClose={props.onClose}>
      <div class="sn-list">
        <h4>Factory</h4>
        {FM_PRESETS.map((p) => item(p, false))}
        <h4>Your patches</h4>
        {user.length === 0 && <span class="sn-sub" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}>None saved yet</span>}
        {user.map((p) => item(p, true))}
      </div>
    </Sheet>
  );
}

function SaveSheet(props: { patch: FmPatch; onClose: () => void }) {
  const [name, setName] = useState(props.patch.name);
  const clean = name.trim().slice(0, 32);
  const save = async () => {
    if (!clean) return;
    const p: FmPatch = { ...structuredClone(props.patch), name: clean };
    await savePatch(p);
    apply({ type: 'setFmPatch', track: selectedTrack.value, patch: p });
    props.onClose();
  };
  return (
    <Sheet title="Save patch" onClose={props.onClose}>
      <input class="sn-text" aria-label="Patch name" value={name} maxLength={32} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
      <button class="btn primary" disabled={!clean} onClick={() => void save()}>Save</button>
    </Sheet>
  );
}

/** Coarse ratio as a DragValue over the step list 0.5, 1..31 (index 0..31). */
function CoarseRatio(props: { ratio: number; onChange: (v: number, merge: boolean) => void }) {
  const r = props.ratio;
  const coarse = r < 1 ? 0.5 : Math.floor(r);
  const fine = r - coarse;
  const idx = Math.max(0, COARSE.indexOf(coarse));
  return (
    <DragValue label="Coarse" aria="Coarse ratio" value={idx} min={0} max={COARSE.length - 1} step={1} span={160}
      fmt={(i) => '×' + COARSE[i]} testId="coarse"
      onChange={(i, m) => {
        const c = COARSE[i]!;
        props.onChange(Math.round((c + (c < 1 ? Math.min(fine, 0.49) : fine)) * 100) / 100, m);
      }} />
  );
}

function FmSound(props: { patch: FmPatch }) {
  const t = selectedTrack.value;
  const patch = props.patch;
  const [browse, setBrowse] = useState(false);
  const [save, setSave] = useState(false);
  const si = Math.min(5, selOp.value);
  const o = patch.ops[si]!;

  const setOp = (key: FmOpKey, value: number, merge = false) => apply({ type: 'setFmOp', track: t, op: si, key, value }, { merge });
  const setEnv = (c: EnvChange, merge: boolean) => {
    const cmds = (Object.keys(c) as (keyof EnvChange)[]).map((key) => ({ type: 'setFmOp' as const, track: t, op: si, key, value: c[key]! }));
    apply(cmds, { merge });
  };
  const fine = o.ratio < 1 ? o.ratio - 0.5 : o.ratio - Math.floor(o.ratio);
  const coarse = o.ratio < 1 ? 0.5 : Math.floor(o.ratio);
  const alg = patch.algorithm;
  const f2 = (v: number) => v.toFixed(2);

  return (
    <>
      <div class="sn-head">
        <div class="sn-title">
          <button class="sn-name" data-testid="patch-name" aria-label={`Patch: ${patch.name}. Browse patches`} onClick={() => setBrowse(true)}>{patch.name} ▾</button>
          <span class="sn-sub">{track.value.name} · FM 6-op</span>
        </div>
        <button class="sn-btn" onClick={() => {
          apply({ type: 'setFmPatch', track: t, patch: randomPatch(Math.random, (a) => ALGORITHMS[a - 1]!.carriers) });
          preview(t);
        }}>Random</button>
        <button class="sn-btn" onClick={() => setSave(true)}>Save</button>
        <SoloButton />
      </div>

      <div class="sn-card sn-alg">
        <div class="sn-card-head">
          <span class="sn-card-title">Algorithm</span>
          <button class="sn-nav" aria-label="Previous algorithm" disabled={alg <= 1} onClick={() => apply({ type: 'setFmGlobal', track: t, key: 'algorithm', value: alg - 1 })}>‹</button>
          <span class="sn-mono" data-testid="alg-num">{String(alg).padStart(2, '0')} / 32</span>
          <button class="sn-nav" aria-label="Next algorithm" disabled={alg >= 32} onClick={() => apply({ type: 'setFmGlobal', track: t, key: 'algorithm', value: alg + 1 })}>›</button>
          <span class="sn-fb">FB</span>
          <button class="sn-nav" aria-label="Feedback down" disabled={patch.feedback <= 0} onClick={() => apply({ type: 'setFmGlobal', track: t, key: 'feedback', value: patch.feedback - 1 })}>‹</button>
          <span class="sn-mono" data-testid="fb-num">{patch.feedback}</span>
          <button class="sn-nav" aria-label="Feedback up" disabled={patch.feedback >= 7} onClick={() => apply({ type: 'setFmGlobal', track: t, key: 'feedback', value: patch.feedback + 1 })}>›</button>
        </div>
        <AlgDiagram patch={patch} selected={si} onSelect={(i) => { selOp.value = i; }} />
      </div>

      <div class="sn-card">
        <div class="sn-opmeta">
          <b data-testid="op-title">OP{si + 1}</b>
          <span class="sn-role" data-testid="op-role">{operatorRole(alg, si + 1)}</span>
          {/* 44 px operator switching: on short screens the scaled diagram's boxes are small to tap. */}
          <button class="sn-opnav" aria-label="Previous operator" onClick={() => { selOp.value = (si + 5) % 6; }}>‹</button>
          <button class="sn-opnav" aria-label="Next operator" onClick={() => { selOp.value = (si + 1) % 6; }}>›</button>
        </div>
        <div class="env-wrap">
        <EnvelopeEditor op={o} onChange={setEnv} />
        <div class="env-labels">
          {(['a', 'd', 's', 'r'] as const).map((k, i) => (
            <span key={k}>{['ATK', 'DEC', 'SUS', 'REL'][i]} <b data-testid={`env-${k}`}>{o[k].toFixed(2)}</b></span>
          ))}
        </div>
        </div>
        <div class="sn-vals">
            <CoarseRatio ratio={o.ratio} onChange={(v, m) => setOp('ratio', v, m)} />
            <DragValue label="Fine" value={Math.round(fine * 100) / 100} min={0} max={coarse < 1 ? 0.49 : 0.99} step={0.01} span={220} fmt={(v) => '+' + f2(v)}
              onChange={(v, m) => setOp('ratio', coarse + v, m)} testId="fine" />
          <DragValue label="Level" value={o.level} min={0} max={99} step={1} onChange={(v, m) => setOp('level', v, m)} onCommit={() => preview(t)} testId="level" />
          <DragValue label="Detune" value={o.detune} min={-7} max={7} step={1} span={140} fmt={(v) => (v > 0 ? '+' + v : String(v))} onChange={(v, m) => setOp('detune', v, m)} testId="detune" />
          <DragValue label="Vel sens" value={o.velSens} min={0} max={7} step={1} span={140} onChange={(v, m) => setOp('velSens', v, m)} testId="velsens" />
        </div>
      </div>

      {ASSISTANT_ENABLED && <><div class="sn-assist" aria-disabled="true">
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="#5CC8FF" stroke-width="1.6" stroke-linecap="round"><path d="M9 2 L10.6 7.4 L16 9 L10.6 10.6 L9 16 L7.4 10.6 L2 9 L7.4 7.4 Z" /></svg>
        <input aria-label="Describe a sound" placeholder="Describe a sound: glassy bell, slow attack…" disabled />
        <button disabled>Make</button>
      </div>
      <div class="sn-note">Arrives with the assistant (Phase 6)</div></>}

      <div class="sn-kb-slot">
        <KeyboardDrawer initialLayout="piano" trackIndex={selectedTrack.value} />
      </div>

      {browse && <PatchBrowser patch={patch} onClose={() => setBrowse(false)} />}
      {save && <SaveSheet patch={patch} onClose={() => setSave(false)} />}
    </>
  );
}

const MODELS = ['kick', 'snare', 'hat', 'perc'] as const;
const DRUM_KEYS: { key: Exclude<keyof DrumParams, 'model'>; label: string; min: number; max: number; step: number }[] = [
  { key: 'tune', label: 'Tune', min: -12, max: 12, step: 0.5 },
  { key: 'decay', label: 'Decay', min: 0, max: 1, step: 0.01 },
  { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01 },
  { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01 },
  { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01 },
];

function DrumSlider(props: { track: number; p: DrumParams; def: (typeof DRUM_KEYS)[number] }) {
  const { def } = props;
  const [first] = useState({ v: true });
  const v = props.p[def.key];
  return (
    <div class="sn-slider">
      <label for={`dr-${def.key}`}>{def.label}</label>
      <input
        id={`dr-${def.key}`}
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={v}
        onInput={(e) => {
          apply({ type: 'setDrumParam', track: props.track, key: def.key, value: Number((e.target as HTMLInputElement).value) }, { merge: !first.v });
          first.v = false;
        }}
        onChange={(e) => {
          first.v = true;
          (e.target as HTMLInputElement).blur();
          void audition(props.track, 100);
        }}
      />
      <output>{def.key === 'tune' ? (v > 0 ? '+' : '') + v.toFixed(1) : v.toFixed(2)}</output>
    </div>
  );
}

function DrumSound(props: { p: DrumParams }) {
  const t = selectedTrack.value;
  return (
    <>
      <div class="sn-head">
        <div class="sn-title">
          <span class="sn-name" style={{ lineHeight: '24px' }}>{track.value.name}</span>
          <span class="sn-sub">drum synth</span>
        </div>
        <SoloButton />
      </div>
      <div class="sn-card">
        <span class="sn-card-title">Model</span>
        <div class="sn-chips">
          {MODELS.map((m) => <button key={m} class="sn-chip" aria-pressed={props.p.model === m} aria-disabled="true" title="Model change arrives later">{m}</button>)}
        </div>
        {DRUM_KEYS.map((d) => <DrumSlider key={d.key} track={t} p={props.p} def={d} />)}
      </div>
    </>
  );
}

export function Sound() {
  const tr = track.value;
  return (
    <>
      {tr.kind === 'fm' && <FmSound patch={tr.params as FmPatch} />}
      {tr.kind === 'drum' && <DrumSound p={tr.params as DrumParams} />}
      {tr.kind === 'sampler' && <SamplerSound p={tr.params as SamplerParams} />}
    </>
  );
}
