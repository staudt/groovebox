# Groovebox (working name)

A web-first, mobile-first synth groovebox: drum synth step sequencer now, FM synth, sampler, punch-in FX, melody capture and an optional assistant later. Android Chrome first, desktop browsers fully supported.

**Play it:** https://staudt.github.io/groovebox/

Build spec: `CLAUDE.md`. Progress per phase: `docs/progress.md`. UI mockups: `docs/design/`.

## Commands

```sh
pnpm install
pnpm dev          # local dev server
pnpm dev:lan      # https on the LAN (self-signed) at port 5180, for testing on a phone
pnpm test         # unit + offline engine render tests (Vitest)
pnpm test:e2e     # real AudioWorklet render tests + UI tests (Playwright, headless Chromium)
pnpm render:demo  # write WAV renders to renders/ for listening
pnpm bench        # engine CPU cost
pnpm build        # notices + typecheck + production build in dist/
```

Pushes to `master` deploy to GitHub Pages via `.github/workflows/deploy.yml`.
