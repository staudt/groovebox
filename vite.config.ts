/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm dev:lan` serves https on the LAN (self-signed) so the phone gets a secure context for AudioWorklet.
  plugins: [
    // Engine modules also run inside the AudioWorklet, which has no DOM: keep Preact's dev-only
    // refresh/debug injection (it imports the Vite HMR client) out of them.
    preact({ exclude: [/\/src\/engine\//, /\/src\/platform\/recorderWorklet\.ts$/, /\/src\/capture\/tapWorklet\.ts$/, /\/src\/capture\/trackerWorker\.ts$/, /\/src\/store\/types\.ts$/] }),
    serviceWorker(), ...(mode === 'lan' ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      // bench.html: on-device engine benchmark. render.html: engine render harness, only built for tests.
      input: (mode === 'test' ? { main: 'index.html', bench: 'bench.html', fixture: 'fixture.html', render: 'render.html' } : { main: 'index.html', bench: 'bench.html', fixture: 'fixture.html' }) as Record<string, string>,
    },
  },
  test: {
    environment: 'node',
    // TOOLS=1 runs the dev tools in tests/tools (demo renders, benchmarks) instead of the test suite.
    include: process.env.TOOLS ? ['tests/tools/**/*.tool.ts'] : ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/audio/**/*.test.ts', 'tests/capture/**/*.test.ts'],
    testTimeout: process.env.TOOLS ? 120_000 : 5_000,
  },
}));
