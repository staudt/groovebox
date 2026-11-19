// Assistant: proxy handler (with a fake Claude call - tests never spend money), converters, summary.
import { describe, expect, it } from 'vitest';
import { assist, health, ASSIST_MODEL } from '../../worker/assist';
import { SYSTEM_PROMPT } from '../../worker/prompts';
import { askProposals, jamItems, placeSuggestion, soundTakes } from '../../src/assist/apply';
import { projectSummary } from '../../src/assist/summary';
import { defaultProject } from '../../src/store/defaults';
import { reduce } from '../../src/store/project';
import type { AskCommand } from '../../src/assist/schemas';

const p = defaultProject();
const cmd = (c: Partial<AskCommand> & { op: AskCommand['op'] }): AskCommand => ({ track: null, slot: null, to: null, pattern: null, param: null, value: null, text: null, ...c });

describe('proxy handler', () => {
  it('health reports whether a key is configured', () => {
    expect(health(undefined).body).toEqual({ ok: false, reason: 'no-key' });
    expect(health('k').body).toMatchObject({ ok: true, model: 'claude-haiku-5-5' });
  });

  it('rejects bad requests and missing keys without calling Claude', async () => {
    let calls = 0;
    const fake = async () => ((calls++), { parsed_output: {}, stop_reason: 'end_turn' });
    expect((await assist({ feature: 'ask', summary: 's', text: 'x' }, undefined, fake)).status).toBe(503);
    expect((await assist({ feature: 'nope' }, 'k', fake)).status).toBe(400);
    expect(calls).toBe(0);
  });

  it('sends Haiku the cached system prompt, the feature prompt and a JSON schema; returns the parsed output', async () => {
    let seen: Record<string, unknown> | null = null;
    const fake = async (req: unknown) => {
      seen = req as Record<string, unknown>;
      return { parsed_output: { summary: 'ok', commands: [] }, stop_reason: 'end_turn' };
    };
    const r = await assist({ feature: 'ask', summary: projectSummary(p, 'A'), text: 'make the hats busier' }, 'k', fake);
    expect(r).toEqual({ status: 200, body: { feature: 'ask', result: { summary: 'ok', commands: [] } } });
    const req = seen as unknown as { model: string; system: { text: string; cache_control: unknown }[]; messages: { content: string }[]; output_config: { effort: string; format: { type: string } } };
    expect(req.model).toBe(ASSIST_MODEL);
    expect(req.system[0]!.text).toBe(SYSTEM_PROMPT);
    expect(req.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(req.messages[0]!.content).toContain('make the hats busier');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.output_config.effort).toBe('low');
  });

  it('refusals and missing output become errors (the app then shows nothing new)', async () => {
    const r = await assist({ feature: 'ask', summary: 's', text: 'x' }, 'k', async () => ({ parsed_output: null, stop_reason: 'refusal' }));
    expect(r.status).toBe(502);
  });

  it('the system prompt is long enough to be cached (Haiku 5.5: 512 tokens, ~4 chars per token)', () => {
    expect(SYSTEM_PROMPT.length / 4).toBeGreaterThan(600);
  });
});

describe('converters (validate and clamp, never guess)', () => {
  it('sound takes: always 6 operators, every number in range', () => {
    const op = { ratio: 99, detune: -20, level: 140, a: -1, d: 2, s: 0.5, r: 0.5, velSens: 12 };
    const takes = soundTakes({ takes: [{ description: 'a', patch: { name: 'X'.repeat(50), algorithm: 77, feedback: -3, ops: [op, op] } }] });
    expect(takes).toHaveLength(1);
    const t = takes[0]!;
    expect(t.ops).toHaveLength(6);
    expect(t.algorithm).toBe(32);
    expect(t.feedback).toBe(0);
    expect(t.name.length).toBeLessThanOrEqual(24);
    expect(t.ops[0]).toMatchObject({ ratio: 31.99, detune: -7, level: 99, a: 0, d: 1, velSens: 7 });
  });

  it('ask: valid commands become store commands; bad references are dropped', () => {
    const r = askProposals(p, {
      summary: 'Busier hats, faster',
      commands: [
        cmd({ op: 'set_pattern', track: 'hats', slot: 'A', pattern: 'x x x x x x x x x x x x x x x x' }),
        cmd({ op: 'set_bpm', value: 500 }),
        cmd({ op: 'set_pattern', track: 'GUITAR', slot: 'A', pattern: 'x' }), // no such track
        cmd({ op: 'set_pattern', track: 'KICK', slot: 'B', pattern: 'x q x' }), // bad notation
        cmd({ op: 'set_mix', track: 'BASS', param: 'pan', value: -3 }),
        cmd({ op: 'set_key', text: 'Eb', param: 'major' }),
        cmd({ op: 'set_macro', track: 'PAD', param: 'space', value: 0.7 }),
      ],
    });
    expect(r.dropped).toBe(2);
    expect(r.proposals.map((x) => x.label)).toEqual([
      'HATS pattern A: x x x x x x x x x x x x x x x x',
      'Tempo 240 BPM',
      'BASS pan -1.00',
      'Key Eb major',
      'PAD Space 70 %',
    ]);
    // Applying them goes through the normal (clamping) store reducer.
    let q = p;
    for (const prop of r.proposals) for (const c of prop.commands) q = reduce(q, c)[0];
    expect(q.bpm).toBe(240);
    expect(q.key).toBe(3);
    expect(q.scale).toBe('major');
    expect(q.mixer.tracks[3]!.pan).toBe(-1);
  });

  it('drum tracks only get hits; melodic tracks keep notes', () => {
    const r = askProposals(p, { summary: '', commands: [cmd({ op: 'set_pattern', track: 'KICK', slot: 'A', pattern: 'C2 . x . ~ . . .' })] });
    const steps = (r.proposals[0]!.commands[0] as { steps: { t: string }[] }).steps;
    expect(steps.slice(0, 5).map((s) => s.t)).toEqual(['hit', 'rest', 'hit', 'rest', 'rest']);
  });

  it('jam items keep only valid changes', () => {
    const items = jamItems(p, {
      variations: [
        { description: 'Hat roll', changes: [{ track: 'HATS', slot: 'A', pattern: 'x . x . x . x . x x x x x x x x' }, { track: 'NOPE', slot: 'A', pattern: 'x' }] },
        { description: 'Broken', changes: [{ track: 'KICK', slot: 'A', pattern: '???' }] },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.tracks).toEqual(['HATS']);
  });

  it('placement must name a melodic track; numbers are clamped', () => {
    expect(placeSuggestion(p, { track: 'KICK', slot: 'B', section: null, startStep: 0, repeats: 1, octaveShift: 0, reason: 'r' })).toBeNull();
    expect(placeSuggestion(p, { track: 'keys', slot: 'B', section: 'nope', startStep: 99, repeats: 3, octaveShift: 5, reason: 'r' })).toEqual({
      track: 4, slot: 'B', sectionId: null, startStep: 63, repeats: 4, octaveShift: 2, reason: 'r',
    });
  });
});

describe('project summary', () => {
  it('is compact text: key, tempo, tracks with non-empty patterns in notation', () => {
    const s = projectSummary(p, 'A');
    expect(s).toContain('92 BPM');
    expect(s).toContain('key C minor');
    expect(s).toContain('KICK: drum synth (kick)');
    expect(s).toContain('  A: x . . . . . x . x . . . . . . .');
    expect(s).not.toContain('  B:'); // empty slots omitted
    expect(s.length).toBeLessThan(3000);
  });
});
