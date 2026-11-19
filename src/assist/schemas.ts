// Assistant request/response schemas, shared by the local proxy (structured outputs) and the app
// (which re-validates and clamps everything: assistant output is never trusted or applied silently).
// Kept to JSON-schema features structured outputs support: objects, arrays, enums, nullable fields.
import * as z from 'zod/v4';

export const PATTERN_SLOT = z.enum(['A', 'B', 'C', 'D']);

// ---- Describe a sound -> 3 FM patches ----
export const FmOpOut = z.object({
  ratio: z.number().describe('Frequency ratio 0.5..31.99 (1 = the note, 2 = an octave up)'),
  detune: z.number().describe('-7..7, about 1.5 cents per step'),
  level: z.number().describe('Output level 0..99 (DX7 scale, ~0.75 dB per step)'),
  a: z.number().describe('Attack 0..1 (0 = 1.5 ms, 1 = 8 s, exponential)'),
  d: z.number().describe('Decay 0..1 (0 = 8 ms, 1 = 12 s)'),
  s: z.number().describe('Sustain level 0..1 (0 = silent, 1 = full; 48 dB range)'),
  r: z.number().describe('Release 0..1 (0 = 8 ms, 1 = 12 s)'),
  velSens: z.number().describe('Velocity sensitivity 0..7'),
});
export const FmPatchOut = z.object({
  name: z.string().describe('Short patch name, at most 24 characters'),
  algorithm: z.number().describe('DX7 algorithm 1..32'),
  feedback: z.number().describe('Feedback 0..7 on the algorithm feedback operator'),
  ops: z.array(FmOpOut).describe('Exactly 6 operators, OP1 first'),
});
export const SoundResponse = z.object({
  takes: z
    .array(z.object({ description: z.string().describe('One short line: what makes this take different'), patch: FmPatchOut }))
    .describe('Exactly 3 different takes on the description'),
});
export type SoundResponse = z.infer<typeof SoundResponse>;

// ---- Place a captured melody ----
export const PlaceResponse = z.object({
  track: z.string().describe('Name of the melodic track to put the melody on (e.g. KEYS)'),
  slot: PATTERN_SLOT.describe('Pattern slot to write'),
  section: z.string().nullable().describe('Name of the song section that should play it, or null if the song has no sections'),
  startStep: z.number().describe('Offset in 16th steps inside the pattern, usually 0'),
  repeats: z.number().describe('How many times to repeat the melody to fill the pattern: 1, 2 or 4'),
  octaveShift: z.number().describe('Octaves to move the melody: -2..2'),
  reason: z.string().describe('One short line explaining the choice'),
});
export type PlaceResponse = z.infer<typeof PlaceResponse>;

// ---- Jam queue -> up to 3 variations (pattern diffs) ----
export const PatternChange = z.object({
  track: z.string().describe('Track name'),
  slot: PATTERN_SLOT,
  pattern: z.string().describe('The whole new pattern in text notation, one token per 16th step (16 or 32 tokens)'),
});
export const JamResponse = z.object({
  variations: z
    .array(z.object({ description: z.string().describe('One short line'), changes: z.array(PatternChange).describe('1 to 3 pattern changes') }))
    .describe('Up to 3 variations for the next section'),
});
export type JamResponse = z.infer<typeof JamResponse>;

// ---- Ask bar -> edit commands ----
export const ASK_OPS = ['set_pattern', 'copy_pattern', 'set_bpm', 'set_swing', 'set_mute', 'set_macro', 'set_mix', 'set_key'] as const;
export const AskCommand = z.object({
  op: z.enum(ASK_OPS),
  track: z.string().nullable().describe('Track name (null for project-wide ops; "ALL" for copy_pattern on every track)'),
  slot: PATTERN_SLOT.nullable().describe('Pattern slot for set_pattern, or the source slot for copy_pattern'),
  to: PATTERN_SLOT.nullable().describe('Target slot for copy_pattern'),
  pattern: z.string().nullable().describe('Text notation for set_pattern'),
  param: z.string().nullable().describe('set_macro: Tone | Decay | Drive | Space. set_mix: level | pan | delay | duck. set_key: the scale (minor, major, dorian, mixolydian, pentatonic)'),
  value: z.number().nullable().describe('Number for the op (BPM, swing %, 0..1 macro/level/delay/duck, -1..1 pan, 1/0 for mute)'),
  text: z.string().nullable().describe('set_key: the key name such as C, Eb, F#'),
});
export const AskResponse = z.object({
  summary: z.string().describe('One short line describing what these edits do, or why nothing can be done'),
  commands: z.array(AskCommand).describe('The edits, at most 12; empty if the request cannot be done'),
});
export type AskCommand = z.infer<typeof AskCommand>;
export type AskResponse = z.infer<typeof AskResponse>;

// ---- Requests (app -> proxy) ----
export const AssistRequest = z.discriminatedUnion('feature', [
  z.object({ feature: z.literal('sound'), text: z.string().max(400), trackKind: z.string(), currentPatch: z.unknown() }),
  z.object({ feature: z.literal('place'), summary: z.string().max(20000), melody: z.string().max(2000), bars: z.number(), key: z.string() }),
  z.object({ feature: z.literal('jam'), summary: z.string().max(20000), section: z.string(), bar: z.number() }),
  z.object({ feature: z.literal('ask'), summary: z.string().max(20000), text: z.string().max(500) }),
]);
export type AssistRequest = z.infer<typeof AssistRequest>;
export type AssistFeature = AssistRequest['feature'];

export const RESPONSE_SCHEMA = { sound: SoundResponse, place: PlaceResponse, jam: JamResponse, ask: AskResponse } as const;
