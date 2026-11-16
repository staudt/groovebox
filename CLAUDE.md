# Groovebox (working name)

A web-first, mobile-first synth groovebox in the spirit of pocket hardware (KO II style sampler/drums, DX7 style FM synth), with an on-device melody capture and harmony engine and optional Claude Haiku assistance. Android phone is the primary target, desktop browser is a full citizen, iOS is best effort.

This file is the build spec. The UI mockups live in `docs/design/` (see "Design reference"). When the spec and a mockup disagree, ask.

## Product principles

1. **Immediate.** Every screen is playable. Nothing important is more than one tap or one hold away.
2. **Simple editing.** One note (or one chord) per step, with holds. No piano roll in v1.
3. **AI is optional and visible.** The app is fully usable offline without the LLM. Assistant output is always shown as editable choices, never applied silently.
4. **Real time stays local.** Nothing on the audio path waits on the network. The LLM works at phrase or section scale only.
5. **Colors carry meaning.** Amber = things the user plays or selects. Cyan = assistant suggestions. Coral = FX.

## Stack

- Vite + TypeScript (strict). Installable PWA (manifest + service worker, offline after first load).
- UI: Preact + @preact/signals (small, React-like). Playheads, meters and other 60 fps visuals render via `requestAnimationFrame` straight to canvas or element styles, never through component re-renders.
- Audio: Web Audio API with one main AudioWorklet that hosts the clock, sequencer and all voices. DSP in TypeScript first; move hot paths to Rust or C++ compiled to WASM only if profiling on a mid-range Android phone shows the need.
- Storage: IndexedDB (projects, versions) and OPFS (samples, recordings).
- Tests: Vitest (unit), Playwright with headless Chromium (audio render and UI tests).
- LLM proxy: a small Cloudflare Worker (or similar) holding the Anthropic API key. The key never ships in the client.

Licensing: do not copy code from GPL projects (for example Dexed or msfa) into this codebase. Write the FM engine from the published DX7 architecture. Check the license of every dependency.

## Architecture

```
UI (main thread)                     AudioWorklet (audio thread)
  Project store (signals)  --cmd-->    Engine
  Screens, gestures         <--evt--     Clock (sample accurate)
  Capture analysis (worker)             Sequencer (patterns, sections, scenes)
  Haiku client (fetch)                  Voices: drum, FM 6-op, sampler
                                        Mixer: levels, pans, sends, sidechain
                                        FX: punch-in, sends, master limiter
```

- The **project store** on the main thread is the single source of truth. The engine receives commands (set step, set param, transport) over the worklet MessagePort. The engine sends back events (playhead position, meters) at a throttled rate.
- **Audio thread rules:** no allocations, no closures created per block, no `postMessage` per sample block beyond the throttled events, flush denormals, smooth every parameter change (no zipper noise or clicks).
- **Timing:** the clock lives in the worklet and counts samples. Never schedule notes from `setTimeout` or the main thread.
- **Pitch analysis** for capture runs in a Web Worker fed by its own small AudioWorklet tap, so it never blocks the UI or the engine.
- If SharedArrayBuffer is needed later (ring buffers), the host must send COOP/COEP headers; plan the deployment for that.

### Suggested layout

```
src/
  app/            app shell, routing between screens, desktop vs phone layout
  ui/             components (TrackStrip, StepGrid, KeyboardDrawer, FxSheet, ...)
  screens/        Play, Sound, Perform, Song, Capture, CapturePlace, Desktop
  store/          project model, undo/redo, persistence, migrations
  engine/         worklet entry, clock, sequencer, voices/, fx/, mixer
  capture/        pitch tracking, segmentation, quantize, key detect, transpose
  harmony/        chord scoring, style tables, Viterbi, voicing, bass/pad/2nd voice
  assist/         Haiku client, schemas, validators
  platform/       audio unlock, latency calibration, Web MIDI, keyboard map
worker/           LLM proxy (separate deploy)
tests/            unit, render (Playwright), fixtures/
docs/design/      mockup sources
```

## Domain model (v1)

```ts
type Project = {
  id: string; name: string;
  bpm: number; swing: number;            // swing 50..75 %
  key: PitchClass; scale: 'minor' | 'major' | 'dorian' | 'mixolydian' | 'pentatonic';
  tracks: Track[];                       // 8 tracks
  sections: Section[];                   // song order
  scenes: Scene[];                       // saved mute sets
  mixer: MixerState;
  version: number;                       // schema version for migrations
};
type Track = {
  id: string; name: string; kind: 'drum' | 'fm' | 'sampler';
  patterns: Record<'A' | 'B' | 'C' | 'D', Pattern>;
  params: DrumParams | FmPatch | SamplerParams;
  macros: [MacroMap, MacroMap, MacroMap, MacroMap];  // Tone, Decay, Drive, Space by default
};
type Pattern = { length: 16 | 32 | 64; steps: Step[] };
type Step =
  | { t: 'rest' }
  | { t: 'hit'; vel: number; chance?: number; nudge?: number }           // drums
  | { t: 'note'; note: Midi; vel: number; chance?: number; nudge?: number }
  | { t: 'chord'; notes: Midi[]; symbol: string; vel: number }
  | { t: 'hold' };                                                         // continues previous note or chord
type Section = { id: string; name: string; bars: number; patternByTrack: Record<string, 'A'|'B'|'C'|'D'|null> };
```

Text notation for tests and debugging (one token per step): `.` rest, `x` hit, `G4` note, `~` hold, `Fm*` chord. Example: `G4 ~ Ab4 G4 F4 ~ Eb4 ~ Fm* ~ ~ ~ C5 ~ Bb4 ~`. Provide `parsePattern` and `formatPattern` and use them in tests.

Undo/redo: every store mutation goes through a command with an inverse. Autosave to IndexedDB on idle, keep the last 20 versions per project.

## Sound engines

**FM (6 operators).** 32 DX7-style algorithms. Per operator: ratio (coarse and fine), detune, output level, envelope (ADSR in the UI, mapped internally so a 4-rate envelope can come later), velocity sensitivity. Feedback on the top operator of the algorithm. 8 voices per track with voice stealing. Patch is plain JSON (also the format the LLM returns).

**Drum synth.** Kick, snare, hats, perc voices built from oscillators, noise and envelopes. Per voice: tune, decay, tone, level.

**Sampler.** Load from mic recording, file, or resample. Trim, pitch, reverse, one-shot or chromatic. Resample = bounce a track or the master into a new sample.

**Mixer.** Per track level, pan, mute, solo, send A (reverb), send B (delay). Sidechain ducking keyed from the kick (amount, release). Master limiter always on.

## FX (punch-in)

12 hold-to-play effects: stutter 1/4, 1/8, 1/16, 1/32; tape stop; low sweep; high sweep; lo-fi (bitcrush and rate); gate 1/16; reverse 1 beat; reverb throw; delay throw.

- Stutter, gate and reverse snap to the tempo grid and start on the next 1/16.
- Target: master or the selected track.
- Latch: effect stays on after release until tapped again.
- XY pad: while an FX is held, X and Y map to its two main parameters (shown on the pad).
- Record moves: when on, FX presses and XY motion are recorded into the current pattern as automation and replay every loop.

## Melody capture (no LLM)

Flow: Capture screen (listen) then Place screen (fit, place, harmonize). See mockups.

1. **Live tracking:** McLeod (MPM, for example the `pitchy` package) or YIN at 50 to 100 frames per second, with a clarity threshold and a short median filter. Drives the big note readout and the tuning bar.
2. **Source hint:** chips Voice, Whistle, Guitar, Chords. Default to auto-detect within the first second (range, attack sharpness); the chips only narrow the range and adjust onset weighting. Chords switches to polyphonic mode.
3. **Final transcription after Stop:** run Spotify Basic Pitch (`@spotify/basic-pitch`, TF.js) on the recording for accurate notes in all modes; keep the live tracker result as fallback.
4. **Segment and quantize:** split on pitch jumps and energy dips, drop notes under about 80 ms, quantize to the grid (1/8 default, 1/16 option) at the project tempo.
5. **Key detect:** Krumhansl-Schmuckler profiles on duration-weighted pitch classes.
6. **Transpose:** auto-fit moves the melody from the detected key to the project key by the smallest interval. Manual: chromatic semitones, or "in key" scale steps (diatonic shift that keeps the melody in the project scale). Out-of-key results are shown in a warning color with a one-tap fit.
7. **Latency compensation:** offset recorded audio by the measured round-trip latency (see Platform).

## Harmony engine (no LLM)

- Candidate chords: diatonic triads and sevenths of the project key.
- For each half bar or bar: score each chord by how many melody notes are chord tones, weighted by duration and strong beats.
- Transition table per style (Pop, Melancholy, Jazzy); pick the best overall sequence with Viterbi.
- Outputs, each optional: chord steps on the PAD track, bass roots on BASS, a second voice a third or sixth below the melody in key.
- Voicing: minimal movement between consecutive chords.
- Deterministic: same input gives the same result; must run in under 50 ms on a phone.

## Assistant (Claude Haiku)

All calls go through the proxy. Model: the current Haiku model (check docs.claude.com for the model id at build time). Use structured JSON output, validate with a schema (zod), clamp numbers to legal ranges, and fall back gracefully on any error or timeout (the UI simply shows nothing new).

| Feature | Input | Output |
|---|---|---|
| Describe a sound | text, track kind, current patch | 3 FM patches (A, B, C) as JSON |
| Place a captured melody | notes, key, sections, current chords per section | section, start offset, repeats, track, octave shift, one-line reason |
| Jam queue | compact project summary, current section, bar position | up to 3 variations as pattern diffs, each with a one-line description |
| Ask bar | free text plus project summary | a list of concrete edit commands (same command format as undo) |

Rules:
- Send a compact project summary (text pattern notation), not raw state.
- Use prompt caching for the system prompt that holds the schemas and the FM parameter reference.
- Jam queue requests are prepared in the background while the loop plays and are applied only at section boundaries.
- Every assistant decision is shown as an editable chip or a queue item with Skip.

## UI spec

Design reference: `docs/design/*.dc.html` (one file per screen, inline styles are the exact values). Phone frame 390x844.

**Tokens**
- Ground `#121316`, surface `#1A1C21`, raised `#1E2026`, border `#2E313A`, text `#ECEDEF`, muted text `#9A9DA6`
- Accent (user) `#FFB547`, assistant `#5CC8FF` on `#172129` with border `#2B4A5C`, FX `#FF6B5E`
- Fonts: Space Grotesk (UI), IBM Plex Mono (values, labels). Radii 8, 10, 12, 16. Touch targets at least 44 px where possible.

**Phone navigation:** bottom bar with Play, Sound, FX (center, coral), Perform, Song.

**Shared top area:** transport (project, BPM, record, play) on every screen. Play, Sound and Perform also show the track strip (8 tracks, horizontally scrollable) and share one selected track. Song shows all tracks and has no strip.

**Screens**
- **Play** (`Main.dc.html`): 4x4 step grid for the selected track (16 steps per page). Drums show hits with velocity; melodic tracks show note names, holds and chord steps. Gestures: tap to add or remove, drag right to hold, long-press for note or chord picker (melodic) or velocity and chance (drums). Four macro knobs. Ask bar. Capture button. Keyboard drawer (scale layout by default).
- **Sound** (`Sound.dc.html`): patch header, FM algorithm diagram with tappable operators, envelope editor with draggable points, "Describe a sound" input (A, B, C takes appear after Make). Keyboard drawer (piano layout, Hold available).
- **Perform** (`Perform.dc.html`): key and chord toggles, XY pad (tilt maps to Y), four quick FX, 4x4 pads (chords in the key or single notes). The pads replace the keyboard drawer here.
- **Song** (`Song.dc.html`): section chain with progress, lane overview of all tracks, Jam mode toggle and the jam queue (Queue, Skip), Ask bar.
- **Capture** (`Hum.dc.html`) and **Place** (`HumPlace.dc.html`): see Melody capture and Assistant.
- **FX sheet** (`FX.dc.html`): opened from the center button on any screen.
- **Desktop** (`Desktop.dc.html`): one page, all tracks in one step matrix, sound panel, capture panel, assistant queue, on-screen octave labeled with computer keys.

**Keyboard drawer (phone):** collapsible, one octave. Header: Keys toggle, Scale or Piano layout, octave down and up, Hold. Scale layout = the 8 notes of the project scale as pads. Piano layout dims out-of-key keys. Tapping a key while a step is selected writes that note.

**Desktop key map**
- Musical typing: A S D F G H J K = white keys C to C, W E T Y U = black keys, Z and X = octave down and up, backtick = hold.
- Space play or stop, Tab next track, 1 to 8 hold FX, R capture, / focus the Ask bar.
- Web MIDI input (Chrome) plays the selected track and can feed capture.

## Platform notes

- **Android first.** Test every phase on a real mid-range Android phone in Chrome.
- **Audio unlock:** create or resume the AudioContext on the first user gesture.
- **Latency calibration:** one-time test that plays a click and records it through the mic to measure round trip; store per device; apply to live recording and capture.
- **iOS:** no Web MIDI, audio stops in the background, the silent switch can mute audio (use `navigator.audioSession` where available), storage can be evicted unless installed. Degrade gracefully, never crash.
- **Web MIDI:** feature-detect; everything must work by touch and computer keyboard alone.
- **Performance budget:** engine under 30 % of one core on a mid-range Android phone with 8 tracks, 8 FM voices sounding and 2 FX active.

## Build phases

Each phase ends with something playable on the phone, passing tests, and a short note in `docs/progress.md`. Stop at the end of each phase and ask the user to listen and try it on their phone before moving on.

1. **Engine skeleton.** Vite PWA, worklet engine, clock, one drum voice, Play screen with step grid, transport, track strip (drums only). Accept: steady timing at 60 to 200 BPM, no clicks, works on Android.
2. **FM synth.** FM engine, Sound screen, keyboard drawer, melodic steps with holds and chords, macros. Accept: offline render tests pass for pitch and envelope; patches save and load.
3. **Sampler and FX.** Sampler, resample, FX sheet with all 12 effects, Perform screen. Accept: stutter and gate are sample-accurate to the grid in render tests.
4. **Song and mixer.** Patterns A to D, sections, scenes, mixer with sends and sidechain, undo/redo, autosave, WAV and stems export, desktop layout and key map. Accept: a full song plays back identically after reload.
5. **Capture and harmony.** Live tracker, Basic Pitch transcription, quantize, key detect, transpose, harmony engine, latency calibration. Accept: fixture tests reach the agreed note accuracy; harmony is deterministic and fast.
6. **Assistant.** Proxy, describe a sound, placement, jam queue, Ask bar. Accept: every call validated and clamped; the app behaves the same with the network off.

## Testing

- **Unit (Vitest):** store commands and undo, pattern notation, quantize, key detection, transpose, harmony scoring and Viterbi, schema validation.
- **Audio render (Playwright + headless Chromium + OfflineAudioContext):** render N bars to a buffer and assert numerically: non-silent where expected, onset times within 1 ms of the grid, fundamental frequency within 5 cents of the expected note, no samples above 0 dBFS after the limiter, no discontinuities (click detector).
- **Capture fixtures:** `tests/fixtures/capture/` holds short WAV recordings (voice "da", hum, whistle, single-note guitar, strummed chords) with expected note lists in JSON. The user will record these; until then, generate synthetic fixtures (sine and sawtooth melodies with vibrato and noise).
- **UI (Playwright):** core flows on a 390x844 viewport and a 1280x800 viewport.
- Claude cannot judge sound quality or feel. When a change affects how something sounds or feels, say what to listen for and ask the user to check.

## Conventions

- TypeScript strict, no `any` in engine or store code.
- Engine code is pure and testable outside the browser where possible (DSP functions take and return Float32Arrays).
- No new runtime dependency without a short justification in the PR description.
- Keep audio thread code allocation-free; add a comment at the top of every worklet file restating that rule.
- Small commits, one concern each.
