// Project sheet (tap the project name): rename, switch / duplicate / delete projects, version history, export.
// "New project" creates another project (the old one stays in the list) and is undoable from a toast
// for a few seconds (phones have no undo button yet).
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { apply, currentPattern, playing, project, selectedStep, selectedTrack, soloSelected } from '../store/project';
import {
  type ProjectInfo,
  type VersionInfo,
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  listVersions,
  openProject,
  restoreVersion,
} from '../store/persist';
import { releaseAllFx } from '../app/fxState';
import { exportStems, exportWav } from '../app/export';
import { Sheet } from './Sheet';

const UNDO_MS = 8000;
/** Visible "New project · Undo" toast, or null. */
export const resetToast = signal<{ until: number; prevId: string; newId: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Puts selection, transport and FX back to a neutral state after the open project changed. */
function resetUi(): void {
  releaseAllFx();
  playing.value = false;
  soloSelected.value = false;
  selectedStep.value = -1;
  selectedTrack.value = 0;
  currentPattern.value = 'A';
}

export async function startNewProject(): Promise<void> {
  const prevId = project.peek().id;
  resetUi();
  const p = await createProject();
  resetToast.value = { until: Date.now() + UNDO_MS, prevId, newId: p.id };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (resetToast.value = null), UNDO_MS);
}

/** Reopens the previous project and deletes the project that "New project" just created. */
export async function undoNewProject(): Promise<void> {
  const t = resetToast.value;
  resetToast.value = null;
  if (!t) return;
  resetUi();
  if (await openProject(t.prevId)) await deleteProject(t.newId);
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const kb = (n: number): string => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);
const note = { fontSize: '12px', color: 'var(--text-2)' } as const;
const box = { gap: '10px', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--raised)' } as const;

type Pending = { kind: 'delete'; id: string; name: string } | { kind: 'restore'; ts: number } | null;

export function ProjectSheet(props: { onClose: () => void }) {
  const [name, setName] = useState(project.value.name);
  const [confirm, setConfirm] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [open, setOpen] = useState<'projects' | 'history' | 'export' | null>('projects');
  const [pending, setPending] = useState<Pending>(null);
  const [bars, setBars] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cur = project.value;

  const refresh = async () => {
    setProjects(await listProjects());
    setVersions(await listVersions(project.peek().id));
  };
  useEffect(() => void refresh(), [cur.id]);

  const commitName = () => {
    if (name.trim() && name.trim() !== project.value.name) {
      apply({ type: 'setName', name });
      void refresh();
    }
  };
  const switchTo = async (id: string) => {
    commitName();
    resetUi();
    if (await openProject(id)) {
      setName(project.peek().name);
      void refresh();
    }
  };
  const Section = (p: { id: 'projects' | 'history' | 'export'; title: string; children: preact.ComponentChildren }) => (
    <div class="col" style={{ gap: '8px' }}>
      <button class="btn" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)} style={{ textAlign: 'left' }}>
        {open === p.id ? '▾' : '▸'} {p.title}
      </button>
      {open === p.id && p.children}
    </div>
  );
  const runExport = async (kind: 'wav' | 'stems') => {
    setMessage(null);
    setBusy('Rendering…');
    const onProgress = (_d: number, _t: number, label: string) => setBusy(`${label}…`);
    try {
      if (kind === 'wav') await exportWav(project.peek(), currentPattern.peek(), { bars, onProgress });
      else if (!(await exportStems(project.peek(), currentPattern.peek(), { bars, onProgress }))) setMessage('No track has notes to export.');
    } catch (e) {
      setMessage(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Project" onClose={() => { commitName(); props.onClose(); }}>
      <div class="col" style={{ gap: '14px', maxHeight: 'calc(100dvh - 120px)', overflowY: 'auto' }}>
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
          <div class="col" role="alertdialog" aria-label="Start a new project?" style={box}>
            <div style={{ fontSize: '14px' }}>Start a new project with the default song?</div>
            <div style={note}>Your current project stays in the Projects list. You can undo right after.</div>
            <div class="row" style={{ gap: '8px' }}>
              <button class="btn" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Cancel</button>
              <button class="btn primary" style={{ flex: 1 }} onClick={() => { void startNewProject(); props.onClose(); }}>Create project</button>
            </div>
          </div>
        )}

        <Section id="projects" title={`Projects (${projects.length})`}>
          {projects.map((p) => (
            <div key={p.id} class="row" style={{ gap: '6px' }} data-current={p.id === cur.id ? '1' : '0'}>
              <button
                class="btn"
                aria-label={p.id === cur.id ? `${p.name} (open)` : `Open ${p.name}`}
                aria-current={p.id === cur.id ? 'true' : undefined}
                disabled={p.id === cur.id}
                onClick={() => void switchTo(p.id)}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: p.id === cur.id ? 'var(--accent)' : undefined, color: 'var(--text)' }}
              >
                {p.id === cur.id ? '● ' : ''}{p.id === cur.id ? cur.name : p.name}
                <span style={{ ...note, marginLeft: '8px' }}>{relativeTime(p.updated)}</span>
              </button>
              <button class="btn square" aria-label={`Duplicate ${p.name}`} onClick={() => void duplicateProject(p.id).then(refresh)}>⧉</button>
              <button class="btn square" aria-label={`Delete ${p.name}`} disabled={projects.length < 2} onClick={() => setPending({ kind: 'delete', id: p.id, name: p.name })}>×</button>
            </div>
          ))}
          {pending?.kind === 'delete' && (
            <div class="col" role="alertdialog" aria-label="Delete project?" style={box}>
              <div style={{ fontSize: '14px' }}>Delete "{pending.name}" and its history?</div>
              <div class="row" style={{ gap: '8px' }}>
                <button class="btn" style={{ flex: 1 }} onClick={() => setPending(null)}>Cancel</button>
                <button class="btn primary" style={{ flex: 1 }} onClick={() => { const id = pending.id; setPending(null); void deleteProject(id).then(() => { setName(project.peek().name); return refresh(); }); }}>Delete</button>
              </div>
            </div>
          )}
        </Section>

        <Section id="history" title={`History (${versions.length})`}>
          {versions.length === 0 && <div style={note}>Versions appear here as you work (about one a minute, the last 20 are kept).</div>}
          {versions.map((v) => (
            <div key={v.ts} class="row" style={{ gap: '6px' }}>
              <span style={{ flex: 1, fontSize: '14px' }}>{relativeTime(v.ts)} <span class="mono" style={note}>{kb(v.size)}</span></span>
              <button class="btn" aria-label={`Restore version from ${relativeTime(v.ts)}`} onClick={() => setPending({ kind: 'restore', ts: v.ts })}>Restore</button>
            </div>
          ))}
          {pending?.kind === 'restore' && (
            <div class="col" role="alertdialog" aria-label="Restore this version?" style={box}>
              <div style={{ fontSize: '14px' }}>Replace the project with this version?</div>
              <div style={note}>Your current state is saved to the history first, and you can undo.</div>
              <div class="row" style={{ gap: '8px' }}>
                <button class="btn" style={{ flex: 1 }} onClick={() => setPending(null)}>Cancel</button>
                <button class="btn primary" style={{ flex: 1 }} onClick={() => { const ts = pending.ts; setPending(null); void restoreVersion(project.peek().id, ts).then(() => { setName(project.peek().name); return refresh(); }); }}>Restore</button>
              </div>
            </div>
          )}
        </Section>

        <Section id="export" title="Export">
          {cur.playMode === 'song' && cur.sections.length > 0 ? (
            <div style={note}>Song mode: the whole song once, plus a 2 s tail.</div>
          ) : (
            <div class="row" style={{ gap: '6px' }} role="group" aria-label="Bars to render">
              <span style={{ ...note, flex: 1 }}>Loop: bars to render (+ 2 s tail)</span>
              {[1, 2, 4, 8].map((n) => (
                <button key={n} class={`btn ${bars === n ? 'primary' : ''}`} aria-pressed={bars === n} style={{ padding: '0 12px' }} onClick={() => setBars(n)}>{n}</button>
              ))}
            </div>
          )}
          <div class="row" style={{ gap: '8px' }}>
            <button class="btn" style={{ flex: 1 }} disabled={busy !== null} onClick={() => void runExport('wav')}>Export WAV</button>
            <button class="btn" style={{ flex: 1 }} disabled={busy !== null} onClick={() => void runExport('stems')}>Export stems</button>
          </div>
          {busy && <div role="status" aria-label="Export progress" class="mono" style={note}>{busy}</div>}
          {message && <div role="alert" style={{ ...note, color: 'var(--fx, #FF6B5E)' }}>{message}</div>}
        </Section>
      </div>
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
      <button class="btn" onClick={() => void undoNewProject()}>Undo</button>
    </div>
  );
}
