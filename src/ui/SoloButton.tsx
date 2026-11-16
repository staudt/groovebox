import { soloSelected } from '../store/project';

/** Toggles monitoring solo: only the selected track is heard, following the selection. */
export function SoloButton() {
  const on = soloSelected.value;
  return (
    <button
      class="solo-btn"
      aria-pressed={on}
      aria-label="Solo the selected track"
      title="Solo: hear only the track you are editing"
      onClick={() => (soloSelected.value = !on)}
    >
      Solo
    </button>
  );
}
