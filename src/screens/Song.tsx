import { useEffect, useState } from 'preact/hooks';
import { apply, currentPattern, project } from '../store/project';
import { recallScene } from '../engine/host';
import { selectedSection, songView } from '../app/songUi';
import { SectionChain, songReadout } from '../ui/SectionChain';
import { MixView } from '../ui/MixView';
import { PressButton } from '../ui/PressButton';
import { Sheet } from '../ui/Sheet';
import { AskBar } from '../ui/AskBar';
import { JamPanel } from '../ui/JamPanel';
import { MAX_SECTIONS, currentMutes, cycleCell, deleteSection, duplicateSection, makeSection, moveSection, newId, patchSection, sameMutes, sceneName } from '../store/songEdit';
import type { Scene } from '../store/types';
import { songPos } from '../engine/host';
import '../ui/song.css';

function Seg(props: { label: string; items: { id: string; text: string; aria: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div class="sg-seg" role="group" aria-label={props.label}>
      {props.items.map((it) => (
        <button key={it.id} aria-label={it.aria} aria-pressed={props.value === it.id} onClick={() => props.onPick(it.id)}>{it.text}</button>
      ))}
    </div>
  );
}

function SectionEditor() {
  const p = project.value;
  const i = Math.min(selectedSection.value, p.sections.length - 1);
  const s = p.sections[i]!;
  const [name, setName] = useState(s.name);
  useEffect(() => { setName(s.name); }, [s.id, s.name]);
  const set = (sections: typeof p.sections) => apply({ type: 'setSections', sections });
  const commit = () => {
    const n = name.trim().slice(0, 20) || s.name;
    setName(n);
    if (n !== s.name) set(patchSection(p.sections, i, { name: n }));
  };
  const bars = (b: number) => set(patchSection(p.sections, i, { bars: Math.min(64, Math.max(1, b)) }));
  return (
    <div class="sg-editor" aria-label="Section editor">
      <div class="sg-edit-row">
        <input class="sg-name" aria-label="Section name" value={name} maxLength={20}
          onInput={(e) => setName(e.currentTarget.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <div class="sg-bars" role="group" aria-label="Bars">
          <button aria-label="Bars down" onClick={() => bars(s.bars - 1)}>−</button>
          <span class="mono" aria-label={`${s.bars} bars`} data-testid="section-bars">{s.bars}</span>
          <button aria-label="Bars up" onClick={() => bars(s.bars + 1)}>+</button>
        </div>
      </div>
      <div class="sg-edit-row sg-edit-actions">
        <button aria-label="Move section left" disabled={i === 0} onClick={() => { set(moveSection(p.sections, i, -1)); selectedSection.value = i - 1; }}>◀ Left</button>
        <button aria-label="Move section right" disabled={i === p.sections.length - 1} onClick={() => { set(moveSection(p.sections, i, 1)); selectedSection.value = i + 1; }}>Right ▶</button>
        <button aria-label="Duplicate section" disabled={p.sections.length >= MAX_SECTIONS} onClick={() => { set(duplicateSection(p.sections, i)); selectedSection.value = i + 1; }}>Copy</button>
        <button aria-label="Delete section" onClick={() => { set(deleteSection(p.sections, i)); selectedSection.value = Math.max(0, i - 1); }}>Delete</button>
      </div>
    </div>
  );
}

function Lanes() {
  const p = project.value;
  const pos = p.playMode === 'song' ? songPos.value : null;
  const sel = Math.min(selectedSection.value, p.sections.length - 1);
  return (
    <div class="sg-lanes" aria-label="Lane overview">
      {p.tracks.map((t) => (
        <div class="sg-lane" key={t.id}>
          <span class="sg-lane-name">{t.name}</span>
          {p.sections.map((s, si) => {
            const id = s.patternByTrack[t.id] ?? null;
            return (
              <button
                key={s.id}
                class="sg-cell"
                style={{ flexGrow: Math.min(3, Math.max(0.7, Math.sqrt(s.bars) / 1.6)) }}
                aria-label={`${t.name} in ${s.name}: ${id ? `pattern ${id}` : 'silent'}`}
                data-p={id ?? '-'}
                data-sel={si === sel ? '' : undefined}
                data-active={pos?.section === si ? '' : undefined}
                onClick={() => apply({ type: 'setSections', sections: cycleCell(p.sections, si, t.id) })}
              >{id ?? '–'}</button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Scenes() {
  const p = project.value;
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div class="sg-scenes" role="group" aria-label="Scenes">
      <span class="sg-scenes-label">Scenes</span>
      <div class="sg-scene-chips">
        {p.scenes.map((s) => (
          <PressButton key={s.id} class="sg-scene" aria-pressed={sameMutes(p, s)} aria-label={`Recall ${s.name}`}
            title="Tap to recall at the next bar, hold to edit"
            onTap={() => recallScene(s)} onLong={() => setEdit(s.id)}>{s.name}</PressButton>
        ))}
        <button class="sg-scene sg-add" aria-label="Add scene" title="New scene from the current mutes"
          onClick={() => apply({ type: 'setScenes', scenes: [...p.scenes, { id: newId('sc'), name: sceneName(p.scenes), mutes: currentMutes(p) }] })}>+</button>
      </div>
      {edit && <SceneSheet id={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SceneSheet(props: { id: string; onClose: () => void }) {
  const p = project.value;
  const scene = p.scenes.find((s) => s.id === props.id);
  const [name, setName] = useState(scene?.name ?? '');
  if (!scene) return null;
  const replace = (next: Scene | null) => apply({ type: 'setScenes', scenes: p.scenes.flatMap((s) => (s.id === scene.id ? (next ? [next] : []) : [s])) });
  const rename = () => {
    const n = name.trim().slice(0, 20);
    if (n && n !== scene.name) replace({ ...scene, name: n });
  };
  return (
    <Sheet title={`Scene ${scene.name}`} onClose={() => { rename(); props.onClose(); }}>
      <button class="btn primary" onClick={() => { replace({ ...scene, mutes: currentMutes(p) }); props.onClose(); }}>Save current mutes into this scene</button>
      <input class="sg-name" aria-label="Scene name" value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { rename(); props.onClose(); } }} />
      <button class="btn" onClick={() => { replace(null); props.onClose(); }}>Delete scene</button>
    </Sheet>
  );
}

function Arrangement() {
  const p = project.value;
  if (p.sections.length === 0) {
    return (
      <div class="sg-empty">
        <p>No song yet. A song is a chain of sections; each section says which pattern every track plays.</p>
        <button class="btn primary" onClick={() => { apply({ type: 'setSections', sections: [makeSection(p, currentPattern.value, 4, 'Sec 1')] }); selectedSection.value = 0; }}>
          Create a song from the current loop
        </button>
      </div>
    );
  }
  const add = () => {
    apply({ type: 'setSections', sections: [...p.sections, makeSection(p, currentPattern.value)] });
    selectedSection.value = p.sections.length;
  };
  return (
    <>
      <div class="sg-chain-row">
        <SectionChain variant="phone" />
        <button class="sg-add-sec" aria-label="Add section" disabled={p.sections.length >= MAX_SECTIONS} onClick={add}>+</button>
      </div>
      <div class="sg-readout mono" data-testid="song-readout" aria-live="off">{songReadout()}</div>
      <SectionEditor />
      <Lanes />
    </>
  );
}

/** Song screen: loop/song mode, the arrangement (sections, lanes, scenes) or the mixer. */
export function Song(props: { desktop?: boolean } = {}) {
  const p = project.value;
  const view = songView.value;
  return (
    <div class={props.desktop ? 'sg sg-desktop' : 'sg'} data-view={view}>
      <div class="sg-head">
        <Seg label="Play mode" value={p.playMode} onPick={(id) => { if (id !== p.playMode) apply({ type: 'setPlayMode', mode: id === 'song' ? 'song' : 'loop' }); }}
          items={[{ id: 'loop', text: 'Loop', aria: 'Loop mode' }, { id: 'song', text: 'Song', aria: 'Song mode' }]} />
        <Seg label="Song view" value={view} onPick={(id) => { songView.value = id === 'mix' ? 'mix' : 'arrange'; }}
          items={[{ id: 'arrange', text: 'Arrangement', aria: 'Arrangement view' }, { id: 'mix', text: 'Mix', aria: 'Mix view' }]} />
      </div>
      {view === 'mix' ? <MixView /> : <Arrangement />}
      {view === 'arrange' && <Scenes />}
      {view === 'arrange' && <JamPanel />}
      {view === 'arrange' && <AskBar />}
    </div>
  );
}
