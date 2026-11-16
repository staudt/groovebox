# Progress

## Phase 1: Engine skeleton (2026-11-16) — awaiting phone check

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
- Service worker only registers in production builds. Over the self-signed LAN cert it will not register (Chrome refuses), so offline/install on the phone needs a real deploy later.
- Engine modules are excluded from Preact's dev transform (its HMR glue breaks the worklet scope).
