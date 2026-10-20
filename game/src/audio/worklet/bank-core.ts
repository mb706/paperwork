// The voice bank (10 §9.4): every sampler voice of the music and the SFX, the synthesised voices (sine,
// drawbar organ, Risset bell), the music channels' strips (trim, EQ, tape, tremolo, the tape echo, the
// hiss, pan, dry and reverb send), each era slot's room (its FDN reverb, the return, the air shelf, the
// era gain) and the SFX buses' faders, mixed in one AudioWorklet. Its outputs are the music, the world SFX
// and the other SFX (GUI, alerts). Native nodes do the rest: the music's low cut and glue compressor, the
// gates, the Music and Master faders, the limiter.
//
// Why the rooms and bus faders are here and not native nodes (C7's measurement, Chrome 156): beside an
// AudioWorklet every native node renders on the worklet's thread at several times its usual cost, about
// 0.1 % of a host core per GainNode and 0.9 % per further worklet node, so an idle graph of three worklets
// and 30 native nodes cost 9.5 points of a core before a note played.
//
// This file is the processor's core without the AudioWorkletGlobalScope, so Node tests drive it directly.
// Rules (10 §9.4, "The processors"): nothing allocates in `process()`; everything is set up from messages;
// the work per render quantum is bounded by the voice caps (48 music, 24 SFX) and the 12 working loops.
//
// The channel strip reproduces A4's prototype graph exactly (`engine/mixer.js`): voice → trim (the fader)
// → EQ → inserts → StereoPanner (equal power, mono or stereo law) → dry and send. Channels whose voices are
// mono are processed in mono up to the pan, as the Web Audio graph does, which also halves their cost.
import {
  biquadCoefs,
  biquadRun,
  harmonicTable,
  lookup,
  panMono,
  panStereo,
  RISSET_BELL,
  RISSET_SUM,
  SINE_SIZE,
  saturationCurve,
  shape,
  sineTable,
  xorshift,
} from './dsp.ts';
import { FdnCore } from './fdn-core.ts';
import {
  type AutoEvent,
  type BankStats,
  type ChannelConfig,
  F,
  type FdnConfig,
  type FeedConfig,
  GROUP,
  type InsertConfig,
  KIND,
  MAX_BUFFERS,
  MAX_CH,
  MAX_SLOTS,
  MAX_TYPES,
  MAX_WAVES,
  MUSIC_VOICES,
  NF,
  OUT_MUSIC,
  OUT_TAPS,
  OUT_UI,
  OUT_WORLD,
  QCAP,
  SFX_BUSES,
  SFX_DEST,
  SFX_VOICES,
  SPARE_VOICES,
  TAP_REVERB,
  TAP_SEND,
  type ToBank,
  WORLD_BUSES,
} from './protocol.ts';

const BLOCK = 128;
const MAXV = MUSIC_VOICES + SFX_VOICES + SPARE_VOICES;
const NB = RISSET_BELL.length;
const NSFX = SFX_BUSES.length;
const WORLD = SFX_BUSES.map((b) => WORLD_BUSES.includes(b));
/** The air shelf's corner (A4 `mixer.js`: a high shelf at 7 kHz on each era bus). */
const AIR_HZ = 7000;

// voice phases
const P_OFF = 0;
const P_ATK_LIN = 1;
const P_ATK_EXP = 2;
const P_SUS = 3;
const P_REL = 4;
const P_FADE = 5;

/** A stolen or stopped voice fades over 3 ms: never a click (10 §9.4; A4 §7.1 "soft attacks"). */
const FADE_S = 0.003;
/** Working loops follow the game through a 50 ms one-pole on gain and pan. */
const SMOOTH_S = 0.05;

interface SampleBuf {
  c0: Int16Array;
  c1: Int16Array;
  stereo: boolean;
  /** The buffer's own sample rate (32 kHz canonical). */
  rate: number;
  len: number;
}

/** WebAudio-style automation of one parameter: setValueAtTime and setTargetAtTime events, sorted. */
class Param {
  v: number;
  private target: number;
  private k = 0;
  private targeting = false;
  private readonly time = new Float64Array(64);
  private readonly kind = new Uint8Array(64);
  private readonly value = new Float64Array(64);
  private readonly tau = new Float64Array(64);
  private n = 0;

  constructor(v: number) {
    this.v = v;
    this.target = v;
  }

  get pending(): boolean {
    return this.n > 0 || this.targeting;
  }

  /** Adds an event at `frame` (outside process()). */
  add(kind: 0 | 1, frame: number, value: number, tauFrames: number): void {
    if (this.n === this.time.length) return; // a full timeline drops the event; 64 is far above any piece's use
    let i = this.n++;
    while (i > 0 && (this.time[i - 1] as number) > frame) {
      this.time[i] = this.time[i - 1] as number;
      this.kind[i] = this.kind[i - 1] as number;
      this.value[i] = this.value[i - 1] as number;
      this.tau[i] = this.tau[i - 1] as number;
      i--;
    }
    this.time[i] = frame;
    this.kind[i] = kind;
    this.value[i] = value;
    this.tau[i] = tauFrames;
  }

  clear(v: number): void {
    this.n = 0;
    this.targeting = false;
    this.v = v;
    this.target = v;
  }

  /** Drops the events at or after `frame` (cancelScheduledValues; a running approach goes on). */
  cancelFrom(frame: number): void {
    let i = 0;
    while (i < this.n && this.time[i]! < frame) i++;
    this.n = i;
  }

  /** Applies and removes the first event. */
  private shift(): void {
    if (this.kind[0] === 0) {
      this.v = this.value[0]!;
      this.targeting = false;
    } else {
      this.target = this.value[0]!;
      this.k = 1 - Math.exp(-1 / Math.max(1, this.tau[0]!));
      this.targeting = true;
    }
    this.n--;
    this.time.copyWithin(0, 1, this.n + 1);
    this.kind.copyWithin(0, 1, this.n + 1);
    this.value.copyWithin(0, 1, this.n + 1);
    this.tau.copyWithin(0, 1, this.n + 1);
  }

  /** `m` samples of the exponential approach at once. */
  private approach(m: number): void {
    if (!this.targeting || m <= 0) return;
    this.v = this.target + (this.v - this.target) * (1 - this.k) ** m;
    if (Math.abs(this.target - this.v) < 1e-9) {
      this.v = this.target;
      this.targeting = false;
    }
  }

  /** The value at the next sample, at absolute frame f. */
  step(f: number): number {
    while (this.n > 0 && this.time[0]! <= f) this.shift();
    if (this.targeting) {
      this.v += (this.target - this.v) * this.k;
      if (Math.abs(this.target - this.v) < 1e-9) {
        this.v = this.target;
        this.targeting = false;
      }
    }
    return this.v;
  }

  /** Moves the automation over `n` samples from frame `f` without reading it (no one is listening). */
  advance(f: number, n: number): void {
    const end = f + n;
    let t = f;
    while (this.n > 0 && this.time[0]! < end) {
      const te = Math.max(t, Math.ceil(this.time[0]!));
      this.approach(te - t);
      t = te;
      this.shift();
    }
    this.approach(end - t);
  }
}

/** An era slot's room: its FDN reverb, the return's gain, the air shelf and the era gain. */
class Room {
  readonly fdn: FdnCore;
  wet = 0;
  air = false;
  readonly airC = new Float64Array(5);
  readonly airZ = new Float64Array(4);
  /** The era gain: silent until a piece starts; crossfades ramp it (10 §9.4, A4 §5.4). */
  readonly gain = new Param(0);
  readonly wetL = new Float32Array(BLOCK);
  readonly wetR = new Float32Array(BLOCK);
  readonly sumL = new Float32Array(BLOCK);
  readonly sumR = new Float32Array(BLOCK);
  /** Stems renders read the return: process it even while the era gain is 0. */
  tapped = false;

  constructor(sr: number) {
    this.fdn = new FdnCore(sr);
  }
}

/** A4's tape: wow and flutter (a modulated 12 ms delay), saturation, the bandwidth of a 1960s machine. */
class Tape {
  readonly size: number;
  readonly bufL: Float32Array;
  readonly bufR: Float32Array;
  w = 0;
  ph1 = 0;
  ph2 = 0;
  readonly inc1: number;
  readonly inc2: number;
  readonly base: number;
  readonly d1: number;
  readonly d2: number;
  readonly curve: Float32Array;
  readonly post: number;
  readonly coef = new Float64Array(10);
  readonly z = new Float64Array(8);

  constructor(p: Extract<InsertConfig, { kind: 'tape' }>, sr: number) {
    this.size = Math.ceil(0.1 * sr);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.inc1 = p.wowHz / sr;
    this.inc2 = p.flutterHz / sr;
    this.base = 0.012 * sr;
    this.d1 = (p.wowMs / 1000) * sr;
    this.d2 = (p.flutterMs / 1000) * sr;
    this.curve = saturationCurve(p.drive);
    this.post = Math.tanh(p.drive) / (0.7 * p.drive); // unity small-signal gain through pre · shaper · post
    biquadCoefs('lowpass', p.lowpass, 0.5, 0, sr, this.coef, 0);
    biquadCoefs('highpass', p.highpass, 1, 0, sr, this.coef, 5);
  }

  run(L: Float32Array, R: Float32Array | null, n: number, sine: Float32Array): void {
    const size = this.size;
    const bL = this.bufL;
    const bR = this.bufR;
    let w = this.w;
    let ph1 = this.ph1;
    let ph2 = this.ph2;
    for (let s = 0; s < n; s++) {
      bL[w] = L[s]!;
      if (R) bR[w] = R[s]!;
      const d = this.base + this.d1 * lookup(sine, ph1) + this.d2 * lookup(sine, ph2);
      let rp = w - d;
      if (rp < 0) rp += size;
      const i0 = rp | 0;
      const fr = rp - i0;
      const i1 = i0 + 1 === size ? 0 : i0 + 1;
      L[s] = shape(this.curve, 0.7 * (bL[i0]! + (bL[i1]! - bL[i0]!) * fr)) * this.post;
      if (R) R[s] = shape(this.curve, 0.7 * (bR[i0]! + (bR[i1]! - bR[i0]!) * fr)) * this.post;
      ph1 += this.inc1;
      if (ph1 >= 1) ph1 -= 1;
      ph2 += this.inc2;
      if (ph2 >= 1) ph2 -= 1;
      w = w + 1 === size ? 0 : w + 1;
    }
    this.w = w;
    this.ph1 = ph1;
    this.ph2 = ph2;
    biquadRun(L, n, this.coef, 0, this.z, 0);
    biquadRun(L, n, this.coef, 5, this.z, 2);
    if (R) {
      biquadRun(R, n, this.coef, 0, this.z, 4);
      biquadRun(R, n, this.coef, 5, this.z, 6);
    }
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.z.fill(0);
  }
}

/** A vibraphone motor or organ tremolo: gain 1 − depth/2 + depth/2 · sin(2π·rate·t). */
class Tremolo {
  ph = 0;
  readonly inc: number;
  readonly depth: number;
  constructor(p: Extract<InsertConfig, { kind: 'tremolo' }>, sr: number) {
    this.inc = p.rate / sr;
    this.depth = p.depth;
  }
  run(L: Float32Array, R: Float32Array | null, n: number, sine: Float32Array): void {
    const a = 1 - this.depth / 2;
    const b = this.depth / 2;
    let ph = this.ph;
    for (let s = 0; s < n; s++) {
      const g = a + b * lookup(sine, ph);
      L[s] = L[s]! * g;
      if (R) R[s] = R[s]! * g;
      ph += this.inc;
      if (ph >= 1) ph -= 1;
    }
    this.ph = ph;
  }
}

/**
 * Riley's time-lag accumulator (A4 `tapeEcho`): a long delay whose loop runs through a lowpass, a highpass
 * and tape saturation, with a little wow. Its input is another channel after its pan; its output carries
 * only the echoes. The feedback is automated (the harmonic gate, DIRECTION §4.1).
 */
class Echo {
  readonly from: number;
  readonly size: number;
  readonly bufL: Float32Array;
  readonly bufR: Float32Array;
  w = 0;
  ph = 0;
  readonly inc: number;
  readonly time: number;
  readonly depth: number;
  readonly curve: Float32Array;
  readonly coef = new Float64Array(10);
  readonly z = new Float64Array(8);
  readonly fb: Param;
  /** The return: the echo's output level (the harmonic gate mutes it around a drone change). */
  readonly ret = new Param(1);
  /** Frames at which the tape is erased (delay line and filter history), sorted. */
  private readonly eraseAt = new Float64Array(16);
  private nErase = 0;
  /** The last frame that wrote a non-silent sample into the loop. */
  lastIn = Number.NEGATIVE_INFINITY;
  readonly tail: number;

  constructor(p: Extract<FeedConfig, { kind: 'echo' }>, sr: number) {
    this.from = p.from;
    this.size = Math.ceil((p.time + 0.5) * sr);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.inc = p.wowHz / sr;
    this.time = p.time * sr;
    this.depth = (p.wowMs / 1000) * sr;
    this.curve = saturationCurve(1.2);
    biquadCoefs('lowpass', p.lowpass, 1, 0, sr, this.coef, 0);
    biquadCoefs('highpass', p.highpass, 1, 0, sr, this.coef, 5);
    this.fb = new Param(p.feedback);
    // repeats until −80 dB at a loop gain of about 0.55 (feedback · the shaper's small-signal gain)
    this.tail =
      this.time * Math.ceil(Math.log(1e-4) / Math.log(Math.max(0.05, Math.min(0.95, p.feedback * 1.45))));
  }

  /** Erases the tape at `frame` (outside process()); a full list drops the event. */
  addErase(frame: number): void {
    if (this.nErase === this.eraseAt.length) return;
    let i = this.nErase++;
    while (i > 0 && this.eraseAt[i - 1]! > frame) {
      this.eraseAt[i] = this.eraseAt[i - 1]!;
      i--;
    }
    this.eraseAt[i] = frame;
  }

  /** The tape erased: nothing recorded before this frame can come out again. */
  private erase(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.z.fill(0);
    this.lastIn = Number.NEGATIVE_INFINITY;
    this.nErase--;
    this.eraseAt.copyWithin(0, 1, this.nErase + 1);
  }

  /** Adds the echoes of (inL, inR) into (outL, outR). */
  run(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    n: number,
    f0: number,
    sine: Float32Array,
  ): void {
    const size = this.size;
    const bL = this.bufL;
    const bR = this.bufR;
    const c = this.coef;
    const z = this.z;
    let w = this.w;
    let ph = this.ph;
    const ret = this.ret;
    for (let s = 0; s < n; s++) {
      while (this.nErase > 0 && this.eraseAt[0]! <= f0 + s) this.erase();
      const fb = this.fb.step(f0 + s);
      const g = ret.pending ? ret.step(f0 + s) : ret.v;
      let rp = w - (this.time + this.depth * lookup(sine, ph));
      if (rp < 0) rp += size;
      const i0 = rp | 0;
      const fr = rp - i0;
      const i1 = i0 + 1 === size ? 0 : i0 + 1;
      // left: lowpass, highpass (TDF-II), saturation
      let x = bL[i0]! + (bL[i1]! - bL[i0]!) * fr;
      let y = c[0]! * x + z[0]!;
      z[0] = c[1]! * x - c[3]! * y + z[1]!;
      z[1] = c[2]! * x - c[4]! * y;
      x = y;
      y = c[5]! * x + z[2]!;
      z[2] = c[6]! * x - c[8]! * y + z[3]!;
      z[3] = c[7]! * x - c[9]! * y;
      const yl = shape(this.curve, y);
      // right
      x = bR[i0]! + (bR[i1]! - bR[i0]!) * fr;
      y = c[0]! * x + z[4]!;
      z[4] = c[1]! * x - c[3]! * y + z[5]!;
      z[5] = c[2]! * x - c[4]! * y;
      x = y;
      y = c[5]! * x + z[6]!;
      z[6] = c[6]! * x - c[8]! * y + z[7]!;
      z[7] = c[7]! * x - c[9]! * y;
      const yr = shape(this.curve, y);
      const il = inL[s]!;
      const ir = inR[s]!;
      if (il !== 0 || ir !== 0) this.lastIn = f0 + s;
      bL[w] = il + fb * yl;
      bR[w] = ir + fb * yr;
      outL[s] = outL[s]! + yl * g;
      outR[s] = outR[s]! + yr * g;
      ph += this.inc;
      if (ph >= 1) ph -= 1;
      w = w + 1 === size ? 0 : w + 1;
    }
    this.w = w;
    this.ph = ph;
    for (let i = 0; i < 8; i++) if (Math.abs(z[i]!) < 1e-25) z[i] = 0;
  }

  /** Still sounding at frame f: recent input, or a scheduled erase or return change to reach. */
  active(f: number): boolean {
    return f - this.lastIn < this.tail + this.size;
  }

  /** Something is scheduled (an erase or a return change) that must be run at its time. */
  get pending(): boolean {
    return this.nErase > 0 || this.ret.pending;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.z.fill(0);
    this.lastIn = Number.NEGATIVE_INFINITY;
    this.ret.clear(1);
    this.nErase = 0;
  }
}

/** A noise bed (A4 `noiseBed`): pink-ish noise (three one-pole sums), band-limited, at a fixed level. */
class Noise {
  readonly rng = new Uint32Array(2);
  readonly b = new Float64Array(6);
  readonly coef = new Float64Array(10);
  readonly z = new Float64Array(8);
  readonly gain: number;
  constructor(p: Extract<FeedConfig, { kind: 'noise' }>, sr: number) {
    this.rng[0] = (p.seed * 2654435761) >>> 0 || 1;
    this.rng[1] = (p.seed * 2246822519 + 3266489917) >>> 0 || 2;
    this.gain = 10 ** (p.gainDb / 20);
    biquadCoefs('highpass', p.highpass, 1, 0, sr, this.coef, 0);
    biquadCoefs('lowpass', p.lowpass, 1, 0, sr, this.coef, 5);
  }
  run(L: Float32Array, R: Float32Array, n: number): void {
    const b = this.b;
    for (let ch = 0; ch < 2; ch++) {
      const out = ch === 0 ? L : R;
      let b0 = b[ch * 3]!;
      let b1 = b[ch * 3 + 1]!;
      let b2 = b[ch * 3 + 2]!;
      for (let s = 0; s < n; s++) {
        const w = xorshift(this.rng, ch);
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        out[s] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
      b[ch * 3] = b0;
      b[ch * 3 + 1] = b1;
      b[ch * 3 + 2] = b2;
      biquadRun(out, n, this.coef, 0, this.z, ch * 4);
      biquadRun(out, n, this.coef, 5, this.z, ch * 4 + 2);
      for (let s = 0; s < n; s++) out[s] = out[s]! * this.gain;
    }
  }
}

/** One channel strip of an era slot. */
class Channel {
  used = false;
  stereo = false;
  trim = 1;
  dry = 1;
  send = 0;
  readonly panG = new Float64Array(4);
  eqN = 0;
  readonly eqC = new Float64Array(5 * 4);
  readonly eqZ = new Float64Array(2 * 2 * 4);
  tapes: Tape[] = [];
  trems: Tremolo[] = [];
  /** Insert order: tape (0) or tremolo (1), with an index into its array. */
  insOrder: [number, number][] = [];
  echo: Echo | null = null;
  noise: Noise | null = null;
  readonly fader = new Param(1);
  readonly inL = new Float32Array(BLOCK);
  readonly inR = new Float32Array(BLOCK);
  readonly postL = new Float32Array(BLOCK);
  readonly postR = new Float32Array(BLOCK);
  /** Voices wrote into the input this block. */
  wrote = false;
  /** Frames to keep processing after the last voice (insert and filter tails). */
  tail = 0;
  lastVoice = Number.NEGATIVE_INFINITY;
  /** The post buffers hold non-zero data from the last block. */
  live = false;
}

export interface BankOptions {
  sampleRate: number;
  /** Extra outputs for per-channel taps (stems renders). */
  taps?: number;
}

/** The processor core. `process` is called once per render quantum with the output arrays. */
export class BankCore {
  readonly sr: number;
  private readonly sine = sineTable();
  private readonly waves: (Float32Array | null)[] = new Array(MAX_WAVES).fill(null);
  private readonly bufs: (SampleBuf | null)[] = new Array(MAX_BUFFERS).fill(null);
  private bufBytes = 0;
  private bufCount = 0;

  // the pending queue: compact, unordered; `nextDue` skips scans until the earliest note is due
  private readonly q = new Float64Array(QCAP * NF);
  private qn = 0;
  private nextDue = Number.POSITIVE_INFINITY;

  // voices (struct of arrays)
  private readonly vPh = new Uint8Array(MAXV);
  private readonly vKind = new Uint8Array(MAXV);
  private readonly vSrc = new Int32Array(MAXV);
  private readonly vDest = new Int32Array(MAXV);
  private readonly vGroup = new Uint8Array(MAXV);
  private readonly vType = new Int32Array(MAXV);
  private readonly vPrio = new Float64Array(MAXV);
  private readonly vHandle = new Int32Array(MAXV);
  private readonly vPos = new Float64Array(MAXV);
  private readonly vInc = new Float64Array(MAXV);
  private readonly vGain = new Float64Array(MAXV);
  private readonly vEnv = new Float64Array(MAXV);
  private readonly vAStep = new Float64Array(MAXV);
  private readonly vAK = new Float64Array(MAXV);
  private readonly vRK = new Float64Array(MAXV);
  private readonly vFade = new Float64Array(MAXV);
  private readonly vT0 = new Float64Array(MAXV);
  private readonly vTOff = new Float64Array(MAXV);
  private readonly vTStop = new Float64Array(MAXV);
  private readonly vLoopS = new Float64Array(MAXV);
  private readonly vLoopE = new Float64Array(MAXV);
  private readonly vSmooth = new Uint8Array(MAXV);
  /** The voice counts against its caps (until it starts fading or ends). */
  private readonly vCounted = new Uint8Array(MAXV);
  /** The buffer a sample voice plays, held until the voice ends: a freed buffer's voices fade on it. */
  private readonly vBuf: (SampleBuf | null)[] = new Array(MAXV).fill(null);
  /** Handles of working loops that ended without a release, for the next `ended` report. */
  private readonly endedH = new Float64Array(64);
  private endedN = 0;
  /** Pan gains: mono law [gl, gr], or the stereo law's four terms. Targets, and the smoothed values. */
  private readonly vPan = new Float64Array(MAXV * 4);
  private readonly vPanS = new Float64Array(MAXV * 4);
  private readonly vGainS = new Float64Array(MAXV);
  private readonly bPh = new Float64Array(MAXV * NB);
  private readonly bInc = new Float64Array(MAXV * NB);
  private readonly bAmp = new Float64Array(MAXV * NB);
  private readonly bDec = new Float64Array(MAXV * NB);
  private readonly active = new Int32Array(MAXV);
  private nActive = 0;
  private nMusic = 0;
  private nSfx = 0;
  private readonly typeCount = new Int32Array(MAX_TYPES);

  private readonly slots: Channel[][] = [];
  private readonly slotOrder: number[][] = [[], []];
  private readonly clearUntil = new Float64Array(MAX_SLOTS).fill(Number.NEGATIVE_INFINITY);
  private readonly dryL: Float32Array[] = [];
  private readonly dryR: Float32Array[] = [];
  private readonly sendL: Float32Array[] = [];
  private readonly sendR: Float32Array[] = [];
  private readonly sfxL: Float32Array[] = [];
  private readonly sfxR: Float32Array[] = [];
  private readonly sfxLive = new Uint8Array(NSFX);
  private readonly rooms: Room[] = [];
  private readonly busGain: Param[] = [];
  private readonly musL = new Float32Array(BLOCK);
  private readonly musR = new Float32Array(BLOCK);
  private readonly worldL = new Float32Array(BLOCK);
  private readonly worldR = new Float32Array(BLOCK);
  private readonly uiL = new Float32Array(BLOCK);
  private readonly uiR = new Float32Array(BLOCK);
  private readonly tapSlot: number[] = [];
  private readonly tapCh: number[] = [];
  private readonly nTaps: number;
  private frame = 0;

  // statistics
  private stolen = 0;
  private dropped = 0;
  private maxActive = 0;
  private maxSfx = 0;
  private quanta = 0;

  constructor(o: BankOptions) {
    this.sr = o.sampleRate;
    this.nTaps = o.taps ?? 0;
    for (let s = 0; s < MAX_SLOTS; s++) {
      const chs: Channel[] = [];
      for (let c = 0; c < MAX_CH; c++) chs.push(new Channel());
      this.slots.push(chs);
      this.dryL.push(new Float32Array(BLOCK));
      this.dryR.push(new Float32Array(BLOCK));
      this.sendL.push(new Float32Array(BLOCK));
      this.sendR.push(new Float32Array(BLOCK));
      this.rooms.push(new Room(this.sr));
    }
    for (let b = 0; b < NSFX; b++) {
      this.sfxL.push(new Float32Array(BLOCK));
      this.sfxR.push(new Float32Array(BLOCK));
      this.busGain.push(new Param(1));
    }
  }

  /** The number of outputs the node needs. */
  static outputs(taps = 0): number {
    return OUT_TAPS + taps;
  }

  // ------------------------------------------------------------------ messages (never in process())

  /** Handles one message; returns a reply to post, if any. */
  onMessage(m: ToBank): BankStats | { t: 'sync'; seq: number } | null {
    switch (m.t) {
      case 'buf': {
        const c0 = m.chans[0] as Int16Array;
        const c1 = (m.chans[1] as Int16Array | undefined) ?? c0;
        const old = this.bufs[m.id];
        if (old) this.bufBytes -= old.len * (old.stereo ? 4 : 2);
        else this.bufCount++;
        this.bufs[m.id] = { c0, c1, stereo: m.chans.length > 1, rate: m.rate, len: c0.length };
        this.bufBytes += c0.length * (m.chans.length > 1 ? 4 : 2);
        return null;
      }
      case 'free': {
        const b = this.bufs[m.id];
        if (!b) return null;
        // the voices playing it fade on it (they hold it until they end); the id is free for reuse at once
        for (let i = 0; i < this.nActive; i++) {
          const v = this.active[i]!;
          if (this.vKind[v] === KIND.SAMPLE && this.vBuf[v] === b) {
            this.lose(this.vHandle[v]!);
            this.stopVoice(v, FADE_S);
          }
        }
        // notes still queued for it would play nothing, or a later buffer under the same id
        for (let k = 0; k < this.qn; k++) {
          const o = k * NF;
          if (this.q[o + F.KIND] === KIND.SAMPLE && this.q[o + F.SRC] === m.id) {
            this.lose(this.q[o + F.HANDLE]!);
            this.removeQueued(k);
            k--;
          }
        }
        this.bufs[m.id] = null;
        this.bufBytes -= b.len * (b.stereo ? 4 : 2);
        this.bufCount--;
        return null;
      }
      case 'wave':
        this.waves[m.id] = harmonicTable(m.harmonics);
        return null;
      case 'notes':
        this.enqueue(m.data, m.n);
        return null;
      case 'ctl':
        this.control(m.data, m.n);
        return null;
      case 'layout':
        this.layout(m.slot, m.channels);
        return null;
      case 'auto': {
        const ch = this.slots[m.slot]?.[m.channel];
        if (!ch) return null;
        if (m.param === 'echoErase') {
          for (const e of m.events) ch.echo?.addErase(e[1] * this.sr);
          return null;
        }
        const p = m.param === 'fader' ? ch.fader : m.param === 'echoReturn' ? ch.echo?.ret : ch.echo?.fb;
        if (!p) return null;
        for (const e of m.events) this.addEvent(p, e);
        return null;
      }
      case 'clear':
        this.clear(m.slot, m.fade);
        return null;
      case 'room':
        this.room(m.slot, m.reverb, m.wet, m.airDb);
        return null;
      case 'fade': {
        const p = this.rooms[m.slot]?.gain;
        if (!p) return null;
        const at = m.at * this.sr;
        p.cancelFrom(at);
        if (m.seconds > 0) p.add(1, at, m.gain, (m.seconds / 4) * this.sr);
        else p.add(0, at, m.gain, 0);
        return null;
      }
      case 'buses': {
        const at = m.at * this.sr;
        m.gains.slice(0, NSFX).forEach((g, b) => {
          const p = this.busGain[b] as Param;
          if (m.tau <= 0) p.clear(g);
          else {
            p.cancelFrom(at);
            p.add(1, at, g, m.tau * this.sr);
          }
        });
        return null;
      }
      case 'taps':
        this.tapSlot.length = 0;
        this.tapCh.length = 0;
        for (const r of this.rooms) r.tapped = false;
        for (const t of m.list.slice(0, this.nTaps)) {
          this.tapSlot.push(t.slot);
          this.tapCh.push(t.channel);
          const r = this.rooms[t.slot];
          if (r && t.channel < 0) r.tapped = true;
        }
        return null;
      case 'stats':
        return this.stats();
      case 'poll':
      case 'crash':
        return null;
      case 'sync':
        return { t: 'sync', seq: m.seq };
    }
  }

  stats(): BankStats {
    return {
      t: 'stats',
      active: this.nActive,
      maxActive: this.maxActive,
      maxSfx: this.maxSfx,
      activeMusic: this.nMusic,
      activeSfx: this.nSfx,
      stolen: this.stolen,
      dropped: this.dropped,
      pending: this.qn,
      buffers: this.bufCount,
      bytes: this.bufBytes,
      quanta: this.quanta,
    };
  }

  /** Configures a slot's room (outside process(): the reverb allocates its lines). */
  private room(slot: number, reverb: FdnConfig, wet: number, airDb: number): void {
    const r = this.rooms[slot];
    if (!r) return;
    r.fdn.configure(reverb);
    r.wet = wet;
    r.air = airDb !== 0;
    biquadCoefs('highshelf', AIR_HZ, 1, airDb, this.sr, r.airC, 0);
    r.airZ.fill(0);
  }

  private addEvent(p: Param, e: AutoEvent): void {
    p.add(e[0], e[1] * this.sr, e[2], e[3] * this.sr);
  }

  /** Whether a note may start: its source is loaded, and a voice is free or stolen within its caps. */
  private admit(
    kind: number,
    src: number,
    buf: SampleBuf | null | undefined,
    group: number,
    type: number,
    prio: number,
    cap: number,
    isLoop: boolean,
  ): boolean {
    if (kind === KIND.SAMPLE && !buf) return false;
    if (kind === KIND.ORGAN && !this.waves[src]) return false;
    if (group === GROUP.MUSIC) return this.nMusic < MUSIC_VOICES || this.steal(group, -1, prio);
    if (
      type >= 0 &&
      type < MAX_TYPES &&
      this.typeCount[type]! >= cap &&
      !this.steal(group, type, prio, isLoop)
    )
      return false;
    // a full SFX group: a one-shot takes a lower one-shot's voice; a working loop takes the lowest one-shot's
    // whatever its priority (at most 12 loops, so there is always one)
    return this.nSfx < SFX_VOICES || this.steal(group, -1, isLoop ? Number.POSITIVE_INFINITY : prio, false);
  }

  private drop(handle: number): void {
    this.dropped++;
    this.lose(handle);
  }

  /** A working loop's voice ended without a release: reported, so the SFX system starts it again. */
  private lose(handle: number): void {
    if (handle > 0 && this.endedN < this.endedH.length) this.endedH[this.endedN++] = handle;
  }

  /** The `ended` report since the last one, or null (called after each message, never in process()). */
  takeEnded(): { t: 'ended'; handles: number[] } | null {
    if (this.endedN === 0) return null;
    const handles = Array.from(this.endedH.subarray(0, this.endedN));
    this.endedN = 0;
    return { t: 'ended', handles };
  }

  /** The handles of the working loops sounding now (tests, the dev page). */
  loopHandles(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nActive; i++) {
      const v = this.active[i]!;
      if (this.vHandle[v]! > 0 && this.vPh[v] !== P_FADE) out.push(this.vHandle[v]!);
    }
    return out;
  }

  private enqueue(d: Float64Array, n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.qn === QCAP) {
        this.dropped += n - i;
        for (let j = i; j < n; j++) this.lose(d[j * NF + F.HANDLE]!);
        return;
      }
      const o = this.qn * NF;
      for (let f = 0; f < NF; f++) this.q[o + f] = d[i * NF + f]!;
      const t = d[i * NF + F.TIME]!;
      if (t < this.nextDue) this.nextDue = t;
      this.qn++;
    }
  }

  /** Working loops: [handle, gain, pan, release, tau] per record. */
  private control(d: Float64Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const h = d[o]!;
      for (let k = 0; k < this.nActive; k++) {
        const v = this.active[k]!;
        if (this.vHandle[v] !== h || this.vPh[v] === P_FADE || this.vPh[v] === P_OFF) continue;
        if (d[o + 3]! > 0) this.stopVoice(v, Math.max(FADE_S, d[o + 4]!));
        else {
          this.vGain[v] = d[o + 1]! * (this.vKind[v] === KIND.SAMPLE ? 1 / 32768 : 1);
          this.setPan(v, d[o + 2]!);
        }
      }
      // a release for a handle whose note is still queued drops the note
      if (d[o + 3]! > 0)
        for (let k = 0; k < this.qn; k++)
          if (this.q[k * NF + F.HANDLE] === h) {
            this.removeQueued(k);
            k--;
          }
    }
  }

  private layout(slot: number, chans: readonly ChannelConfig[]): void {
    const chs = this.slots[slot];
    if (!chs) return;
    for (const ch of chs) this.resetChannel(ch, false);
    const order: number[] = [];
    for (const c of chans) {
      const ch = chs[c.index];
      if (!ch) continue;
      ch.used = true;
      ch.stereo = c.stereo || c.feed !== null;
      ch.trim = c.trim;
      ch.dry = c.dry;
      ch.send = c.send;
      if (ch.stereo) panStereo(c.pan, ch.panG);
      else panMono(c.pan, ch.panG);
      ch.eqN = Math.min(4, c.eq.length);
      for (let i = 0; i < ch.eqN; i++) {
        const b = c.eq[i]!;
        biquadCoefs(b.type, b.f, b.q, b.gain, this.sr, ch.eqC, i * 5);
      }
      ch.tapes = [];
      ch.trems = [];
      ch.insOrder = [];
      let tail = 0.02;
      for (const ins of c.inserts) {
        if (ins.kind === 'tape') {
          ch.insOrder.push([0, ch.tapes.length]);
          ch.tapes.push(new Tape(ins, this.sr));
          tail = Math.max(tail, 0.15);
        } else {
          ch.insOrder.push([1, ch.trems.length]);
          ch.trems.push(new Tremolo(ins, this.sr));
        }
      }
      ch.echo = c.feed?.kind === 'echo' ? new Echo(c.feed, this.sr) : null;
      ch.noise = c.feed?.kind === 'noise' ? new Noise(c.feed, this.sr) : null;
      ch.tail = tail * this.sr;
      // a noise bed stays silent until its piece automates it in (A4's hiss fades in from 0.0001)
      ch.fader.clear(ch.noise ? 0 : 1);
    }
    // feeds after their sources: an echo reads its source's post-pan signal of the same block
    const idx = chans.map((c) => c.index);
    const pending = new Set(idx);
    while (pending.size > 0) {
      let progressed = false;
      for (const i of idx) {
        if (!pending.has(i)) continue;
        const from = chs[i]?.echo?.from;
        if (from === undefined || !pending.has(from) || from === i) {
          order.push(i);
          pending.delete(i);
          progressed = true;
        }
      }
      if (!progressed) {
        for (const i of pending) order.push(i);
        break;
      }
    }
    this.slotOrder[slot] = order;
    this.clearUntil[slot] = Number.NEGATIVE_INFINITY;
  }

  private resetChannel(ch: Channel, keepConfig: boolean): void {
    if (!keepConfig) {
      ch.used = false;
      ch.echo = null;
      ch.noise = null;
      ch.tapes = [];
      ch.trems = [];
      ch.insOrder = [];
    }
    for (const t of ch.tapes) t.reset();
    ch.echo?.reset();
    ch.eqZ.fill(0);
    ch.fader.clear(1);
    ch.inL.fill(0);
    ch.inR.fill(0);
    ch.postL.fill(0);
    ch.postR.fill(0);
    ch.live = false;
    ch.lastVoice = Number.NEGATIVE_INFINITY;
  }

  /** Fades every voice of a slot (or every SFX voice) and drops its pending notes. */
  private clear(slot: number | 'sfx', fade: number): void {
    const isSlot = (dest: number) =>
      slot === 'sfx' ? dest >= SFX_DEST : dest >= slot * MAX_CH && dest < (slot + 1) * MAX_CH;
    for (let k = 0; k < this.qn; k++)
      if (isSlot(this.q[k * NF + F.DEST]!)) {
        this.removeQueued(k);
        k--;
      }
    for (let i = 0; i < this.nActive; i++) {
      const v = this.active[i]!;
      if (isSlot(this.vDest[v]!)) {
        if (this.vPh[v] !== P_FADE) this.lose(this.vHandle[v]!);
        this.stopVoice(v, Math.max(FADE_S, fade));
      }
    }
    if (slot !== 'sfx') {
      const chs = this.slots[slot] as Channel[];
      // the channels keep running (tails, echo) through the fade, then reset
      this.clearUntil[slot] = this.frame + (Math.max(FADE_S, fade) + 0.05) * this.sr;
      for (const ch of chs)
        if (ch.used) {
          ch.fader.clear(ch.fader.v);
          ch.fader.add(1, this.frame, 0, (Math.max(FADE_S, fade) / 4) * this.sr);
        }
    }
  }

  private removeQueued(k: number): void {
    const last = --this.qn;
    if (k !== last) this.q.copyWithin(k * NF, last * NF, last * NF + NF);
  }

  // ------------------------------------------------------------------ voices

  private setPan(v: number, pan: number): void {
    const src = this.vKind[v] === KIND.SAMPLE ? this.bufs[this.vSrc[v]!] : null;
    if (src?.stereo) panStereo(pan, this.vPan, v * 4);
    else {
      panMono(pan, this.vPan, v * 4);
      this.vPan[v * 4 + 2] = 0;
      this.vPan[v * 4 + 3] = 0;
    }
  }

  private stopVoice(v: number, seconds: number): void {
    if (this.vPh[v] === P_OFF || this.vPh[v] === P_FADE) return;
    this.uncount(v);
    this.vPh[v] = P_FADE;
    this.vFade[v] = Math.max(this.vEnv[v]!, 1e-12) / Math.max(1, seconds * this.sr);
  }

  /** The voice stops counting against the caps (it is fading or done). */
  private uncount(v: number): void {
    if (!this.vCounted[v]) return;
    this.vCounted[v] = 0;
    if (this.vGroup[v] === GROUP.MUSIC) this.nMusic--;
    else {
      this.nSfx--;
      const t = this.vType[v]!;
      if (t >= 0 && t < MAX_TYPES) this.typeCount[t] = this.typeCount[t]! - 1;
    }
  }

  /**
   * The voice to steal: the lowest priority, then the quietest, then the oldest. −1: none qualifies. A
   * one-shot never takes a working loop's voice (at most 12 loops share the 24 SFX voices, so one-shots keep
   * at least 12): a machine's sound does not drop out under a burst of builds (codex C7-r1 finding 2).
   */
  private victim(group: number, type: number, loop = true): number {
    let best = -1;
    let bp = Number.POSITIVE_INFINITY;
    let bl = Number.POSITIVE_INFINITY;
    let bt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.nActive; i++) {
      const v = this.active[i]!;
      const ph = this.vPh[v]!;
      if (ph === P_FADE || ph === P_OFF || this.vGroup[v] !== group) continue;
      if (type >= 0 && this.vType[v] !== type) continue;
      if (!loop && this.vHandle[v]! > 0) continue;
      const p = this.vPrio[v]!;
      const lvl = this.vEnv[v]! * (this.vKind[v] === KIND.SAMPLE ? 32768 : 1);
      const t0 = this.vT0[v]!;
      if (p < bp || (p === bp && (lvl < bl || (lvl === bl && t0 < bt)))) {
        best = v;
        bp = p;
        bl = lvl;
        bt = t0;
      }
    }
    return best;
  }

  private steal(group: number, type: number, prio: number, loop = true): boolean {
    const v = this.victim(group, type, loop);
    if (v < 0 || this.vPrio[v]! > prio) return false;
    this.stolen++;
    this.lose(this.vHandle[v]!);
    this.stopVoice(v, FADE_S);
    return true;
  }

  private start(k: number, f0: number): void {
    const o = k * NF;
    const q = this.q;
    const kind = q[o + F.KIND]!;
    const group = q[o + F.GROUP]!;
    const type = group === GROUP.SFX ? q[o + F.TYPE]! : -1;
    const prio = q[o + F.PRIO]!;
    const src = q[o + F.SRC]!;
    const handle = q[o + F.HANDLE]!;
    const isLoop = handle > 0;
    const buf = kind === KIND.SAMPLE ? this.bufs[src] : null;
    // a note that cannot start is dropped and counted, never queued (10 §9.7, "Late audio"); a working
    // loop's is reported, so the SFX system tries it again with the next snapshot
    let v = -1;
    if (this.admit(kind, src, buf, group, type, prio, q[o + F.CAP]!, isLoop))
      for (let i = 0; i < MAXV; i++)
        if (this.vPh[i] === P_OFF) {
          v = i;
          break;
        }
    if (v < 0) {
      this.drop(handle);
      return;
    }
    const sr = this.sr;
    const t0 = Math.max(f0, Math.round(q[o + F.TIME]! * sr));
    const gainIn = q[o + F.GAIN]!;
    const gain = kind === KIND.SAMPLE ? gainIn / 32768 : gainIn;
    const attack = q[o + F.ATTACK]!;
    const smooth = q[o + F.SMOOTH]! > 0;
    // the envelope's target: a sample or synth ramps to its gain; a smoothed loop ramps to 1 and carries its
    // gain separately (it follows the game); the bell's envelope is its 4 ms attack ramp to 1
    const envTarget = smooth || kind === KIND.BELL ? 1 : gain;
    this.vKind[v] = kind;
    this.vSrc[v] = src;
    this.vBuf[v] = buf ?? null;
    this.vDest[v] = q[o + F.DEST]!;
    this.vGroup[v] = group;
    this.vType[v] = type;
    this.vPrio[v] = prio;
    this.vHandle[v] = handle;
    this.vT0[v] = t0;
    this.vTOff[v] = q[o + F.OFF]! * sr;
    this.vTStop[v] = q[o + F.STOP]! * sr;
    this.vRK[v] = Math.exp(-1 / Math.max(1, (q[o + F.RELEASE]! / 4.5) * sr));
    this.vGain[v] = gain;
    this.vSmooth[v] = smooth ? 1 : 0;
    if (attack > 0.004) {
      this.vEnv[v] = 0;
      if (q[o + F.ATK_EXP]! > 0) {
        this.vPh[v] = P_ATK_EXP;
        this.vAK[v] = 1 - Math.exp(-1 / ((attack / 3) * sr));
      } else {
        this.vPh[v] = P_ATK_LIN;
        this.vAStep[v] = envTarget / (attack * sr);
      }
    } else {
      this.vEnv[v] = envTarget;
      this.vPh[v] = P_SUS;
    }
    if (kind === KIND.SAMPLE) {
      const b = buf as SampleBuf;
      this.vPos[v] = q[o + F.OFFSET]! * b.rate;
      this.vInc[v] = (q[o + F.RATE]! * b.rate) / sr;
      this.vLoopS[v] = q[o + F.LOOP_S]!;
      this.vLoopE[v] = q[o + F.LOOP_E]!;
    } else {
      this.vPos[v] = 0;
      this.vInc[v] = q[o + F.RATE]! / sr;
      this.vLoopE[v] = 0;
      if (kind === KIND.BELL) {
        // Risset's bell: partial k at (f / 0.56) · ratio + offset; peak · amp / Σamp; decays from t + 4 ms
        // with τ = T · life / 6.9 (A4 `Synth`, 'bell')
        const f = q[o + F.RATE]!;
        const T = Math.max(0.1, q[o + F.AUX]!);
        for (let p = 0; p < NB; p++) {
          const [ratio, amp, life, hz] = RISSET_BELL[p] as readonly [number, number, number, number];
          this.bPh[v * NB + p] = 0;
          this.bInc[v * NB + p] = ((f / 0.56) * ratio + hz) / sr;
          this.bAmp[v * NB + p] = (gain * amp) / RISSET_SUM;
          this.bDec[v * NB + p] = Math.exp(-1 / (((T * life) / 6.9) * sr));
        }
        this.vPh[v] = P_ATK_LIN;
        this.vEnv[v] = 0;
        this.vAStep[v] = 1 / (0.004 * sr);
        this.vGain[v] = 1;
      }
    }
    if (group === GROUP.SFX) {
      this.setPan(v, q[o + F.PAN]!);
      for (let j = 0; j < 4; j++) this.vPanS[v * 4 + j] = this.vPan[v * 4 + j]!;
      this.nSfx++;
      if (type >= 0 && type < MAX_TYPES) this.typeCount[type] = this.typeCount[type]! + 1;
    } else this.nMusic++;
    this.vGainS[v] = this.vGain[v]!;
    this.vCounted[v] = 1;
    this.active[this.nActive++] = v;
    if (this.nActive > this.maxActive) this.maxActive = this.nActive;
    if (this.nSfx > this.maxSfx) this.maxSfx = this.nSfx;
  }

  /** Renders one voice into its destination for frames [f0, f0 + n). Returns true when the voice is over. */
  private renderVoice(v: number, f0: number, n: number): boolean {
    const t0 = this.vT0[v]!;
    let s = t0 > f0 ? t0 - f0 : 0;
    if (s >= n) return false;
    const kind = this.vKind[v]!;
    const dest = this.vDest[v]!;
    let L: Float32Array;
    let R: Float32Array | null;
    let mode: number; // 0 mono → mono, 1 stereo → stereo, 2 mono → both sides, 3 SFX panned
    let srcStereo = false;
    let b: SampleBuf | null = null;
    if (kind === KIND.SAMPLE) {
      b = this.vBuf[v] ?? null;
      if (!b) return true;
      srcStereo = b.stereo;
    }
    if (dest >= SFX_DEST) {
      const bus = dest - SFX_DEST;
      L = this.sfxL[bus] as Float32Array;
      R = this.sfxR[bus] as Float32Array;
      this.sfxLive[bus] = 1;
      mode = 3;
    } else {
      const ch = this.slots[(dest / MAX_CH) | 0]?.[dest % MAX_CH];
      if (!ch?.used) return true;
      ch.wrote = true;
      ch.lastVoice = f0 + n;
      L = ch.inL;
      R = ch.stereo ? ch.inR : null;
      mode = ch.stereo ? (srcStereo ? 1 : 2) : 0;
    }
    const smooth = this.vSmooth[v] === 1;
    const ks = smooth ? 1 - Math.exp(-1 / (SMOOTH_S * this.sr)) : 0;
    let ph = this.vPh[v]!;
    let env = this.vEnv[v]!;
    const gainT = this.vGain[v]!;
    let gS = this.vGainS[v]!;
    const aStep = this.vAStep[v]!;
    const aK = this.vAK[v]!;
    const rK = this.vRK[v]!;
    let fade = this.vFade[v]!;
    const tOff = this.vTOff[v]!;
    const tStop = this.vTStop[v]!;
    const pi = v * 4;
    const p0 = this.vPan[pi]!;
    const p1 = this.vPan[pi + 1]!;
    const p2 = this.vPan[pi + 2]!;
    const p3 = this.vPan[pi + 3]!;
    let q0 = this.vPanS[pi]!;
    let q1 = this.vPanS[pi + 1]!;
    let q2 = this.vPanS[pi + 2]!;
    let q3 = this.vPanS[pi + 3]!;
    const fadeLen = FADE_S * this.sr;
    // the envelope target: samples and synths ramp to their gain; smoothed loops ramp to 1 and carry the
    // gain in gS; the bell's envelope is its 4 ms attack ramp to 1
    const envTarget = smooth || kind === KIND.BELL ? 1 : gainT;
    let done = false;
    // oscillator state
    let pos = this.vPos[v]!;
    const inc = this.vInc[v]!;
    const loopS = this.vLoopS[v]!;
    const loopE = this.vLoopE[v]!;
    const span = loopE - loopS;
    const c0 = b ? b.c0 : null;
    const c1 = b ? b.c1 : null;
    const last = b ? b.len - 1 : 0;
    const table = kind === KIND.ORGAN ? (this.waves[this.vSrc[v]!] ?? this.sine) : this.sine;
    // The fast path, most of the work: a sample voice holding or releasing, up to its next envelope event.
    // The same arithmetic as the general loop below (a held level times 1 is itself), without its per-sample
    // event and phase tests.
    if (kind === KIND.SAMPLE && (ph === P_SUS || ph === P_REL)) {
      const evt = Math.min(ph === P_SUS ? tOff : Number.POSITIVE_INFINITY, tStop);
      const segEnd = evt - f0 >= n ? n : Math.max(s, Math.ceil(evt - f0));
      const k = ph === P_REL ? rK : 1;
      const s0 = c0 as Int16Array;
      const s1 = c1 as Int16Array;
      for (; s < segEnd; s++) {
        env *= k;
        if (smooth) {
          gS += (gainT - gS) * ks;
          q0 += (p0 - q0) * ks;
          q1 += (p1 - q1) * ks;
          q2 += (p2 - q2) * ks;
          q3 += (p3 - q3) * ks;
        }
        if (loopE > 0 && pos >= loopE) pos -= span;
        const ip = pos | 0;
        if (ip >= last) {
          done = true;
          break;
        }
        const fr = pos - ip;
        const a = s0[ip]!;
        const x = a + (s0[ip + 1]! - a) * fr;
        let y = 0;
        if (srcStereo) {
          const r = s1[ip]!;
          y = r + (s1[ip + 1]! - r) * fr;
        }
        pos += inc;
        const e = smooth ? env * gS : env;
        switch (mode) {
          case 0:
            L[s] = L[s]! + x * e;
            break;
          case 1:
            L[s] = L[s]! + x * e;
            (R as Float32Array)[s] = (R as Float32Array)[s]! + y * e;
            break;
          case 2:
            L[s] = L[s]! + x * e;
            (R as Float32Array)[s] = (R as Float32Array)[s]! + x * e;
            break;
          default:
            if (srcStereo) {
              L[s] = L[s]! + (q0 * x + q1 * y) * e;
              (R as Float32Array)[s] = (R as Float32Array)[s]! + (q2 * x + q3 * y) * e;
            } else {
              L[s] = L[s]! + q0 * x * e;
              (R as Float32Array)[s] = (R as Float32Array)[s]! + q1 * x * e;
            }
        }
      }
    }
    for (; s < n && !done; s++) {
      const f = f0 + s;
      // envelope (A4's AudioParam automation)
      if (f >= tOff && ph < P_REL) ph = P_REL;
      if (f >= tStop && ph < P_FADE) {
        ph = P_FADE;
        fade = Math.max(env, 1e-12) / fadeLen;
      }
      if (ph === P_ATK_LIN) {
        env += aStep;
        if (env >= envTarget) {
          env = envTarget;
          ph = P_SUS;
        }
      } else if (ph === P_ATK_EXP) env += (envTarget - env) * aK;
      else if (ph === P_REL) env *= rK;
      else if (ph === P_FADE) {
        env -= fade;
        if (env <= 0) {
          env = 0;
          done = true;
          break;
        }
      }
      if (smooth) {
        gS += (gainT - gS) * ks;
        q0 += (p0 - q0) * ks;
        q1 += (p1 - q1) * ks;
        q2 += (p2 - q2) * ks;
        q3 += (p3 - q3) * ks;
      }
      // source
      let x: number;
      let y = 0;
      if (kind === KIND.SAMPLE) {
        if (loopE > 0 && pos >= loopE) pos -= span;
        const ip = pos | 0;
        if (ip >= last) {
          done = true;
          break;
        }
        const fr = pos - ip;
        const a = c0![ip]!;
        x = a + (c0![ip + 1]! - a) * fr;
        if (srcStereo) {
          const r = c1![ip]!;
          y = r + (c1![ip + 1]! - r) * fr;
        }
        pos += inc;
      } else if (kind === KIND.BELL) {
        let sum = 0;
        const base = v * NB;
        const decaying = f >= t0 + 0.004 * this.sr;
        for (let p = 0; p < NB; p++) {
          let ph2 = this.bPh[base + p]!;
          sum += this.bAmp[base + p]! * lookup(this.sine, ph2);
          ph2 += this.bInc[base + p]!;
          if (ph2 >= 1) ph2 -= 1;
          this.bPh[base + p] = ph2;
          if (decaying) this.bAmp[base + p] = this.bAmp[base + p]! * this.bDec[base + p]!;
        }
        x = sum;
      } else {
        x = lookup(table, pos);
        pos += inc;
        if (pos >= 1) pos -= 1;
      }
      const e = smooth ? env * gS : env;
      switch (mode) {
        case 0:
          L[s] = L[s]! + x * e;
          break;
        case 1:
          L[s] = L[s]! + x * e;
          (R as Float32Array)[s] = (R as Float32Array)[s]! + y * e;
          break;
        case 2:
          L[s] = L[s]! + x * e;
          (R as Float32Array)[s] = (R as Float32Array)[s]! + x * e;
          break;
        default:
          if (srcStereo) {
            L[s] = L[s]! + (q0 * x + q1 * y) * e;
            (R as Float32Array)[s] = (R as Float32Array)[s]! + (q2 * x + q3 * y) * e;
          } else {
            L[s] = L[s]! + q0 * x * e;
            (R as Float32Array)[s] = (R as Float32Array)[s]! + q1 * x * e;
          }
      }
    }
    // a bell is over when its longest partial has decayed (T + 0.1 s, as the prototype's stop times)
    if (kind === KIND.BELL && !done && ph < P_FADE) {
      let peak = 0;
      for (let p = 0; p < NB; p++) peak = Math.max(peak, this.bAmp[v * NB + p]!);
      if (peak < 1e-6 && ph === P_SUS) {
        ph = P_FADE;
        fade = env / fadeLen;
      }
    }
    this.vPh[v] = ph;
    this.vEnv[v] = env;
    this.vFade[v] = fade;
    this.vPos[v] = pos;
    this.vGainS[v] = gS;
    this.vPanS[pi] = q0;
    this.vPanS[pi + 1] = q1;
    this.vPanS[pi + 2] = q2;
    this.vPanS[pi + 3] = q3;
    // a released voice whose level is below −100 dB is over (a release tail never runs forever)
    if (!done && ph === P_REL && env < 1e-5 * (envTarget || 1)) done = true;
    if (ph === P_FADE) this.uncount(v);
    return done;
  }

  private endVoice(v: number): void {
    this.uncount(v);
    this.vPh[v] = P_OFF;
    this.vBuf[v] = null;
  }

  // ------------------------------------------------------------------ the render quantum

  /** Renders `outputs` (per output, per channel) for the quantum starting at `currentFrame`. */
  process(outputs: Float32Array[][], currentFrame: number): void {
    const out0 = outputs[0]?.[0];
    const n = out0 ? out0.length : BLOCK;
    this.quanta++;
    for (let off = 0; off < n; off += BLOCK)
      this.block(outputs, currentFrame + off, off, Math.min(BLOCK, n - off));
  }

  private block(outputs: Float32Array[][], f0: number, off: number, n: number): void {
    this.frame = f0;
    // 1. notes due in this block
    if (this.qn > 0 && this.nextDue * this.sr < f0 + n) {
      let next = Number.POSITIVE_INFINITY;
      for (let k = 0; k < this.qn; k++) {
        const t = this.q[k * NF + F.TIME]!;
        if (t * this.sr < f0 + n) {
          this.start(k, f0);
          this.removeQueued(k);
          k--;
        } else if (t < next) next = t;
      }
      this.nextDue = next;
    }
    // 2. clear the inputs and the slot sums
    for (let sl = 0; sl < MAX_SLOTS; sl++) {
      for (const i of this.slotOrder[sl] as number[]) {
        const ch = (this.slots[sl] as Channel[])[i] as Channel;
        ch.inL.fill(0, 0, n);
        if (ch.stereo) ch.inR.fill(0, 0, n);
        ch.wrote = false;
      }
      (this.dryL[sl] as Float32Array).fill(0);
      (this.dryR[sl] as Float32Array).fill(0);
      (this.sendL[sl] as Float32Array).fill(0);
      (this.sendR[sl] as Float32Array).fill(0);
    }
    for (let bus = 0; bus < NSFX; bus++)
      if (this.sfxLive[bus]) {
        (this.sfxL[bus] as Float32Array).fill(0, 0, n);
        (this.sfxR[bus] as Float32Array).fill(0, 0, n);
        this.sfxLive[bus] = 0;
      }
    // 3. voices
    for (let i = 0; i < this.nActive; ) {
      const v = this.active[i]!;
      if (this.renderVoice(v, f0, n)) {
        this.endVoice(v);
        this.active[i] = this.active[--this.nActive]!;
      } else i++;
    }
    // 4. channel strips, per slot
    for (let sl = 0; sl < MAX_SLOTS; sl++) this.strips(sl, f0, n);
    // 5. the rooms into the music; the SFX buses after their faders into the world and the UI outputs
    this.musL.fill(0, 0, n);
    this.musR.fill(0, 0, n);
    for (let sl = 0; sl < MAX_SLOTS; sl++) this.mixRoom(sl, f0, n);
    this.mixBuses(f0, n);
    // 6. outputs
    copyStereo(this.musL, this.musR, outputs[OUT_MUSIC], off, n);
    copyStereo(this.worldL, this.worldR, outputs[OUT_WORLD], off, n);
    copyStereo(this.uiL, this.uiR, outputs[OUT_UI], off, n);
    for (let k = 0; k < this.tapSlot.length; k++) {
      const o = outputs[OUT_TAPS + k];
      const sl = this.tapSlot[k]!;
      const c = this.tapCh[k]!;
      if (!o || o.length < 2) continue;
      const oL = o[0] as Float32Array;
      const oR = o[1] as Float32Array;
      if (c === TAP_REVERB || c === TAP_SEND) {
        const r = this.rooms[sl];
        if (!r) continue;
        const w = c === TAP_REVERB ? r.wet : 1;
        const L = c === TAP_REVERB ? r.wetL : (this.sendL[sl] as Float32Array);
        const R = c === TAP_REVERB ? r.wetR : (this.sendR[sl] as Float32Array);
        for (let s = 0; s < n; s++) {
          oL[off + s] = L[s]! * w;
          oR[off + s] = R[s]! * w;
        }
        continue;
      }
      const ch = this.slots[sl]?.[c];
      if (!ch) continue;
      for (let s = 0; s < n; s++) {
        oL[off + s] = ch.postL[s]! * ch.dry;
        oR[off + s] = ch.postR[s]! * ch.dry;
      }
    }
    // 7. slots whose clear has finished: their channels are released, so a cleared hiss or echo stops
    // running (a new piece sends its layout before its notes)
    for (let sl = 0; sl < MAX_SLOTS; sl++)
      if (this.clearUntil[sl]! !== Number.NEGATIVE_INFINITY && f0 >= this.clearUntil[sl]!) {
        for (const ch of this.slots[sl] as Channel[]) this.resetChannel(ch, false);
        this.slotOrder[sl] = [];
        this.clearUntil[sl] = Number.NEGATIVE_INFINITY;
      }
  }

  /** A slot's room: dry plus the reverb's return, the air shelf, the era gain, added to the music. */
  private mixRoom(sl: number, f0: number, n: number): void {
    const r = this.rooms[sl] as Room;
    const g = r.gain;
    // an era gain at 0 with nothing scheduled: nothing of the slot is heard (a cleared slot fading out)
    if (!g.pending && g.v === 0 && !r.tapped) return;
    const dL = this.dryL[sl] as Float32Array;
    const dR = this.dryR[sl] as Float32Array;
    const wL = r.wetL;
    const wR = r.wetR;
    r.fdn.process(this.sendL[sl], this.sendR[sl], wL, wR, n);
    const w = r.wet;
    const sL = r.sumL;
    const sR = r.sumR;
    for (let s = 0; s < n; s++) {
      sL[s] = dL[s]! + wL[s]! * w;
      sR[s] = dR[s]! + wR[s]! * w;
    }
    if (r.air) {
      biquadRun(sL, n, r.airC, 0, r.airZ, 0);
      biquadRun(sR, n, r.airC, 0, r.airZ, 2);
    }
    const mL = this.musL;
    const mR = this.musR;
    if (g.pending)
      for (let s = 0; s < n; s++) {
        const k = g.step(f0 + s);
        mL[s] = mL[s]! + sL[s]! * k;
        mR[s] = mR[s]! + sR[s]! * k;
      }
    else {
      const k = g.v;
      if (k !== 0)
        for (let s = 0; s < n; s++) {
          mL[s] = mL[s]! + sL[s]! * k;
          mR[s] = mR[s]! + sR[s]! * k;
        }
    }
  }

  /** The SFX buses, each after its fader (the volume settings, 20 ms ramps), into the world and UI sums. */
  private mixBuses(f0: number, n: number): void {
    this.worldL.fill(0, 0, n);
    this.worldR.fill(0, 0, n);
    this.uiL.fill(0, 0, n);
    this.uiR.fill(0, 0, n);
    for (let bus = 0; bus < NSFX; bus++) {
      const p = this.busGain[bus] as Param;
      if (!this.sfxLive[bus]) {
        if (p.pending) p.advance(f0, n);
        continue;
      }
      const L = this.sfxL[bus] as Float32Array;
      const R = this.sfxR[bus] as Float32Array;
      const oL = WORLD[bus] ? this.worldL : this.uiL;
      const oR = WORLD[bus] ? this.worldR : this.uiR;
      if (p.pending)
        for (let s = 0; s < n; s++) {
          const k = p.step(f0 + s);
          oL[s] = oL[s]! + L[s]! * k;
          oR[s] = oR[s]! + R[s]! * k;
        }
      else {
        const k = p.v;
        if (k !== 0)
          for (let s = 0; s < n; s++) {
            oL[s] = oL[s]! + L[s]! * k;
            oR[s] = oR[s]! + R[s]! * k;
          }
      }
    }
  }

  private strips(sl: number, f0: number, n: number): void {
    const chs = this.slots[sl] as Channel[];
    const dryL = this.dryL[sl] as Float32Array;
    const dryR = this.dryR[sl] as Float32Array;
    const sendL = this.sendL[sl] as Float32Array;
    const sendR = this.sendR[sl] as Float32Array;
    for (const i of this.slotOrder[sl] as number[]) {
      const ch = chs[i] as Channel;
      if (!ch.used) continue;
      const echo = ch.echo;
      const fed =
        (echo !== null && ((chs[echo.from]?.live ?? false) || echo.active(f0) || echo.pending)) ||
        (ch.noise !== null && (ch.fader.v > 1e-3 || ch.fader.pending));
      const tailing = f0 - ch.lastVoice < ch.tail;
      if (!ch.wrote && !fed && !tailing && !ch.fader.pending) {
        if (ch.live) {
          ch.postL.fill(0);
          ch.postR.fill(0);
          ch.live = false;
        }
        continue;
      }
      const L = ch.inL;
      const R = ch.inR;
      // feeds
      if (echo) {
        const src = chs[echo.from];
        if (src) echo.run(src.postL, src.postR, L, R, n, f0, this.sine);
      }
      if (ch.noise) ch.noise.run(L, R, n);
      // trim and fader
      const fp = ch.fader.pending;
      for (let s = 0; s < n; s++) {
        const g = ch.trim * (fp ? ch.fader.step(f0 + s) : ch.fader.v);
        L[s] = L[s]! * g;
        if (ch.stereo) R[s] = R[s]! * g;
      }
      // EQ
      for (let k = 0; k < ch.eqN; k++) {
        biquadRun(L, n, ch.eqC, k * 5, ch.eqZ, k * 4);
        if (ch.stereo) biquadRun(R, n, ch.eqC, k * 5, ch.eqZ, k * 4 + 2);
      }
      // inserts
      for (const [kind, k] of ch.insOrder) {
        if (kind === 0) (ch.tapes[k] as Tape).run(L, ch.stereo ? R : null, n, this.sine);
        else (ch.trems[k] as Tremolo).run(L, ch.stereo ? R : null, n, this.sine);
      }
      // pan (StereoPannerNode), then dry and send
      const g = ch.panG;
      const pL = ch.postL;
      const pR = ch.postR;
      if (ch.stereo) {
        const ll = g[0]!;
        const rl = g[1]!;
        const lr = g[2]!;
        const rr = g[3]!;
        for (let s = 0; s < n; s++) {
          const l = L[s]!;
          const r = R[s]!;
          pL[s] = ll * l + rl * r;
          pR[s] = lr * l + rr * r;
        }
      } else {
        const gl = g[0]!;
        const gr = g[1]!;
        for (let s = 0; s < n; s++) {
          const x = L[s]!;
          pL[s] = gl * x;
          pR[s] = gr * x;
        }
      }
      const d = ch.dry;
      const se = ch.send;
      for (let s = 0; s < n; s++) {
        const l = pL[s]!;
        const r = pR[s]!;
        dryL[s] = dryL[s]! + l * d;
        dryR[s] = dryR[s]! + r * d;
        sendL[s] = sendL[s]! + l * se;
        sendR[s] = sendR[s]! + r * se;
      }
      ch.live = true;
    }
  }
}

function copyStereo(
  L: Float32Array,
  R: Float32Array,
  out: Float32Array[] | undefined,
  off: number,
  n: number,
): void {
  if (!out || out.length < 2) return;
  const oL = out[0] as Float32Array;
  const oR = out[1] as Float32Array;
  for (let s = 0; s < n; s++) {
    oL[off + s] = L[s]!;
    oR[off + s] = R[s]!;
  }
}

export const SINE_TABLE_SIZE = SINE_SIZE;
