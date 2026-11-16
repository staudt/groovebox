# Progress

## Phase 2: FM synth (2026-11-16) — awaiting phone check

**Built**
- FM engine (`src/engine/fm/`): 6 operators, the 32 DX7-style algorithms (written from the published diagrams), feedback, ratio/detune/level/ADSR/velocity sensitivity per operator, 8 notes of polyphony per track with click-free voice stealing, sine table lookup, silent operators skipped.
- Sequencing: note steps, holds (legato until the last hold), chord steps (up to 6 notes), live notes from the keyboard; Stop releases sequenced notes.
- Sound screen per `Sound.dc.html`: patch browser (9 factory patches + your saved ones), Random, Save, algorithm diagram for all 32 algorithms, operator editor, draggable envelope, drum parameter panel, piano keyboard drawer with Hold. "Describe a sound" is shown disabled until Phase 6.
- Play screen for melodic tracks: note / hold / chord steps, drag right to hold, long-press note and chord picker (diatonic triads and sevenths), scale keyboard drawer; keys write into the selected step. Desktop musical typing (A–K, W E T Y U, Z/X octave, backtick hold).
- Macros on FM tracks: Tone (modulator levels), Decay (envelope times), Drive.
- **Pulled forward from Phase 4 (user decision):** project autosave and restore on reload (IndexedDB), plus the user patch library.
- **Added on request:** a Solo toggle at the left of the track strip that isolates the track being edited and follows the selection (listening aid; not saved, not undoable).
- Default song now has a bass line (Round Bass) and pad chords (Soft Pad) in C minor.

**Verified automatically**
- 167 unit tests: FM pitch within 5 cents (several notes, ratios, detune), every operator of all 32 algorithms changes the output iff it reaches a carrier, FM and feedback add harmonics, attack/decay/sustain/release timing, holds as legato, chord notes present, note onsets within 1 ms, no stuck notes after Stop, 14 rapid notes steal voices without clicks, every factory patch plays under 0 dBFS without clicks, solo isolates and fades cleanly, theory (scales, diatonic chords), persistence (project and patch library), algorithm diagram layout for all 32.
- 64 Playwright tests at 390x844 and 1280x800, including Sound screen editing, saving a patch and finding it after reload, melodic editing, the picker and solo.
- CPU: headless desktop Chromium, worst case (4 drum tracks on every 16th + 8 FM voices with all 6 operators) = 6.3 % of one core. `bench.html` on the deployed site measures the real phone.

**Needs a human**
- Run https://staudt.github.io/groovebox/bench.html on the phone (decides whether FM needs WASM later).
- By ear: all 9 FM presets (they were written without listening), envelope and macro response, chords, holds, stealing when playing many keys.
- By touch: drag-right holds across rows, long-press picker, envelope handles, keyboard multi-touch, Solo.

## Phase 1: Engine skeleton (2026-11-16) — accepted on the phone

**Built**
- Vite + TS strict + Preact/signals, installable PWA (manifest, icons, build-time service worker; offline after first load, verified with the network cut).
- One AudioWorklet (`src/engine/worklet.ts`) hosting the pure-TS engine (`src/engine/core.ts`): sample-counting clock anchored on tempo changes, step sequencer (16th swing 50–75 %, per-step velocity, chance, nudge), synthesized drum voice with four models (kick, snare, hat, perc; tune, decay, tone, level, drive), 3 voices per track with click-free stealing, per-track smoothed level/mute, lookahead master limiter with a proven ceiling.
- Store: one signal-based project, every mutation is a command with an inverse (undo/redo, merged drags).
- Play screen per `Main.dc.html`: transport (BPM sheet with tap tempo and swing), 8-track strip (BASS/KEYS/PAD/VOX visible but locked until Phase 2/3), 4x4 step grid (tap, long-press for velocity and chance), Euclid fill, four macros (Space inert until the mixer), disabled Ask bar and Capture, bottom nav. Playhead drawn from rAF, not renders.
- Desktop keys: Space play/stop, Ctrl+Z / Ctrl+Shift+Z, Tab next track.

**Verified automatically**
- 67 unit tests (`pnpm test`): onsets within 1 ms of the grid at 60–200 BPM and 44.1/48 kHz, no drift over 64 bars, identical output for any block size, swing and nudge offsets, steady across tempo changes, no clicks (default beat, voice stealing at 240 BPM, mute toggles, stop mid-note), limiter never needs its safety clamp, store undo/redo, notation round-trip, Euclid.
- 22 Playwright tests (`pnpm test:e2e`): the real worklet rendered in headless Chromium (timing, clicks, ceiling) and Play screen flows at 390x844 and 1280x800.
- CPU (`pnpm bench`): worst case (4 drum tracks on every 16th at 200 BPM) is 1.8 % of one desktop core.

**Needs a human**
- Sound and feel: `pnpm render:demo` writes WAVs to `renders/`; on the phone, `pnpm dev:lan` and open https://<pc-ip>:5180 (the firewall must allow 5180 from the LAN: `sudo ufw allow from 10.0.0.0/24 to any port 5180 proto tcp`).
- Steady timing and no clicks on a real mid-range Android phone, touch feel of long-press and knobs.

**Notes / decisions**
- `../beatboy` (same author, MIT; samples CC0) supplied toolchain versions, the licence-notices script and audio unlock. Its CC0 acoustic kit is earmarked for the Phase 3 sampler; its main-thread scheduler is not used (the clock lives in the worklet).
- The "Euclid" button in the mockup is a Euclidean fill (hits, rotate) for drum tracks.
- PERC plays the synth perc voice until the sampler exists.
- Service worker only registers in production builds. Over the self-signed LAN cert it will not register (Chrome refuses); the GitHub Pages deploy (https://staudt.github.io/groovebox/, from `master`) is the place to test install and offline.
- Engine modules are excluded from Preact's dev transform (its HMR glue breaks the worklet scope).
