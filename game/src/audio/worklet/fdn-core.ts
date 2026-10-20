// A feedback-delay-network reverb (10 §9.4; A4 §6.5 #1): one node per era slot replaces the prototype's
// convolvers. Stereo in, wet stereo out.
//
// - Dual mono, as A4's ConvolverNode with a two-channel IR was: the left input feeds a network whose output
//   is the left wet signal, the right input another network with other line lengths. Two decorrelated
//   networks reproduce the convolver's independent left and right IRs, so neither a centred source (L = R)
//   nor a pair of correlated sources panned apart (Era II's two marimba tapes) changes the reverb's level or
//   colour, as a shared network fed with both sides would (measured: +2–4 dB at 125 Hz–1 kHz against −3 dB
//   at 4 kHz with a stereo injection, +1.8 LU on Era II's plate with a mono sum).
// - Each network: predelay, four allpass diffusers (the dense onset of A4's generated IRs), eight delay
//   lines of 25–85 ms (scaled by `size`), an 8×8 Hadamard feedback matrix (a fast Walsh–Hadamard
//   transform, 24 adds) and, per line, an absorption filter: a broadband gain for the mid-band T60 and two
//   first-order shelves (350 Hz, 3.5 kHz) for the low and high bands (Jot 1991, simplified).
// The output gain gives A4's level per Hz in the music band (`FDN_GAIN`, music/reverb.ts). Nothing
// allocates in `process()`, and a silent reverb sleeps (its lines are zeroed, so a tail never decays into
// denormals). Cost: about 0.65 % of a host core per network at 32 kHz while it sounds (measured in Node, C7).
import type { FdnConfig } from './protocol.ts';

const N = 8;
/** Line lengths at 48 kHz and size 1: 25–85 ms, coprime, about 0.4 s in all (mode density ≥ 0.15 · T60). */
const LINES_48K = [
  [1201, 1433, 1709, 2039, 2423, 2887, 3433, 4093],
  [1259, 1493, 1777, 2111, 2503, 2971, 3539, 4201],
];
/** Allpass diffusers at 48 kHz (Dattorro's input diffusers, scaled), with their gains. */
const DIFF_48K = [
  [229, 173, 613, 448],
  [239, 181, 587, 467],
];
const DIFF_G = [0.75, 0.75, 0.625, 0.625];
/** Input weights per line: equal magnitude, mixed signs. */
const INJECT = [0.25, -0.25, 0.25, 0.25, -0.25, 0.25, -0.25, -0.25];
const XOVER_LOW = 350;
const XOVER_HIGH = 3500;

/** One mono network. */
class Net {
  readonly len: Int32Array;
  readonly lines: Float32Array[];
  readonly idx = new Int32Array(N);
  /** Per line: low shelf (b0, b1, a1) with the mid gain folded in, high shelf (b0, b1, a1). */
  readonly filt = new Float64Array(N * 6);
  readonly zl = new Float64Array(N);
  readonly zh = new Float64Array(N);
  readonly v = new Float64Array(N);
  readonly pre: Float32Array;
  pi = 0;
  readonly diff: Float32Array[];
  readonly diffIdx = new Int32Array(4);

  constructor(side: number, sr: number, cfg: FdnConfig) {
    const scale = (sr / 48000) * cfg.size;
    this.len = new Int32Array((LINES_48K[side] as number[]).map((l) => Math.max(16, Math.round(l * scale))));
    this.lines = Array.from(this.len, (l) => new Float32Array(l));
    const [tLow, tMid, tHigh] = cfg.t60;
    const kl = Math.tan((Math.PI * XOVER_LOW) / sr);
    const kh = Math.tan((Math.PI * Math.min(XOVER_HIGH, 0.45 * sr)) / sr);
    for (let i = 0; i < N; i++) {
      const L = this.len[i] as number;
      const gMid = 10 ** ((-3 * L) / (sr * tMid));
      const gLow = 10 ** ((-3 * L) / (sr * tLow)) / gMid; // the low shelf's DC gain
      const gHigh = 10 ** ((-3 * L) / (sr * tHigh)) / gMid; // the high shelf's gain at Nyquist
      // first-order low shelf, bilinear: H(s) = (s + G·ωc) / (s + ωc)
      const a0l = kl + 1;
      this.filt[i * 6] = (gMid * (kl * gLow + 1)) / a0l;
      this.filt[i * 6 + 1] = (gMid * (kl * gLow - 1)) / a0l;
      this.filt[i * 6 + 2] = (kl - 1) / a0l;
      // first-order high shelf: H(s) = (G·s + ωc) / (s + ωc)
      const a0h = kh + 1;
      this.filt[i * 6 + 3] = (kh + gHigh) / a0h;
      this.filt[i * 6 + 4] = (kh - gHigh) / a0h;
      this.filt[i * 6 + 5] = (kh - 1) / a0h;
    }
    this.pre = new Float32Array(Math.max(1, Math.round(cfg.predelay * sr)));
    const ds = Math.max(0.35, Math.min(1, cfg.size)) * (sr / 48000);
    this.diff = (DIFF_48K[side] as number[]).map((d) => new Float32Array(Math.max(4, Math.round(d * ds))));
  }

  clear(): void {
    for (const l of this.lines) l.fill(0);
    for (const d of this.diff) d.fill(0);
    this.pre.fill(0);
    this.zl.fill(0);
    this.zh.fill(0);
  }

  /** Wet output of `inp` into `out` (scaled by `g`); returns the block's peak output. */
  run(inp: Float32Array | undefined, out: Float32Array, n: number, g: number): number {
    const v = this.v;
    const lines = this.lines;
    const idx = this.idx;
    const len = this.len;
    const fl = this.filt;
    const zl = this.zl;
    const zh = this.zh;
    const pre = this.pre;
    const diff = this.diff;
    const di = this.diffIdx;
    const preN = pre.length;
    const s8 = 0.35355339059327373; // 1 / √8
    let peak = 0;
    for (let s = 0; s < n; s++) {
      // predelay
      const p = this.pi;
      let x = pre[p] as number;
      pre[p] = inp ? (inp[s] as number) : 0;
      this.pi = p + 1 === preN ? 0 : p + 1;
      // input diffusion: Schroeder allpasses, y = −g·x + d; d' = x + g·y
      for (let k = 0; k < 4; k++) {
        const b = diff[k] as Float32Array;
        const i = di[k] as number;
        const y = (b[i] as number) - DIFF_G[k]! * x;
        b[i] = x + DIFF_G[k]! * y;
        di[k] = i + 1 === b.length ? 0 : i + 1;
        x = y;
      }
      // read the lines through their absorption filters
      for (let i = 0; i < N; i++) {
        const xi = (lines[i] as Float32Array)[idx[i] as number] as number;
        const o = i * 6;
        const y1 = fl[o]! * xi + zl[i]!;
        zl[i] = fl[o + 1]! * xi - fl[o + 2]! * y1;
        const y2 = fl[o + 3]! * y1 + zh[i]!;
        zh[i] = fl[o + 4]! * y1 - fl[o + 5]! * y2;
        v[i] = y2;
      }
      const o = v[0]! - v[1]! + v[2]! - v[3]! + v[4]! - v[5]! + v[6]! - v[7]!;
      out[s] = o * g;
      const a = o < 0 ? -o : o;
      if (a > peak) peak = a;
      // the feedback matrix: a normalised Hadamard transform
      const a0 = v[0]! + v[1]!;
      const a1 = v[0]! - v[1]!;
      const a2 = v[2]! + v[3]!;
      const a3 = v[2]! - v[3]!;
      const a4 = v[4]! + v[5]!;
      const a5 = v[4]! - v[5]!;
      const a6 = v[6]! + v[7]!;
      const a7 = v[6]! - v[7]!;
      const b0 = a0 + a2;
      const b2 = a0 - a2;
      const b1 = a1 + a3;
      const b3 = a1 - a3;
      const b4 = a4 + a6;
      const b6 = a4 - a6;
      const b5 = a5 + a7;
      const b7 = a5 - a7;
      v[0] = (b0 + b4) * s8;
      v[4] = (b0 - b4) * s8;
      v[1] = (b1 + b5) * s8;
      v[5] = (b1 - b5) * s8;
      v[2] = (b2 + b6) * s8;
      v[6] = (b2 - b6) * s8;
      v[3] = (b3 + b7) * s8;
      v[7] = (b3 - b7) * s8;
      // inject the diffused input, and write back
      for (let i = 0; i < N; i++) {
        const line = lines[i] as Float32Array;
        const j = idx[i] as number;
        line[j] = v[i]! + x * (INJECT[i] as number);
        idx[i] = j + 1 === len[i] ? 0 : j + 1;
      }
    }
    for (let i = 0; i < N; i++) {
      if (Math.abs(zl[i]!) < 1e-25) zl[i] = 0;
      if (Math.abs(zh[i]!) < 1e-25) zh[i] = 0;
    }
    return peak;
  }
}

export class FdnCore {
  private readonly sr: number;
  private nets: Net[] = [];
  private gain = 0;
  private sleeping = true;
  private quiet = 0;

  constructor(sampleRate: number, cfg?: FdnConfig) {
    this.sr = sampleRate;
    if (cfg) this.configure(cfg);
  }

  /** Allocates and sets every coefficient (outside process()). The state is cleared. */
  configure(cfg: FdnConfig): void {
    this.nets = [new Net(0, this.sr, cfg), new Net(1, this.sr, cfg)];
    this.gain = cfg.gain;
    this.clear();
  }

  clear(): void {
    for (const n of this.nets) n.clear();
    this.sleeping = true;
    this.quiet = 0;
  }

  /** Wet output of (inL, inR) into (outL, outR), `n` samples. */
  process(
    inL: Float32Array | undefined,
    inR: Float32Array | undefined,
    outL: Float32Array,
    outR: Float32Array,
    n: number,
  ): void {
    let any = false;
    if (inL) for (let s = 0; s < n && !any; s++) if (inL[s] !== 0) any = true;
    if (inR && !any) for (let s = 0; s < n && !any; s++) if (inR[s] !== 0) any = true;
    if (any) {
      this.sleeping = false;
      this.quiet = 0;
    }
    const nl = this.nets[0];
    const nr = this.nets[1];
    if (this.sleeping || !nl || !nr) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const peak = Math.max(nl.run(inL, outL, n, this.gain), nr.run(inR, outR, n, this.gain));
    // sleep after a second of silence below −160 dB in and out; the zeroed lines cannot go denormal
    if (!any && peak < 1e-8) {
      this.quiet += n;
      if (this.quiet > this.sr) this.clear();
    }
  }
}

/**
 * The rooms of A4's IR presets (`engine/mixer.js` IR_PRESETS), as their generated IRs actually decay. A4's
 * generator splits noise into bands as `noise − low − high` with phase-shifting filters, so a mid-band
 * residue carries the high frequencies and the nominal high-band T60 (hall 1.2 s) never governs the tail:
 * measured per octave (fdn-core.test.ts), every IR decays at about its mid T60 from 250 Hz to 8 kHz, longer
 * only at 125 Hz. The approved demos have that sound, so the FDN models the measured decays.
 */
export const FDN_PRESETS: Readonly<Record<string, Omit<FdnConfig, 'gain'>>> = {
  // a mid-size hall: the 1945 era (strings, piano); nominal [3.4, 2.7, 1.2]
  hall: { t60: [3.4, 2.75, 2.8], predelay: 0.022, size: 1 },
  // an EMT 140-style plate (1957): dense at once; nominal [2.6, 2.6, 1.9]
  plate: { t60: [2.6, 2.6, 2.65], predelay: 0.004, size: 0.55 },
  // a long digital hall (1978-), smooth; nominal [5.0, 4.4, 2.2]
  digital: { t60: [4.8, 4.4, 4.6], predelay: 0.03, size: 1.2 },
  // the takeoff: very long, dark; nominal [10.0, 8.5, 3.0]
  vast: { t60: [9.5, 8.3, 8.7], predelay: 0.04, size: 1.5 },
};
