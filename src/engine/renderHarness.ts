// Test-only: renders the real worklet in an OfflineAudioContext (headless Chromium).
import workletUrl from './worklet.ts?worker&url';
import type { EngineCommand } from './protocol';
import type { EngineProcessorOptions } from './worklet';

async function renderEngine(commands: EngineCommand[], seconds: number, sampleRate = 48000): Promise<number[][]> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(seconds * sampleRate), sampleRate });
  await ctx.audioWorklet.addModule(workletUrl);
  const processorOptions: EngineProcessorOptions = { commands };
  const node = new AudioWorkletNode(ctx, 'groovebox-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
}

(window as unknown as { renderEngine: typeof renderEngine }).renderEngine = renderEngine;
document.title = 'ready';
