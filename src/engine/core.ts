// Engine core: sample-accurate clock, step sequencer, drum and FM voices, mixer, master limiter.
// AUDIO THREAD CODE: no allocations in process() and no closures created per block.
// Commands (command()) may copy into preallocated arrays; they run at UI rate, not per block.
// Pure TypeScript with no Web Audio dependency, so it renders offline in Node for tests.
import type { EngineCommand, EngineEvent } from './protocol';
import { DrumSettings, DrumVoice, modelIndex } from './voices/drum';
import { FmParams, FmVoice } from './fm/voice';
import { SamplerSettings, SamplerVoice, samplerAttackS, samplerReleaseS, type SampleData } from './sampler/voice';
import { Limiter } from './limiter';
import { Noise, softClip } from './dsp';
import { Reverb } from './fx/reverb';
import { PingPongDelay } from './fx/delay';
import { DEFAULT_DELAY_FB, DEFAULT_DELAY_STEPS, DEFAULT_REVERB_S, PunchChain } from './fx/punch';
import { FX_DEFAULT_XY, FX_DEFS, FX_IDS, fxIndex } from './fx/ids';
import { MAX_STEPS, MAX_TRACKS } from '../store/types';

const MAX_BLOCK = 4096;
const VOICES_PER_TRACK = 3;
/** FM: 8 notes of polyphony per track, plus 2 spare voices so a stolen note can fade out instead of clicking. */
const FM_POLY = 8;
const FM_VOICES = FM_POLY + 2;
const MAX_CHORD = 6;

const KIND_OFF = 0;
const KIND_DRUM = 1;
const KIND_FM = 2;
const KIND_SAMPLER = 3;
const SAMPLER_POLY = 8;
const SAMPLER_VOICES = SAMPLER_POLY + 2;

const EV_HIT = 0;
const EV_ON = 1;
const EV_OFF = 2;
const QUEUE = 256;
const METER_HZ = 30;
/** Steps are scanned this far ahead so negative nudges (up to -0.5 step) can still fire on time. */
const LOOKAHEAD_STEPS = 0.5;

const ST_REST = 0;
const ST_HIT = 1;
const ST_NOTE = 2;
const ST_CHORD = 3;
const ST_HOLD = 4;

class TrackState {
  kind = KIND_OFF;
  mute = false;
  length = 16;
  readonly type = new Uint8Array(MAX_STEPS);
  readonly vel = new Float32Array(MAX_STEPS);
  readonly chance = new Float32Array(MAX_STEPS).fill(1);
  readonly nudge = new Float32Array(MAX_STEPS);
  readonly notes = new Int16Array(MAX_STEPS * MAX_CHORD);
  readonly noteCount = new Uint8Array(MAX_STEPS);
  readonly fm = new FmParams();
  readonly fmVoices: FmVoice[] = [];
  fmAge = 0;
  readonly sampler = new SamplerSettings();
  readonly samplerVoices: SamplerVoice[] = [];
  sampleId: string | null = null;
  readonly settings = new DrumSettings();
  readonly voices: DrumVoice[] = [];
  readonly buf = new Float32Array(MAX_BLOCK);
  level = 0.8;
  drive = 0;
  /** Smoothed gain (level and mute), per sample. */
  gain = 0;
  /** Reverb (A) and delay (B) send levels: targets and smoothed values. */
  sendA = 0;
  sendB = 0;
  curA = 0;
  curB = 0;
  peak = 0;
}

export class Engine {
  readonly sampleRate: number;
  /** Event sink (the worklet forwards to the port; tests collect). Must not be called per sample. */
  emit: (ev: EngineEvent) => void = () => {};

  private tracks: TrackState[] = [];
  private limiter: Limiter;
  private rng = new Noise(0x9e3779b9);
  private smoothK: number;

  // Transport and clock. Song position (in 16th steps) is linear in frames between tempo changes:
  // pos(frame) = anchorStep + (frame - anchorFrame) / samplesPerStep. Re-anchored only on tempo change,
  // so step times are exact and independent of the block size.
  private playing = false;
  private anchorFrame = 0;
  private anchorStep = 0;
  private nextStep = 0;
  private bpm = 120;
  private swing = 50;
  private frame = 0; // absolute frames rendered so far

  // Pending events (absolute frame, kind, track, velocity, note, note id). Unordered; scanned linearly.
  private qFrame = new Float64Array(QUEUE);
  private qType = new Uint8Array(QUEUE);
  private qTrack = new Int8Array(QUEUE);
  private qVel = new Float32Array(QUEUE);
  private qNote = new Int16Array(QUEUE);
  private qId = new Int32Array(QUEUE);
  private qSeq = new Uint8Array(QUEUE); // 1 = from the sequencer (dropped on stop), 0 = live / audition
  private qLen = 0;
  private noteIds = 0;
  /** Loaded samples by id (filled by 'sample' commands, at UI rate). */
  private readonly samples = new Map<string, SampleData>();
  // Resample capture.
  private capId = '';
  private capSource = -2; // -2 = idle, -1 = master, else track
  private capL: Float32Array | null = null;
  private capR: Float32Array | null = null;
  private capPos = 0;
  private capStart = 0;

  private masterGain = 0.9;
  // Send effects and punch-in FX.
  private readonly reverb: Reverb;
  private readonly delay: PingPongDelay;
  private readonly punch: PunchChain;
  private readonly revIn = new Float32Array(MAX_BLOCK);
  private readonly delIn = new Float32Array(MAX_BLOCK);
  private readonly injRev = new Float32Array(MAX_BLOCK);
  private readonly injDel = new Float32Array(MAX_BLOCK);
  private readonly fxL = new Float32Array(MAX_BLOCK);
  private readonly fxR = new Float32Array(MAX_BLOCK);
  private soloTrack = -1;
  private masterPeak = 0;
  private meterFrames = 0;
  private readonly meterEvery: number;
  private meterTracks: number[] = new Array<number>(MAX_TRACKS).fill(0);

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.limiter = new Limiter(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.punch = new PunchChain(sampleRate);
    this.smoothK = 1 - Math.exp(-1 / (0.01 * sampleRate)); // ~10 ms parameter smoothing
    this.meterEvery = Math.round(sampleRate / METER_HZ);
    for (let t = 0; t < MAX_TRACKS; t++) {
      const ts = new TrackState();
      for (let v = 0; v < VOICES_PER_TRACK; v++) ts.voices.push(new DrumVoice(sampleRate, 0x1234567 + t * 977 + v * 131));
      for (let v = 0; v < FM_VOICES; v++) ts.fmVoices.push(new FmVoice(sampleRate));
      for (let v = 0; v < SAMPLER_VOICES; v++) ts.samplerVoices.push(new SamplerVoice(sampleRate));
      this.tracks.push(ts);
    }
  }

  /** Output latency added by the engine (limiter lookahead), in samples. */
  get latency(): number {
    return this.limiter.latency;
  }

  /** Align the engine's frame counter with the host clock (AudioWorkletGlobalScope.currentFrame). */
  syncFrame(frame: number): void {
    this.frame = frame;
  }

  /** Context time (s) at which a frame rendered now becomes audible at the engine output. */
  private timeOf(frame: number): number {
    return (frame + this.limiter.latency) / this.sampleRate;
  }

  get samplesPerStep(): number {
    return (this.sampleRate * 60) / this.bpm / 4;
  }

  command(cmd: EngineCommand): void {
    switch (cmd.type) {
      case 'transport':
        if (cmd.playing && !this.playing) {
          this.playing = true;
          this.anchorFrame = this.frame;
          this.anchorStep = 0;
          this.nextStep = 0;
        } else if (!cmd.playing && this.playing) {
          this.playing = false;
          this.dropSequenced();
          // Sequenced FM notes lose their pending note-offs, so release them now (they ring out).
          for (let t = 0; t < MAX_TRACKS; t++) {
            const ts = this.tracks[t]!;
            for (let v = 0; v < FM_VOICES; v++) {
              const voice = ts.fmVoices[v]!;
              if (voice.active && !voice.live) voice.noteOff(ts.fm);
            }
            for (let v = 0; v < SAMPLER_VOICES; v++) {
              const voice = ts.samplerVoices[v]!;
              if (voice.active && !voice.live) voice.noteOff(ts.sampler.chromatic);
            }
          }
          this.emit({ type: 'step', step: -1, time: this.timeOf(this.frame) });
        }
        break;
      case 'tempo':
        if (this.playing) {
          this.anchorStep = this.posAt(this.frame);
          this.anchorFrame = this.frame;
        }
        this.bpm = Math.min(300, Math.max(20, cmd.bpm));
        this.swing = Math.min(75, Math.max(50, cmd.swing));
        break;
      case 'pattern': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        ts.length = Math.min(MAX_STEPS, cmd.pattern.length);
        for (let i = 0; i < MAX_STEPS; i++) {
          const s = cmd.pattern.steps[i];
          ts.type[i] = ST_REST;
          ts.vel[i] = 0;
          ts.chance[i] = 1;
          ts.nudge[i] = 0;
          ts.noteCount[i] = 0;
          if (!s || i >= ts.length) continue;
          if (s.t === 'hit' || s.t === 'note') {
            ts.type[i] = s.t === 'hit' ? ST_HIT : ST_NOTE;
            ts.vel[i] = s.vel;
            ts.chance[i] = s.chance ?? 1;
            ts.nudge[i] = Math.max(-0.5, Math.min(0.5, s.nudge ?? 0));
            if (s.t === 'note') {
              ts.notes[i * MAX_CHORD] = s.note;
              ts.noteCount[i] = 1;
            }
          } else if (s.t === 'chord') {
            ts.type[i] = ST_CHORD;
            ts.vel[i] = s.vel;
            const c = Math.min(MAX_CHORD, s.notes.length);
            for (let k = 0; k < c; k++) ts.notes[i * MAX_CHORD + k] = s.notes[k]!;
            ts.noteCount[i] = c;
          } else if (s.t === 'hold') {
            ts.type[i] = ST_HOLD;
          }
        }
        break;
      }
      case 'drumParams': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        const p = cmd.params;
        ts.settings.model = modelIndex(p.model);
        ts.settings.tune = p.tune;
        ts.settings.decay = p.decay;
        ts.settings.tone = p.tone;
        ts.level = p.level;
        ts.drive = p.drive;
        this.snapGainIfSilent(ts);
        break;
      }
      case 'trackKind': {
        const ts = this.tracks[cmd.track];
        if (ts) {
          const kind = cmd.kind === 'drum' ? KIND_DRUM : cmd.kind === 'fm' ? KIND_FM : cmd.kind === 'sampler' ? KIND_SAMPLER : KIND_OFF;
          if (kind !== ts.kind) {
            for (let v = 0; v < VOICES_PER_TRACK; v++) ts.voices[v]!.release();
            for (let v = 0; v < FM_VOICES; v++) ts.fmVoices[v]!.stealFade();
            for (let v = 0; v < SAMPLER_VOICES; v++) ts.samplerVoices[v]!.stealFade();
          }
          ts.kind = kind;
          this.snapGainIfSilent(ts);
        }
        break;
      }
      case 'samplerParams': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        const p = cmd.params;
        const st = ts.sampler;
        ts.sampleId = p.sampleId;
        st.sample = p.sampleId ? (this.samples.get(p.sampleId) ?? null) : null;
        st.start = Math.min(1, Math.max(0, p.start));
        st.end = Math.min(1, Math.max(0, p.end));
        st.pitch = Math.min(24, Math.max(-24, p.pitch));
        st.reverse = p.reverse;
        st.chromatic = p.mode === 'chromatic';
        st.root = p.root;
        st.attackS = samplerAttackS(p.attack);
        st.releaseS = samplerReleaseS(p.release);
        ts.level = p.level;
        this.snapGainIfSilent(ts);
        break;
      }
      case 'sample': {
        const data: SampleData = { l: cmd.l, r: cmd.r ?? cmd.l, rate: cmd.rate };
        // A replaced sample must not be read by voices still holding the old buffer: fade them.
        for (let t = 0; t < MAX_TRACKS; t++) {
          const ts = this.tracks[t]!;
          if (ts.sampleId !== cmd.id) continue;
          for (let v = 0; v < SAMPLER_VOICES; v++) ts.samplerVoices[v]!.stealFade();
          ts.sampler.sample = data;
        }
        this.samples.set(cmd.id, data);
        break;
      }
      case 'resample': {
        this.capId = cmd.id;
        this.capSource = Math.min(MAX_TRACKS - 1, Math.max(-1, cmd.source));
        this.capL = cmd.l;
        this.capR = cmd.r;
        this.capPos = 0;
        this.capStart = this.playing ? this.nextBar() : this.frame;
        break;
      }
      case 'fmPatch': {
        const ts = this.tracks[cmd.track];
        if (ts) ts.fm.set(cmd.patch);
        break;
      }
      case 'macros': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        ts.fm.tone = cmd.values[0];
        ts.fm.decayMacro = cmd.values[1];
        if (ts.kind === KIND_FM || ts.kind === KIND_SAMPLER) ts.drive = cmd.values[2];
        break;
      }
      case 'noteOn':
        this.enqueue(this.frame, EV_ON, cmd.track, cmd.vel, cmd.note, 0, 0);
        break;
      case 'noteOff':
        this.enqueue(this.frame, EV_OFF, cmd.track, 0, cmd.note, 0, 0);
        break;
      case 'allNotesOff': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        for (let v = 0; v < FM_VOICES; v++) {
          const voice = ts.fmVoices[v]!;
          if (voice.active && voice.live) voice.noteOff(ts.fm);
        }
        for (let v = 0; v < SAMPLER_VOICES; v++) {
          const voice = ts.samplerVoices[v]!;
          if (voice.active && voice.live) voice.noteOff(ts.sampler.chromatic, true);
        }
        break;
      }
      case 'mute': {
        const ts = this.tracks[cmd.track];
        if (ts) {
          ts.mute = cmd.mute;
          this.snapGainIfSilent(ts);
        }
        break;
      }
      case 'sends': {
        const ts = this.tracks[cmd.track];
        if (!ts) return;
        ts.sendA = Math.min(1, Math.max(0, cmd.a));
        ts.sendB = Math.min(1, Math.max(0, cmd.b));
        break;
      }
      case 'fx': {
        const k = fxIndex(cmd.fx);
        if (k < 0) return;
        if (cmd.on) {
          const t = Math.min(MAX_TRACKS - 1, Math.max(-1, Math.round(cmd.target)));
          if (t !== this.punch.target) {
            this.punch.releaseAll();
            this.punch.target = t;
          }
          const [dx, dy] = FX_DEFAULT_XY[FX_IDS[k]!];
          this.punch.setXY(k, cmd.x ?? dx, cmd.y ?? dy, true);
        }
        // Stutter, gate and reverse start on the next 1/16 while playing; everything else at once.
        const snaps = FX_DEFS[k]!.snaps && this.playing;
        this.punch.press(k, cmd.on, snaps ? this.nextSixteenth() : this.frame);
        break;
      }
      case 'fxXY': {
        const k = fxIndex(cmd.fx);
        if (k >= 0) this.punch.setXY(k, cmd.x, cmd.y);
        break;
      }
      case 'solo':
        this.soloTrack = cmd.track;
        for (let t = 0; t < MAX_TRACKS; t++) this.snapGainIfSilent(this.tracks[t]!);
        break;
      case 'trigger':
        this.enqueue(this.frame, EV_HIT, cmd.track, cmd.vel, 0, 0, 0);
        break;
    }
  }

  private targetGain(ts: TrackState): number {
    const soloed = this.soloTrack >= 0 && this.tracks[this.soloTrack] !== ts;
    return ts.kind !== KIND_OFF && !ts.mute && !soloed ? ts.level * ts.level : 0;
  }

  /** Gain smoothing only matters while sound is playing; a silent track jumps straight to its target. */
  private snapGainIfSilent(ts: TrackState): void {
    for (let v = 0; v < VOICES_PER_TRACK; v++) if (ts.voices[v]!.active) return;
    for (let v = 0; v < FM_VOICES; v++) if (ts.fmVoices[v]!.active) return;
    for (let v = 0; v < SAMPLER_VOICES; v++) if (ts.samplerVoices[v]!.active) return;
    ts.gain = this.targetGain(ts);
  }

  private enqueue(frame: number, type: number, track: number, vel: number, note: number, id: number, seq: number): void {
    if (this.qLen >= QUEUE) return; // drop rather than allocate
    const i = this.qLen++;
    this.qFrame[i] = frame;
    this.qType[i] = type;
    this.qTrack[i] = track;
    this.qVel[i] = vel;
    this.qNote[i] = note;
    this.qId[i] = id;
    this.qSeq[i] = seq;
  }

  private removeAt(i: number): void {
    const last = --this.qLen;
    this.qFrame[i] = this.qFrame[last]!;
    this.qType[i] = this.qType[last]!;
    this.qTrack[i] = this.qTrack[last]!;
    this.qVel[i] = this.qVel[last]!;
    this.qNote[i] = this.qNote[last]!;
    this.qId[i] = this.qId[last]!;
    this.qSeq[i] = this.qSeq[last]!;
  }

  private dropSequenced(): void {
    for (let i = this.qLen - 1; i >= 0; i--) if (this.qSeq[i] === 1) this.removeAt(i);
  }

  private posAt(frame: number): number {
    return this.anchorStep + (frame - this.anchorFrame) / this.samplesPerStep;
  }

  /** Frame at which song position `step` (fractional) occurs at the current tempo. */
  private frameAt(step: number): number {
    return this.anchorFrame + (step - this.anchorStep) * this.samplesPerStep;
  }

  /** First frame at or after the current one that starts a bar (16 steps). */
  private nextBar(): number {
    const pos = this.posAt(this.frame);
    const next = Math.ceil((pos - 1e-9) / 16) * 16;
    return Math.max(this.frame, Math.round(this.frameAt(next)));
  }

  /**
   * Copies a block (absolute frame f0) into the resample buffers once capture has started.
   * Track sources pass their raw buffer plus the gain and drive used in the mix.
   */
  private capture(l: Float32Array, r: Float32Array, n: number, f0: number, gain: number, drive: number): void {
    const cl = this.capL;
    const cr = this.capR;
    if (!cl || !cr) return;
    for (let i = 0; i < n; i++) {
      if (f0 + i < this.capStart) continue;
      if (this.capPos >= cl.length) break;
      cl[this.capPos] = softClip(l[i]!, drive) * gain;
      cr[this.capPos] = softClip(r[i]!, drive) * gain;
      this.capPos++;
    }
    if (this.capPos >= cl.length) {
      this.capSource = -2;
      this.capL = null;
      this.capR = null;
      this.emit({ type: 'resampled', id: this.capId, l: cl, r: cr });
    }
  }

  /** First frame at or after the current one that falls on a straight 1/16 boundary. */
  private nextSixteenth(): number {
    const pos = this.posAt(this.frame);
    const next = Math.ceil(pos - 1e-9);
    return Math.max(this.frame, Math.round(this.frameAt(next)));
  }

  /** Swing delays every odd 16th by (2 * swing - 1) steps: 50 % = straight, 75 % = dotted. */
  private swingDelay(step: number): number {
    return (step & 1) === 1 ? (2 * this.swing) / 100 - 1 : 0;
  }

  /** Enqueue all steps whose (earliest possible) time falls before the end of this block. */
  private schedule(blockStart: number, frames: number): void {
    const posEnd = this.posAt(blockStart + frames);
    while (this.nextStep - LOOKAHEAD_STEPS < posEnd) {
      const s = this.nextStep;
      const swing = this.swingDelay(s);
      const gridFrame = this.frameAt(s + swing);
      this.emit({ type: 'step', step: s, time: this.timeOf(Math.max(gridFrame, blockStart)) });
      for (let t = 0; t < MAX_TRACKS; t++) {
        const ts = this.tracks[t]!;
        if (ts.kind === KIND_OFF) continue;
        const i = s % ts.length;
        const type = ts.type[i]!;
        if (type !== ST_HIT && type !== ST_NOTE && type !== ST_CHORD) continue;
        const ch = ts.chance[i]!;
        if (ch < 1 && this.rng.unit() >= ch) continue;
        const at = Math.max(this.frameAt(s + swing + ts.nudge[i]!), blockStart);
        if (ts.kind === KIND_DRUM) {
          this.enqueue(at, EV_HIT, t, ts.vel[i]!, 0, 0, 1);
          continue;
        }
        if (ts.kind === KIND_SAMPLER && !ts.sampler.chromatic) {
          // One-shot: every hit, note or chord plays the sample once (at its own pitch).
          this.enqueue(at, EV_ON, t, ts.vel[i]!, ts.sampler.root, ++this.noteIds, 1);
          continue;
        }
        if (type === ST_HIT) continue;
        // FM: the note lasts until the end of the holds that follow it (legato across holds).
        let holds = 0;
        while (holds < ts.length - 1 && ts.type[(i + 1 + holds) % ts.length] === ST_HOLD) holds++;
        const end = s + 1 + holds;
        const offAt = Math.max(at + 1, this.frameAt(end + this.swingDelay(end)));
        const count = ts.noteCount[i]!;
        for (let k = 0; k < count; k++) {
          const id = ++this.noteIds;
          const note = ts.notes[i * MAX_CHORD + k]!;
          this.enqueue(at, EV_ON, t, ts.vel[i]!, note, id, 1);
          this.enqueue(offAt, EV_OFF, t, 0, note, id, 1);
        }
      }
      this.nextStep++;
    }
  }

  /** Starts an FM note. id 0 = live note (keyboard), otherwise the sequencer's note id. */
  private fmNoteOn(ts: TrackState, note: number, vel: number, id: number): void {
    const voices = ts.fmVoices;
    // Enforce polyphony: if FM_POLY notes are already sounding, fade out the oldest (released ones first).
    let sounding = 0;
    let oldest = -1;
    let oldestReleased = -1;
    for (let v = 0; v < FM_VOICES; v++) {
      const voice = voices[v]!;
      if (!voice.active || voice.stealing) continue;
      sounding++;
      if (oldest < 0 || voice.age < voices[oldest]!.age) oldest = v;
      if (!voice.gate && (oldestReleased < 0 || voice.age < voices[oldestReleased]!.age)) oldestReleased = v;
    }
    if (sounding >= FM_POLY) voices[oldestReleased >= 0 ? oldestReleased : oldest]!.stealFade();
    // Take a free voice; if all are busy (rare), reuse the quietest fading one.
    let pick = -1;
    for (let v = 0; v < FM_VOICES; v++) {
      if (!voices[v]!.active) {
        pick = v;
        break;
      }
    }
    if (pick < 0) {
      let quiet = Infinity;
      for (let v = 0; v < FM_VOICES; v++) {
        const l = voices[v]!.loudness(ts.fm);
        if (l < quiet) {
          quiet = l;
          pick = v;
        }
      }
    }
    voices[pick]!.noteOn(ts.fm, note, vel, id, id === 0, ++ts.fmAge);
  }

  private fmNoteOff(ts: TrackState, note: number, id: number): void {
    for (let v = 0; v < FM_VOICES; v++) {
      const voice = ts.fmVoices[v]!;
      if (!voice.active || !voice.gate || voice.note !== note) continue;
      if (id === 0 ? voice.live : voice.id === id) voice.noteOff(ts.fm);
    }
  }

  private dispatch(i: number): void {
    const ts = this.tracks[this.qTrack[i]!];
    if (!ts) return;
    const type = this.qType[i]!;
    if (type === EV_HIT) {
      if (ts.kind === KIND_DRUM) this.trigger(ts, this.qVel[i]!);
      else if (ts.kind === KIND_SAMPLER) this.samplerNoteOn(ts, ts.sampler.root, this.qVel[i]!, ++this.noteIds); // audition
    } else if (ts.kind === KIND_FM) {
      if (type === EV_ON) this.fmNoteOn(ts, this.qNote[i]!, this.qVel[i]!, this.qId[i]!);
      else this.fmNoteOff(ts, this.qNote[i]!, this.qId[i]!);
    } else if (ts.kind === KIND_SAMPLER) {
      if (type === EV_ON) this.samplerNoteOn(ts, this.qNote[i]!, this.qVel[i]!, this.qId[i]!);
      else this.samplerNoteOff(ts, this.qNote[i]!, this.qId[i]!);
    }
  }

  private samplerNoteOn(ts: TrackState, note: number, vel: number, id: number): void {
    if (!ts.sampler.sample) return;
    const voices = ts.samplerVoices;
    let sounding = 0;
    let oldest = -1;
    for (let v = 0; v < SAMPLER_VOICES; v++) {
      const voice = voices[v]!;
      if (!voice.active || voice.stealing) continue;
      sounding++;
      if (oldest < 0 || voice.age < voices[oldest]!.age) oldest = v;
    }
    if (sounding >= SAMPLER_POLY) voices[oldest]!.stealFade();
    let pick = -1;
    for (let v = 0; v < SAMPLER_VOICES; v++) {
      if (!voices[v]!.active) {
        pick = v;
        break;
      }
    }
    if (pick < 0) {
      let quiet = Infinity;
      for (let v = 0; v < SAMPLER_VOICES; v++) {
        const l = voices[v]!.loudness();
        if (l < quiet) {
          quiet = l;
          pick = v;
        }
      }
    }
    voices[pick]!.noteOn(ts.sampler, note, vel, id, id === 0, ++ts.fmAge);
  }

  private samplerNoteOff(ts: TrackState, note: number, id: number): void {
    for (let v = 0; v < SAMPLER_VOICES; v++) {
      const voice = ts.samplerVoices[v]!;
      if (!voice.active || !voice.gate || voice.note !== note) continue;
      if (id === 0 ? voice.live : voice.id === id) voice.noteOff(ts.sampler.chromatic);
    }
  }

  private trigger(ts: TrackState, vel: number): void {
    // Choke the sounding voices (fast fade) and start the hit on a free voice, else the quietest.
    let free = -1;
    let quietest = 0;
    for (let v = 0; v < VOICES_PER_TRACK; v++) {
      const voice = ts.voices[v]!;
      if (!voice.active) {
        if (free < 0) free = v;
        continue;
      }
      voice.release();
      if (voice.level < ts.voices[quietest]!.level || !ts.voices[quietest]!.active) quietest = v;
    }
    const pick = free >= 0 ? free : quietest;
    ts.voices[pick]!.trigger(ts.settings, vel);
  }

  private renderVoices(from: number, to: number): void {
    if (to <= from) return;
    for (let t = 0; t < MAX_TRACKS; t++) {
      const ts = this.tracks[t]!;
      // Both pools render (idle voices return at once) so a kind switch lets old voices fade out.
      for (let v = 0; v < FM_VOICES; v++) ts.fmVoices[v]!.render(ts.fm, ts.buf, from, to);
      for (let v = 0; v < SAMPLER_VOICES; v++) ts.samplerVoices[v]!.render(ts.buf, from, to);
      for (let v = 0; v < VOICES_PER_TRACK; v++) ts.voices[v]!.render(ts.buf, from, to);
    }
  }

  /** Renders `frames` samples into left/right (overwrites). */
  process(left: Float32Array, right: Float32Array, frames: number): void {
    const n = Math.min(frames, MAX_BLOCK);
    const blockStart = this.frame;
    const blockEnd = blockStart + n;
    for (let t = 0; t < MAX_TRACKS; t++) this.tracks[t]!.buf.fill(0, 0, n);

    if (this.playing) this.schedule(blockStart, n);

    // Render up to each due event, fire it, continue: sample-accurate triggers.
    let cursor = 0;
    for (;;) {
      let best = -1;
      let bestF = blockEnd;
      for (let i = 0; i < this.qLen; i++) {
        const f = this.qFrame[i]!;
        if (f < bestF) {
          bestF = f;
          best = i;
        }
      }
      if (best < 0) break;
      const off = Math.max(cursor, Math.min(n, Math.round(bestF - blockStart)));
      this.renderVoices(cursor, off);
      cursor = off;
      this.dispatch(best);
      this.removeAt(best);
    }
    this.renderVoices(cursor, n);

    // Mix: per-track drive and smoothed level/mute gain, mono to center; sends to reverb/delay.
    // The punch-in FX target track is mixed into fxL/fxR first so the chain can process it alone.
    left.fill(0, 0, n);
    right.fill(0, 0, n);
    const revIn = this.revIn;
    const delIn = this.delIn;
    revIn.fill(0, 0, n);
    delIn.fill(0, 0, n);
    const punch = this.punch;
    // The target track is always routed separately so the chain can keep its history for Reverse.
    const fxTrack = punch.target >= 0 ? punch.target : -1;
    if (fxTrack >= 0) {
      this.fxL.fill(0, 0, n);
      this.fxR.fill(0, 0, n);
    }
    const k = this.smoothK;
    for (let t = 0; t < MAX_TRACKS; t++) {
      const ts = this.tracks[t]!;
      const target = this.targetGain(ts);
      if (target === 0 && ts.gain < 1e-6) {
        ts.gain = 0;
        continue;
      }
      const buf = ts.buf;
      const drive = ts.drive;
      const outL = t === fxTrack ? this.fxL : left;
      const outR = t === fxTrack ? this.fxR : right;
      let g = ts.gain;
      let pk = ts.peak;
      let a = ts.curA;
      let b = ts.curB;
      const ta = ts.sendA;
      const tb = ts.sendB;
      for (let i = 0; i < n; i++) {
        g += (target - g) * k;
        a += (ta - a) * k;
        b += (tb - b) * k;
        const y = softClip(buf[i]!, drive) * g;
        const m = Math.abs(y);
        if (m > pk) pk = m;
        outL[i]! += y;
        outR[i]! += y;
        revIn[i]! += y * a;
        delIn[i]! += y * b;
      }
      if (t === this.capSource) this.capture(ts.buf, ts.buf, n, blockStart, g, drive);
      ts.gain = g;
      ts.peak = pk;
      ts.curA = a;
      ts.curB = b;
    }
    const sps = this.samplesPerStep;
    if (fxTrack >= 0) {
      if (punch.busy) punch.process(this.fxL, this.fxR, n, blockStart, sps, this.injRev, this.injDel, this.reverb, this.delay);
      else punch.record(this.fxL, this.fxR, n);
      for (let i = 0; i < n; i++) {
        left[i]! += this.fxL[i]!;
        right[i]! += this.fxR[i]!;
      }
    }
    // Send returns (throws injected by the chain join the buses here).
    for (let i = 0; i < n; i++) {
      revIn[i]! += this.injRev[i]!;
      delIn[i]! += this.injDel[i]!;
    }
    this.injRev.fill(0, 0, n);
    this.injDel.fill(0, 0, n);
    this.reverb.process(revIn, left, right, n);
    this.delay.process(delIn, left, right, n);
    // Master punch-in FX (also processes the send returns).
    if (punch.target < 0) {
      if (punch.busy) punch.process(left, right, n, blockStart, sps, this.injRev, this.injDel, this.reverb, this.delay);
      else punch.record(left, right, n);
    }
    if (!punch.busy) {
      // No effect running: send effects at their defaults, delay time following the tempo.
      this.reverb.setDecay(DEFAULT_REVERB_S);
      this.delay.setTime((DEFAULT_DELAY_STEPS * sps) / this.sampleRate);
      this.delay.setFeedback(DEFAULT_DELAY_FB);
    }
    const mg = this.masterGain;
    for (let i = 0; i < n; i++) {
      left[i] = left[i]! * mg;
      right[i] = right[i]! * mg;
    }
    if (this.capSource === -1) this.capture(left, right, n, blockStart, 1, 0);
    this.limiter.process(left, right, n);

    let mp = this.masterPeak;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      if (a > mp) mp = a;
    }
    this.masterPeak = mp;

    this.frame = blockEnd;

    this.meterFrames += n;
    if (this.meterFrames >= this.meterEvery) {
      this.meterFrames = 0;
      if (this.playing || this.masterPeak > 1e-4) {
        for (let t = 0; t < MAX_TRACKS; t++) {
          this.meterTracks[t] = this.tracks[t]!.peak;
          this.tracks[t]!.peak = 0;
        }
        // Throttled (~30 Hz): the only allocation is the structured clone done by postMessage.
        this.emit({ type: 'meters', tracks: this.meterTracks, master: this.masterPeak });
        this.masterPeak = 0;
      }
    }
  }
}
