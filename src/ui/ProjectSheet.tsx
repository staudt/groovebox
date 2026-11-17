// Project sheet (tap the project name): rename, and start a new project.
// "New project" is undoable from a toast for a few seconds (phones have no undo button yet).
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { apply, currentPattern, playing, project, selectedStep, selectedTrack, soloSelected, undo } from '../store/project';
import { defaultProject } from '../store/defaults';
import { releaseAllFx } from '../app/fxState';
import { Sheet } from './Sheet';

const UNDO_MS = 8000;
/** Visible "New project · Undo" toast, or null. */
export const resetToast = signal<{ until: number } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function startNewProject(): void {
  releaseAllFx();
  playing.value = false;
  soloSelected.value = false;
  selectedStep.value = -1;
  selectedTrack.value = 0;
  currentPattern.value = 'A';
  apply({ type: 'replaceProject', project: defaultProject() });
  resetToast.value = { until: Date.now() + UNDO_MS };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (resetToast.value = null), UNDO_MS);
}

export function undoNewProject(): void {
  undo();
  resetToast.value = null;
}

export function ProjectSheet(props: { onClose: () => void }) {
  const [name, setName] = useState(project.value.name);
  const [confirm, setConfirm] = useState(false);
  const commitName = () => {
    if (name.trim() && name.trim() !== project.value.name) apply({ type: 'setName', name });
  };
  return (
    <Sheet title="Project" onClose={() => { commitName(); props.onClose(); }}>
      <label class="col" style={{ gap: '6px', fontSize: '13px', color: 'var(--text-2)' }}>
        Name
        <input
          aria-label="Project name"
          value={name}
          maxLength={40}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitName(); (e.currentTarget as HTMLInputElement).blur(); } }}
          style={{ height: '44px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--raised)', color: 'var(--text)', padding: '0 12px', fontSize: '16px' }}
        />
      </label>
      {!confirm ? (
        <button class="btn" onClick={() => setConfirm(true)}>New project…</button>
      ) : (
        <div class="col" role="alertdialog" aria-label="Start a new project?" style={{ gap: '10px', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--raised)' }}>
          <div style={{ fontSize: '14px' }}>Start over with the default song?</div>
          <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>
            Patterns, sounds, tempo, key and FX moves go back to the defaults. Your saved patches and samples stay in your library. You can undo right after.
          </div>
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Cancel</button>
            <button class="btn primary" style={{ flex: 1 }} onClick={() => { startNewProject(); props.onClose(); }}>Start over</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Bottom toast offering Undo after New project. Mount once in the app shell. */
export function ResetToast() {
  const t = resetToast.value;
  if (!t) return null;
  return (
    <div role="status" class="reset-toast">
      <span>New project</span>
      <button class="btn" onClick={undoNewProject}>Undo</button>
    </div>
  );
}
