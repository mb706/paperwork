// The messages between the main thread and the voice bank (10 §9.4). Shared by both sides; no DOM.
//
// Notes travel as records of NF float64 fields, many per message: at most one message per scheduler tick
// for the music (10 per second) and one per animation frame for SFX that sound at once. The bank copies
// them into a preallocated queue of QCAP notes; `process()` never allocates.

export const NF = 22;
/** A note record's fields. Times are context seconds; levels linear. */
export const F = {
  /** Start time. */
  TIME: 0,
  KIND: 1,
  /** Sample buffer id (SAMPLE) or wavetable id (ORGAN). */
  SRC: 2,
  /** Destination: a music channel (slot · MAX_CH + channel) or SFX_DEST + an SFX bus. */
  DEST: 3,
  GROUP: 4,
  /** SAMPLE: playback-rate ratio against the buffer's own rate. Oscillators: frequency (Hz). */
  RATE: 5,
  /** Peak gain. */
  GAIN: 6,
  /** SFX only: −1..1 (music voices take their channel's pan). */
  PAN: 7,
  ATTACK: 8,
  /** 0: linear attack from 0; 1: `setTargetAtTime(gain, t, attack / 3)`. */
  ATK_EXP: 9,
  /** Release start. */
  OFF: 10,
  /** Release (s); the decay's time constant is release ÷ 4.5. */
  RELEASE: 11,
  /** Hard stop: a 3 ms fade from here. Infinity for loops. */
  STOP: 12,
  /** Seconds into the sample. */
  OFFSET: 13,
  /** Loop points in the buffer's samples; LOOP_E 0 means no loop. */
  LOOP_S: 14,
  LOOP_E: 15,
  /** SFX: the sound id, for the per-type voice cap; −1 none. */
  TYPE: 16,
  /** SFX: the per-type voice cap. */
  CAP: 17,
  /** Stealing order: lower priority goes first. */
  PRIO: 18,
  /** A handle for later control (working loops); 0 none. */
  HANDLE: 19,
  /** BELL: the decay length T (s). */
  AUX: 20,
  /** 1: gain and pan are smoothed (one-pole, 50 ms), for loops whose level follows the game. */
  SMOOTH: 21,
} as const;

export const KIND = { SAMPLE: 0, SINE: 1, ORGAN: 2, BELL: 3 } as const;
export const GROUP = { MUSIC: 0, SFX: 1 } as const;

/** Era slots: at most two eras sound at once, crossfading (10 §9.4). */
export const MAX_SLOTS = 2;
/** Channels per slot. */
export const MAX_CH = 16;
/** DEST values from here on are SFX buses. */
export const SFX_DEST = 64;
/** The SFX buses (I §4.20's categories, without Master and Music), in bus order. */
export const SFX_BUSES = ['gui', 'effects', 'alerts', 'environment', 'walking', 'ambient'] as const;
export type SfxBus = (typeof SFX_BUSES)[number];
/** World buses: muted in map view, faded while a game is paused (10 §9.4); GUI and alerts always sound. */
export const WORLD_BUSES: readonly SfxBus[] = ['effects', 'environment', 'walking', 'ambient'];
/**
 * The bank's outputs: the music (both era slots, each through its reverb, air shelf and era gain), the
 * world SFX and the other SFX (each bus after its fader), then the taps of stems renders.
 */
export const OUT_MUSIC = 0;
export const OUT_WORLD = 1;
export const OUT_UI = 2;
export const OUT_TAPS = 3;
/** Tap channels besides a channel index: a slot's reverb return (after its gain), and its reverb send. */
export const TAP_REVERB = -1;
export const TAP_SEND = -2;

/** Voice caps (10 §9.4): 48 music and 24 SFX voices, plus spares for voices fading out after a steal. */
export const MUSIC_VOICES = 48;
export const SFX_VOICES = 24;
export const SPARE_VOICES = 16;
export const QCAP = 2048;
export const MAX_BUFFERS = 4096;
export const MAX_TYPES = 4096;
export const MAX_WAVES = 16;

export interface EqConfig {
  type: 'peaking' | 'highshelf' | 'lowshelf' | 'highpass' | 'lowpass';
  f: number;
  q: number;
  gain: number;
}

export type InsertConfig =
  | {
      kind: 'tape';
      wowHz: number;
      wowMs: number;
      flutterHz: number;
      flutterMs: number;
      drive: number;
      lowpass: number;
      highpass: number;
    }
  | { kind: 'tremolo'; rate: number; depth: number };

export type FeedConfig =
  | {
      kind: 'echo';
      from: number;
      time: number;
      feedback: number;
      lowpass: number;
      highpass: number;
      wowMs: number;
      wowHz: number;
    }
  | { kind: 'noise'; gainDb: number; highpass: number; lowpass: number; seed: number };

export interface ChannelConfig {
  index: number;
  /** Carries stereo voices (a stereo sample pack) or a stereo feed. */
  stereo: boolean;
  trim: number;
  pan: number;
  dry: number;
  send: number;
  eq: EqConfig[];
  inserts: InsertConfig[];
  feed: FeedConfig | null;
}

/** An automation event on a channel parameter, as `setValueAtTime` (kind 0) or `setTargetAtTime` (1). */
export type AutoEvent = [kind: 0 | 1, time: number, value: number, tau: number];
/**
 * Automatable channel parameters. `echoReturn` is the tape echo's output level; an event on `echoErase` erases
 * the echo's tape (its delay line and filter history) at the event's time, whatever its value (the harmonic
 * gate, codex C7-r1 finding 11).
 */
export type ChannelParam = 'fader' | 'echoFeedback' | 'echoReturn' | 'echoErase';

export type ToBank =
  | { t: 'buf'; id: number; chans: Int16Array[]; rate: number }
  | { t: 'free'; id: number }
  | { t: 'wave'; id: number; harmonics: number[] }
  | { t: 'notes'; n: number; data: Float64Array }
  /** Working loops: records of [handle, gain, pan, release (0/1), tau]. */
  | { t: 'ctl'; n: number; data: Float64Array }
  | { t: 'layout'; slot: number; channels: ChannelConfig[] }
  | { t: 'auto'; slot: number; channel: number; param: ChannelParam; events: AutoEvent[] }
  /** Fade every voice of a slot (or of all SFX) over `fade` s and drop its pending notes. */
  | { t: 'clear'; slot: number | 'sfx'; fade: number }
  /** An era slot's room: its FDN reverb (cleared), the return's gain (linear) and the air shelf (dB at 7 kHz). */
  | { t: 'room'; slot: number; reverb: FdnConfig; wet: number; airDb: number }
  /**
   * A slot's era gain (linear) from audio time `at`: as `cancelScheduledValues(at)` then
   * `setTargetAtTime(gain, at, seconds / 4)`, or `setValueAtTime(gain, at)` when `seconds` is 0.
   */
  | { t: 'fade'; slot: number; gain: number; at: number; seconds: number }
  /** The SFX buses' fader gains (linear, SFX_BUSES order) from audio time `at`, approached with `tau` (0: at once). */
  | { t: 'buses'; gains: number[]; at: number; tau: number }
  | { t: 'taps'; list: { slot: number; channel: number }[] }
  | { t: 'stats' }
  /** Asks for the `ended` report (the SFX system polls while it keeps loops). */
  | { t: 'poll' }
  /** A test hook: the processor throws from its next process(), as a failing processor would. */
  | { t: 'crash' }
  | { t: 'sync'; seq: number };

export interface BankStats {
  t: 'stats';
  active: number;
  maxActive: number;
  /** The most SFX voices counted at once (the CPU load must reach the 24-voice cap). */
  maxSfx: number;
  activeMusic: number;
  activeSfx: number;
  stolen: number;
  /** Notes dropped by the bank: queue full, buffer missing, no voice free. */
  dropped: number;
  pending: number;
  buffers: number;
  /** Int16 samples held, in bytes. */
  bytes: number;
  /** Render quanta processed. */
  quanta: number;
}

export type FromBank =
  | BankStats
  | { t: 'sync'; seq: number }
  | { t: 'error'; message: string }
  /** Working loops whose voices ended without a release: stolen, dropped, or their buffer freed. */
  | { t: 'ended'; handles: number[] };

/** FDN reverb configuration (10 §9.4): one reverb per era slot, inside the bank. */
export interface FdnConfig {
  /** T60 (s) below 350 Hz, mid band, above 3.5 kHz. */
  t60: [number, number, number];
  predelay: number;
  /** Line-length scale: 1 for a hall, smaller for a plate. */
  size: number;
  /** Output gain, linear, calibrated so the wet level matches A4's normalised convolution (§9.4). */
  gain: number;
}
