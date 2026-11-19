// `pnpm assist:smoke`: one REAL call per assistant feature against the default project, using
// ANTHROPIC_API_KEY from .env. Costs real money (roughly a tenth of a cent for all four with Claude
// Haiku 5.5). Prints each validated answer, token usage and whether the system prompt was cached.
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from 'vite';
import { it } from 'vitest';
import { assist } from '../../worker/assist';
import { projectSummary } from '../../src/assist/summary';
import { askProposals, jamItems, placeSuggestion, soundTakes } from '../../src/assist/apply';
import { defaultProject } from '../../src/store/defaults';
import { RESPONSE_SCHEMA, type AssistRequest } from '../../src/assist/schemas';

const key = loadEnv('development', process.cwd(), '')['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'];

it.skipIf(!key)('live assistant smoke test (spends a little money)', { timeout: 180_000 }, async () => {
  const client = new Anthropic({ apiKey: key, timeout: 30_000 });
  const p = defaultProject();
  const summary = projectSummary(p, 'A');
  const reqs: AssistRequest[] = [
    { feature: 'sound', text: 'warm round bass with a short pluck', trackKind: 'fm', currentPatch: p.tracks[3]!.params },
    { feature: 'place', summary, melody: 'C5 ~ Eb5 ~ G5 ~ ~ ~ F5 ~ Eb5 ~ D5 ~ ~ ~', bars: 1, key: 'C minor' },
    { feature: 'jam', summary, section: 'Loop', bar: 3 },
    { feature: 'ask', summary, text: 'make the hats busier and slow it down a bit' },
  ];
  for (const req of reqs) {
    const t0 = Date.now();
    const r = await assist(req, key, async (body) => {
      const res = await client.messages.parse(body);
      const u = res.usage;
      console.log(`[${req.feature}] ${Date.now() - t0} ms, in ${u.input_tokens} (cache read ${u.cache_read_input_tokens ?? 0}, write ${u.cache_creation_input_tokens ?? 0}), out ${u.output_tokens}, stop ${res.stop_reason}`);
      return res;
    });
    if (r.status !== 200) {
      console.log(`[${req.feature}] FAILED`, r);
      continue;
    }
    const result = (r.body as { result: unknown }).result;
    const ok = RESPONSE_SCHEMA[req.feature].safeParse(result);
    if (!ok.success) {
      console.log(`[${req.feature}] schema mismatch`, ok.error.message);
      continue;
    }
    if (req.feature === 'sound') console.log(soundTakes(ok.data as never).map((x) => `${x.name} (alg ${x.algorithm})`));
    if (req.feature === 'place') console.log(placeSuggestion(p, ok.data as never));
    if (req.feature === 'jam') console.log(jamItems(p, ok.data as never).map((x) => `${x.description} [${x.tracks.join(', ')}]`));
    if (req.feature === 'ask') {
      const a = askProposals(p, ok.data as never);
      console.log(a.summary, a.proposals.map((x) => x.label), `dropped ${a.dropped}`);
    }
  }
});
