// Assistant client: talks to the local proxy (dev/preview server). Every answer is re-validated with
// the shared schemas; any error, timeout or invalid answer resolves to null, so the UI simply shows
// nothing new. Nothing here is ever on the audio path.
import { signal } from '@preact/signals';
import { RESPONSE_SCHEMA, type AssistFeature, type AssistRequest } from './schemas';
import type * as z from 'zod/v4';

/** 'checking' until the first health check; 'off' = no proxy (e.g. GitHub Pages); 'no-key' = proxy without ANTHROPIC_API_KEY. */
export type AssistStatus = 'checking' | 'off' | 'no-key' | 'on';
export const assistStatus = signal<AssistStatus>('checking');

const TIMEOUT_MS = 30_000;
const url = (path: string) => (typeof document !== 'undefined' ? new URL(path, document.baseURI).toString() : path);

/** Probes the proxy once at startup. Safe to call again (e.g. after the user adds a key). */
export async function checkAssistant(): Promise<AssistStatus> {
  try {
    const r = await fetch(url('api/assist/health'), { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const j = r.ok ? ((await r.json()) as { ok?: boolean; reason?: string }) : null;
    assistStatus.value = j?.ok ? 'on' : j?.reason === 'no-key' ? 'no-key' : 'off';
  } catch {
    assistStatus.value = 'off';
  }
  return assistStatus.value;
}

type Result<F extends AssistFeature> = z.infer<(typeof RESPONSE_SCHEMA)[F]>;

/** Sends one request; resolves with the validated result or null (never throws). */
export async function askAssistant<F extends AssistFeature>(req: Extract<AssistRequest, { feature: F }>, signalIn?: AbortSignal): Promise<Result<F> | null> {
  if (assistStatus.peek() !== 'on') return null;
  try {
    const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(signalIn ? [signalIn] : [])];
    const r = await fetch(url('api/assist'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.any(signals),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { feature?: string; result?: unknown };
    if (j.feature !== req.feature) return null;
    const parsed = RESPONSE_SCHEMA[req.feature as F].safeParse(j.result);
    return parsed.success ? (parsed.data as Result<F>) : null;
  } catch {
    return null;
  }
}
