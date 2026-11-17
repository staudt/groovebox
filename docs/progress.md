# Progress

## Phase 5: Capture and harmony (2026-11-17) — awaiting phone check and real recordings

**Built**
- Live tracker: YIN on 16 kHz audio at 100 fps, clarity threshold, 5-frame median; precise from 82 Hz to 3 kHz (multi-period refinement for whistles). Runs in a Web Worker fed by its own AudioWorklet tap; drives the note readout, tuning bar and pitch trace.
- Final transcription: Spotify Basic Pitch (TF.js, model 900 KB), lazy-loaded on first capture and precached for offline, in every mode; monophonic cleanup merges vibrato fragments and glides and fixes late onsets. Falls back to the live tracker. Place says "transcribed" or "tracked".
- Segmentation (pitch jumps, energy dips for consonants, < 80 ms dropped), quantize (1/8 or 1/16), Krumhansl-Schmuckler key detection, auto-fit to the project key by the smallest interval (mode-aware: A minor hummed into C minor = +3), chromatic and in-key shifts, out-of-key warning with one-tap fit.
- Harmony engine: diatonic triads and sevenths scored per bar by chord tones weighted by duration and beat, transition tables for Pop / Melancholy / Jazzy, Viterbi, minimal-movement voicing; outputs PAD chords, BASS roots and a 2nd voice (a third or sixth below, in key). Deterministic, well under 50 ms.
- Capture and Place screens per `Hum.dc.html` / `HumPlace.dc.html` (Capture button on Play, desktop card, `R`); count-in and click on the audio clock; latency calibration (6 clicks, median, stored per device) applied to captures; Place previews through the engine; Place writes melody, chords, bass and 2nd voice in one undo step; "Keep as clip" saves the take as a sample.
- Pattern pages: 32/64-step patterns (a 2-bar capture is 32 steps) show page tabs on Play.
- Fixture recorder page (`fixture.html`) for the user's real recordings, scored instantly.

**Agreed accuracy targets** (user, 2026-11-17): voice, whistle and single-note guitar at least 90 % of notes; strummed chords at least 75 %. A note is right when the pitch matches and it starts within 50 ms (whistle octave normalized). Recordings made against the click on the fixture page are scored on the 1/8 grid after an automatic offset search, since human timing varies more than 50 ms.

**Verified automatically**
- Synthetic fixtures (sung "da", hum, whistle two octaves up, guitar, noisy 44.1 kHz voice, strummed chords): live tracker >= 90 % on all mono fixtures; Basic Pitch 100 % on all six.
- Harmony: I-IV-V-I under an arpeggiated melody, styles differ (Jazzy uses sevenths, Pop never), voice leading moves <= 8 semitones, 2nd voice in key, deterministic, fast.
- 282 unit tests, 229 Playwright tests incl. a fake-microphone capture end to end (Basic Pitch ran in the browser), latency calibration, pages, and every screen fitting 360x640 to 412x915.

**Needs a human**
- Real recordings for `tests/fixtures/capture/` via https://staudt.github.io/groovebox/fixture.html (voice "da", hum, whistle, single-note guitar, strummed chords).
- On the phone: capture feel (count-in, clicks with headphones), whether Place matches what you sang, the calibrated latency number, how long the first model load takes, harmony takes by ear.

## Phase 4: Song and mixer (2026-11-16) — awaiting phone check

**Built**
- Patterns A–D per track; global A–D chips in the Play header (switch waits for the next bar while playing; long-press to copy or clear a pattern). 32/64-step patterns span several bars.
- Song screen per `Song.dc.html`: Loop / Song mode, section chain with progress, section editor (name, bars, move, copy, delete), lane overview (tap a cell: A → B → C → D → silent), scenes (tap recalls on the next bar, long-press to save/rename/delete). Jam queue and Ask bar wait for Phase 6.
- Mix view (user choice: on the Song screen): fader, pan, mute, mixer solo, Space (reverb) and Delay sends, sidechain duck amount, live meters; master strip with level, duck key track and release.
- Engine: pattern slots, bar-quantized switching and scene mutes (the fade starts 10 ms before the bar), song sections, balance pan, faders (0.8 = unity), mixer solo combined with the monitoring Solo, sidechain ducking keyed sample-accurately from the key track.
- One `projectToCommands` translation shared by the live host, offline export and tests.
- Multiple projects (Project sheet: list, open, duplicate, delete), version history (last 20 per project, at least 60 s apart, restore is undoable), "New project" keeps the old one; WAV export (song once or N loop bars, +2 s tail) and stems (.zip, one soloed WAV per track) through the real worklet.
- Desktop layout (≥1024 px) per `Desktop.dc.html`: all-tracks matrix, sound panel, piano keyboard labeled with computer keys, Shift+Tab.
- Schema v3 (mixer, play mode); IndexedDB layout v3 (one record per project, versions). Existing data is migrated in place.

**Verified automatically**
- 238 unit tests, including the acceptance test: a song with sections, pattern variations, mixer settings and recorded FX moves renders bit-identical after save + reload through IndexedDB. Also: bar-quantized pattern switches, 32-step patterns, song order/silence/loop, pan/fader/solo, sidechain dips and recovers, scene mutes land on the bar, project migration, versions, zip CRCs.
- 212 Playwright tests incl. Song editing, scenes, Mix controls, A–D chips, projects, WAV/stems downloads (valid WAV of the right length), desktop layout, and every phone screen (now including Song and Mix) fitting 360x640 to 412x915.

**Needs a human**
- By ear: the sidechain pump on BASS/PAD, pan, scene recall timing, song transitions, and that exported WAVs sound like playback.
- By touch: faders and pan in the Mix view, section and lane editing, A–D chips (pulse while queued), scene long-press.
- Downloads on Android (and iOS if available).

## Phase 3: Sampler and FX (2026-11-16) — awaiting phone check

**Built**
- Punch-in FX engine (`src/engine/fx/`): all 12 effects (stutter 1/4–1/32, tape stop, low and high sweep, lo-fi, gate, reverse 1 beat, reverb and delay throws), on the master or the selected track, with XY parameters, latch and click-free 5 ms ramps. Stutter, gate and reverse start on the next 1/16.
- Send effects pulled forward from Phase 4: an FDN reverb (send A, the **Space** knob, now active) and a tempo-synced ping-pong delay (send B, used by the delay throw). The mix bus is stereo. Both sleep when silent.
- **Recorded moves**: with Moves on, FX presses and XY slides are recorded into the current pattern (A–D) and replayed sample-accurately every loop; Clear moves in the FX sheet; one undo step per recording session.
- FX sheet per `FX.dc.html` (opens from the center button on every screen), Perform screen per `Perform.dc.html` (key and Chords toggles, Tone/Space XY pad with tilt, four quick FX, chord/note pads, finger-drum pads for drum and one-shot sampler tracks). Desktop keys 1–8 hold FX.
- Sampler engine: pitched (cubic interpolation), reversed, trimmed playback, one-shot and chromatic modes, 8 voices per track, click-free ends; resample (master or a track, from the next bar).
- Sampler UI on the Sound screen: sample browser (16 CC0 kit sounds from beatboy, your samples with rename/delete, import file, mic recording with auto-trim, resample), waveform with trim handles, pitch, level, attack, release, reverse, mode.
- Samples are stored in OPFS (metadata in IndexedDB). Schema v2: PERC becomes a sampler with the kit tambourine, VOX an empty sampler (existing patterns kept).

**Verified automatically**
- 219 unit tests, including: gate edges and stutter loops sample-accurate to the 1/16 grid (the Phase 3 acceptance test), reverse plays the previous beat backwards, all 12 effects clean on press/release and under 0 dBFS, track-targeted FX leave other tracks bit-identical, reverb/delay sends and throws, recorded moves replay every bar and release on stop, sampler pitch across sample rates, chromatic notes and holds, reverse, trim, no clicks on abrupt sample ends or sample replacement, resample captures exactly the output from the next bar.
- 130 Playwright tests at 390x844 and 1280x800, including multi-touch (hold an FX and slide the XY pad with a second finger), mic recording with Chromium's fake microphone, file import surviving reload, and real-touch scrolling from the waveform.

**Needs a human**
- By ear: every effect while the loop plays (especially stutter, tape stop, sweeps, reverse), the reverb and delay character, Space on PAD and KEYS, kit sounds, pitched samples.
- By touch: holding FX with one thumb and sliding XY with the other, Latch, the Perform pads with several fingers, tilt, trim handles.
- Mic recording on the phone (quality, permission prompt, the −45 dB auto-trim) and resample timing.
- `bench.html` on the phone: the new "spec budget" line (worst case + sends + 2 FX).

## Phase 2: FM synth (2026-11-16) — accepted on the phone

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

**Measured on devices (bench.html, % of one core)**

| Scenario | User's phone | User's desktop Chrome | Headless desktop |
|---|---|---|---|
| Default song | 3.7 | 12.5 | 5.2 |
| Drums, 4 tracks on every 16th at 200 BPM | 1.3 | 3.7 | 1.8 |
| 8 FM voices, all 6 operators | 3.3 | 12.1 | 4.4 |
| Worst case (both) | 4.3 | 14.0 | 6.3 |

Decision: no WASM needed; the TypeScript engine uses about 1/7 of the 30 % budget on the phone. The desktop browser was slower than the phone, most likely CPU power saving on the laptop; worth rechecking only if desktop audio ever glitches.

**Changes from phone feedback**
- Solo moved to the screen headers (next to Rhythm on Play, next to Random/Save on Sound).
- BPM slider (40–240) in the tempo sheet; sheets close on Escape.
- Euclid became **Rhythm**: a live inline panel (Hits, Rotate, Shift ◀ ▶, Clear, Cancel, Done) that keeps the melody, chords and velocities and is one undo step.
- Scrolling: vertical swipes now scroll even when they start on steps, value controls, knob labels or the envelope; sideways drags, holds, knob dials and envelope handles still drag. Covered by real-touch Playwright tests (CDP).

**Needs a human**
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
