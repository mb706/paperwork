// The music engine's contracts: notes, pieces, the host a piece plays through, and an era's channel layout
// (A4 DIRECTION §6.2; 10 §9.4). A piece is a rule set that turns (seed, game state) into note events; the
// host turns notes into voices of the voice bank.

/** Per-note options, as A4's instruments read them. */
export interface NoteOpts {
  /** Attack (s). Samplers: linear from 0 for the first segment; synths: linear. */
  attack?: number;
  /** Release (s): the time constant is release ÷ 4.5, as `setTargetAtTime(0, off, release / 4.5)`. */
  release?: number;
  gainDb?: number;
  /** Tape speed (playback-rate multiplier): transposes like tape (0.5 is an octave down). */
  rate?: number;
  /** Seconds into the sample. */
  offset?: number;
  /** Force a velocity layer. */
  layer?: number;
}

export interface NoteEvent {
  /** Start, in the host's clock (seconds). */
  t: number;
  /** Instrument name in the era layout. */
  inst: string;
  midi: number;
  /** 0..1 (up to 1.2 allowed by the validity check of A4 §6.6). */
  vel: number;
  /** Held length (s). */
  dur: number;
  opts: NoteOpts;
}

/** The game state the rules may read (A4 §5; 10 §15.6's music feed). Presentation only. */
export interface MusicState {
  /** Factory busyness 0..1, normalised and smoothed by the audio module (10 §15.6). */
  activity: number;
  /** The Literature year (picks the era when a piece starts). */
  literatureYear: number;
  /** The takeoff's doubling time (s), or null before it. */
  doublingTime: number | null;
  /** Closure happened (the first System card written by a Research hall). */
  closure: boolean;
  victory: boolean;
}

export const defaultMusicState = (): MusicState => ({
  activity: 0.5,
  literatureYear: 1945,
  doublingTime: null,
  closure: false,
  victory: false,
});

/** Channel parameters a piece may automate, as AudioParam automation in the prototype. */
export type ChannelParam = 'fader' | 'echoFeedback';

/** What a piece plays through. */
export interface PieceHost {
  readonly state: Readonly<MusicState>;
  play(ev: NoteEvent): void;
  /** `setValueAtTime` on a channel parameter (absolute host time). */
  setParam(channel: string, param: ChannelParam, t: number, value: number): void;
  /** `setTargetAtTime` on a channel parameter. */
  targetParam(channel: string, param: ChannelParam, t: number, value: number, tau: number): void;
}

export interface PieceParams {
  seed?: number;
  /** Semitones; the conductor walks the circle of fifths (−5..+6). */
  transpose?: number;
  tempoScale?: number;
  /** Seconds. */
  duration?: number;
  /** Absolute host time of the piece's 0. */
  start?: number;
  /** The post-victory callback: the same notes played by the machine (quantised, even touch). */
  machine?: boolean;
}

export interface Piece {
  readonly T0: number;
  readonly D: number;
  /** Play every note that starts in [t0, t1) (absolute host time). */
  schedule(t0: number, t1: number): void;
  /** True once the piece and its tails are over. */
  done(now: number): boolean;
}

// ---------------------------------------------------------------- the era layout (the prototype's setup())

export interface EqBand {
  type: 'peaking' | 'highshelf' | 'lowshelf' | 'highpass' | 'lowpass';
  f: number;
  /** Peaking: linear Q. Lowpass and highpass: Q in dB, as BiquadFilterNode reads it. */
  q?: number;
  gain?: number;
}

/** A4's tape machine: wow and flutter, saturation and a 1960s bandwidth (A4 `mixer.js` `tape`). */
export interface TapeParams {
  wowHz?: number;
  wowMs?: number;
  flutterHz?: number;
  flutterMs?: number;
  drive?: number;
  lowpass?: number;
  highpass?: number;
}

export type InsertDef = { kind: 'tape'; tape: TapeParams } | { kind: 'tremolo'; rate: number; depth: number };

/** Riley's time-lag accumulator (A4 `mixer.js` `tapeEcho`), fed from another channel after its pan. */
export interface EchoParams {
  time: number;
  feedback: number;
  lowpass: number;
  highpass: number;
  wowMs: number;
  wowHz?: number;
}

/** A looping noise bed (tape hiss; A4 `mixer.js` `noiseBed`). */
export interface NoiseParams {
  gainDb: number;
  highpass: number;
  lowpass: number;
  seed: number;
}

export interface ChannelDef {
  name: string;
  trimDb: number;
  pan: number;
  /** Reverb send (dB); null for none. */
  sendDb: number | null;
  dryDb?: number;
  eq?: EqBand[];
  inserts?: InsertDef[];
  /** A channel fed by a generator instead of (or as well as) instruments. */
  feed?: { kind: 'echo'; from: string; echo: EchoParams } | { kind: 'noise'; noise: NoiseParams };
}

export type SourceDef =
  | { kind: 'sampler'; pack: string /** velocity-layer crossfades (A4 §6.5 #2) */; xfade: boolean }
  | { kind: 'organ'; drawbars: Readonly<Record<number, number>> }
  | { kind: 'sine' }
  | { kind: 'bell' };

export interface InstrumentDef {
  name: string;
  channel: string;
  source: SourceDef;
}

export type ReverbPreset = 'hall' | 'plate' | 'digital' | 'vast';

export interface EraLayout {
  /** The piece id ('era1', 'era2', …). */
  id: string;
  reverb: { preset: ReverbPreset; wetDb: number };
  /** The air shelf on the era bus (dB above 7 kHz). */
  airDb: number;
  channels: ChannelDef[];
  instruments: InstrumentDef[];
}

export interface PieceSpec {
  id: string;
  layout: EraLayout;
  create(host: PieceHost, params: PieceParams): Piece;
}
