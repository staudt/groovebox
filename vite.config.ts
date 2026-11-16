/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm dev:lan` serves https on the LAN (self-signed) so the phone gets a secure context for AudioWorklet.
  plugins: [preact(), serviceWorker(), ...(mode === 'lan' ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      // The engine render harness page is only built for tests (`--mode test`).
      input: (mode === 'test' ? { main: 'index.html', render: 'render.html' } : { main: 'index.html' }) as Record<string, string>,
    },
  },
  test: {
    environment: 'node',
    // TOOLS=1 runs the dev tools in tests/tools (demo renders, benchmarks) instead of the test suite.
    include: process.env.TOOLS ? ['tests/tools/**/*.tool.ts'] : ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/audio/**/*.test.ts'],
    testTimeout: process.env.TOOLS ? 120_000 : 5_000,
  },
}));
