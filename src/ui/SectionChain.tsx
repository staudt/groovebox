import { project } from '../store/project';
import { songPos } from '../engine/host';
import { selectedSection } from '../app/songUi';

/** Width weight of a section chip by length (short sections stay tappable). */
export const sectionWeight = (bars: number): number => Math.min(3, Math.max(0.7, Math.sqrt(bars) / 1.6));

/** "bar 3 of 8" while a song plays, else the song length. */
export function songReadout(): string {
  const p = project.value;
  const pos = songPos.value;
  const sec = pos ? p.sections[pos.section] : undefined;
  if (pos && sec && p.playMode === 'song') return `bar ${pos.bar + 1} of ${sec.bars}`;
  const total = p.sections.reduce((n, s) => n + s.bars, 0);
  return `${total} bars`;
}

/**
 * The song as a chain of section chips sized by length. Amber with a progress bar = playing now
 * (from `songPos`); the outlined chip is the one selected for editing. Tap to select.
 */
export function SectionChain(props: { variant: 'phone' | 'desktop' }) {
  const p = project.value;
  const pos = p.playMode === 'song' ? songPos.value : null;
  const sel = Math.min(selectedSection.value, p.sections.length - 1);
  const d = props.variant === 'desktop';
  return (
    <div class={d ? 'dsk-chain sg-chain' : 'sg-chain'} role="group" aria-label="Section chain">
      {p.sections.map((s, i) => {
        const playing = pos?.section === i;
        const done = pos !== null && pos.section > i;
        return (
          <button
            key={s.id}
            class={d ? 'dsk-sec sg-sec' : 'sg-sec'}
            style={{ flexGrow: sectionWeight(s.bars) }}
            aria-pressed={i === sel}
            aria-label={`Section ${s.name}, ${s.bars} bars`}
            data-active={playing ? '' : undefined}
            data-done={done ? '' : undefined}
            onClick={() => { selectedSection.value = i; }}
          >
            <b>{s.name}</b>
            <span>{s.bars} bars</span>
            {playing && <i class="sg-prog" style={{ width: `${Math.round(((pos!.bar + 1) / s.bars) * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}
