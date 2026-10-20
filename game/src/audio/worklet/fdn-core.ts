// A feedback-delay-network reverb (10 §9.4; A4 §6.5 #1): one node per era slot replaces the prototype's
// convolvers. Stereo in, wet stereo out.
//
// - Predelay, then four allpass diffusers per side (the dense onset of A4's generated impulse responses).
// - Eight delay lines of 25–85 ms (scaled by `size`), an 8×8 Hadamard feedback matrix (a fast
//   Walsh–Hadamard transform, 24 adds) and, per line, an absorption filter that gives the three bands of
//   A4's IRs their own decay: a broadband gain for the mid-band T60, a first-order low shelf (350 Hz) for
//   the low band and a first-order high shelf (3.5 kHz) for the high band (Jot 1991, simplified).
// - Two orthogonal output sums for left and right.
// The output gain is calibrated so the wet level equals A4's normalised ConvolverNode with its generated
// IR at 48 kHz (§9.4's "same sound"): see `fdnGain` and its test. Nothing allocates in `process()`, and a
// silent reverb sleeps (its lines are zeroed, so a tail never decays into denormals).
import type { FdnConfig } from './protocol.ts';

const N = 8;
/** Line lengths at 48 kHz and size 1: 25–85 ms, coprime, about 0.4 s in all (mode density ≥ 0.15 · T60). */
const LINES_48K = [1201, 1433, 1709, 2039, 2423, 2887, 3433, 4093];
/** Allpass diffusers at 48 kHz (Dattorro's input diffusers, scaled), with their gains. */
const DIFF_48K = [
  [229, 173, 613, 448],
  [239, 181, 587, 467],
];
const DIFF_G = [0.75, 0.75, 0.625, 0.625];
const XOVER_LOW = 350;
const MID_COMP = 1.08;
const XOVER_HIGH = 3500;

export class FdnCore {
  private readonly sr: number;
  private len = new Int32Array(N);
  private lines: Float32Array[] = [];
  private idx = new Int32Array(N);
  /** Per line: low shelf (b0, b1, a1) and high shelf (b0, b1, a1), the mid gain folded into the first. */
  private filt = new Float64Array(N * 6);
  private zl = new Float64Array(N);
  private zh = new Float64Array(N);
  private readonly v = new Float64Array(N);
  private pre: Float32Array = new Float32Array(2);
  private preN = 1;
  private pi = 0;
  private diff: Float32Array[] = [];
  private diffIdx = new Int32Array(8);
  private gain = 0;
  private sleeping = true;
  private quiet = 0;

  constructor(sampleRate: number, cfg?: FdnConfig) {
    this.sr = sampleRate;
    if (cfg) this.configure(cfg);
  }

  /** Allocates and sets every coefficient (outside process()). The state is cleared. */
  configure(cfg: FdnConfig): void {
    const sr = this.sr;
    const scale = (sr / 48000) * cfg.size;
    this.len = new Int32Array(LINES_48K.map((l) => Math.max(16, Math.round(l * scale))));
    this.lines = Array.from(this.len, (l) => new Float32Array(l));
    this.idx = new Int32Array(N);
    const [tLow, tMid0, tHigh] = cfg.t60;
    // the first-order shelves' wide transitions shorten the mid band a little: a measured 8 % compensation
    const tMid = tMid0 * MID_COMP;
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
    this.preN = Math.max(1, Math.round(cfg.predelay * sr));
    this.pre = new Float32Array(this.preN * 2);
    this.pi = 0;
    const ds = Math.max(0.35, Math.min(1, cfg.size)) * (sr / 48000);
    this.diff = [];
    for (let side = 0; side < 2; side++)
      for (const d of DIFF_48K[side] as number[])
        this.diff.push(new Float32Array(Math.max(4, Math.round(d * ds))));
    this.diffIdx = new Int32Array(8);
    this.gain = cfg.gain;
    this.clear();
  }

  clear(): void {
    for (const l of this.lines) l.fill(0);
    for (const d of this.diff) d.fill(0);
    this.pre.fill(0);
    this.zl.fill(0);
    this.zh.fill(0);
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
    if (this.sleeping) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const v = this.v;
    const lines = this.lines;
    const idx = this.idx;
    const len = this.len;
    const fl = this.filt;
    const zl = this.zl;
    const zh = this.zh;
    const pre = this.pre;
    const preN = this.preN;
    const diff = this.diff;
    const di = this.diffIdx;
    const g = this.gain;
    const s8 = 0.35355339059327373; // 1 / √8
    let peak = 0;
    for (let s = 0; s < n; s++) {
      // predelay (an interleaved stereo ring)
      const p = this.pi;
      let xl = pre[2 * p] as number;
      let xr = pre[2 * p + 1] as number;
      pre[2 * p] = inL ? (inL[s] as number) : 0;
      pre[2 * p + 1] = inR ? (inR[s] as number) : 0;
      this.pi = p + 1 === preN ? 0 : p + 1;
      // input diffusion: Schroeder allpasses, y = −g·x + d; d' = x + g·y
      for (let k = 0; k < 4; k++) {
        const bl = diff[k] as Float32Array;
        const il = di[k] as number;
        const dl = bl[il] as number;
        const yl = dl - DIFF_G[k]! * xl;
        bl[il] = xl + DIFF_G[k]! * yl;
        di[k] = il + 1 === bl.length ? 0 : il + 1;
        xl = yl;
        const br = diff[4 + k] as Float32Array;
        const ir = di[4 + k] as number;
        const dr = br[ir] as number;
        const yr = dr - DIFF_G[k]! * xr;
        br[ir] = xr + DIFF_G[k]! * yr;
        di[4 + k] = ir + 1 === br.length ? 0 : ir + 1;
        xr = yr;
      }
      // read the lines through their absorption filters
      for (let i = 0; i < N; i++) {
        const x = (lines[i] as Float32Array)[idx[i] as number] as number;
        const o = i * 6;
        const yl1 = fl[o]! * x + zl[i]!;
        zl[i] = fl[o + 1]! * x - fl[o + 2]! * yl1;
        const yh = fl[o + 3]! * yl1 + zh[i]!;
        zh[i] = fl[o + 4]! * yl1 - fl[o + 5]! * yh;
        v[i] = yh;
      }
      const ol = v[0]! - v[1]! + v[2]! - v[3]! + v[4]! - v[5]! + v[6]! - v[7]!;
      const or = v[0]! + v[1]! - v[2]! - v[3]! + v[4]! + v[5]! - v[6]! - v[7]!;
      outL[s] = ol * g;
      outR[s] = or * g;
      const a = ol < 0 ? -ol : ol;
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
      // inject the diffused input with alternating signs, and write back
      for (let i = 0; i < N; i++) {
        const inj = (i & 1 ? xr : xl) * (i & 2 ? -0.25 : 0.25);
        const line = lines[i] as Float32Array;
        const j = idx[i] as number;
        line[j] = v[i]! + inj;
        idx[i] = j + 1 === len[i] ? 0 : j + 1;
      }
    }
    // sleep after a second of silence below −160 dB in and out; the zeroed lines cannot go denormal
    if (!any && peak < 1e-8) {
      this.quiet += n;
      if (this.quiet > this.sr) this.clear();
    }
    for (let i = 0; i < N; i++) {
      if (Math.abs(zl[i]!) < 1e-25) zl[i] = 0;
      if (Math.abs(zh[i]!) < 1e-25) zh[i] = 0;
    }
  }
}

/** A4's IR presets (`engine/mixer.js` IR_PRESETS): T60 per band, predelay; `size` for the line lengths. */
export const FDN_PRESETS: Readonly<Record<string, Omit<FdnConfig, 'gain'>>> = {
  // a mid-size hall: the 1945 era (strings, piano)
  hall: { t60: [3.4, 2.7, 1.2], predelay: 0.022, size: 1 },
  // an EMT 140-style plate (1957): dense at once, brighter
  plate: { t60: [2.6, 2.6, 1.9], predelay: 0.004, size: 0.55 },
  // a long digital hall (1978-), smooth
  digital: { t60: [5.0, 4.4, 2.2], predelay: 0.03, size: 1.2 },
  // the takeoff: very long, dark
  vast: { t60: [10.0, 8.5, 3.0], predelay: 0.04, size: 1.5 },
};
