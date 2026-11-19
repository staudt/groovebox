// Assistant proxy: holds the Anthropic API key and turns app requests into Claude calls with
// structured outputs. Framework-neutral (plain JSON in, JSON out) so it can run inside the Vite dev
// server today (scripts/assist-plugin.ts) and as a Cloudflare Worker later.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AssistRequest, RESPONSE_SCHEMA } from '../src/assist/schemas';
import { SYSTEM_PROMPT, userPrompt } from './prompts';

export const ASSIST_MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 25_000;

export type AssistReply = { status: number; body: unknown };

let client: Anthropic | null = null;
let clientKey = '';

function getClient(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
    clientKey = apiKey;
  }
  return client;
}

/** GET /api/assist/health: tells the app whether the assistant can be used. */
export function health(apiKey: string | undefined): AssistReply {
  return apiKey ? { status: 200, body: { ok: true, model: ASSIST_MODEL } } : { status: 200, body: { ok: false, reason: 'no-key' } };
}

/**
 * POST /api/assist: validates the request, calls Claude Haiku with the cached system prompt and a
 * JSON schema for the feature, and returns the parsed output (the app validates it again).
 * `call` is injectable for tests so they never spend money.
 */
export async function assist(
  raw: unknown,
  apiKey: string | undefined,
  call: (req: Parameters<Anthropic['messages']['parse']>[0]) => Promise<{ parsed_output: unknown; stop_reason: string | null }> = (req) => getClient(apiKey!).messages.parse(req),
): Promise<AssistReply> {
  if (!apiKey) return { status: 503, body: { error: 'no-key' } };
  const parsed = AssistRequest.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: 'bad-request' } };
  const req = parsed.data;
  try {
    const res = await call({
      model: ASSIST_MODEL,
      max_tokens: 8000,
      // Stable reference first so it is cached across calls (Haiku 5.5 caches prefixes >= 512 tokens).
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt(req) }],
      // Short, well-specified tasks: low effort keeps them fast and cheap.
      output_config: { effort: 'low', format: zodOutputFormat(RESPONSE_SCHEMA[req.feature]) },
    });
    if (res.stop_reason === 'refusal' || res.parsed_output == null) return { status: 502, body: { error: 'no-answer' } };
    return { status: 200, body: { feature: req.feature, result: res.parsed_output } };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'rate-limited' } };
    if (e instanceof Anthropic.AuthenticationError) return { status: 401, body: { error: 'bad-key' } };
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, body: { error: 'timeout' } };
    if (e instanceof Anthropic.APIError) return { status: 502, body: { error: 'api-error' } };
    return { status: 500, body: { error: 'failed' } };
  }
}
