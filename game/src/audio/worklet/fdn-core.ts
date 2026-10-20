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
// denormals). The network runs a block at a time (every line is longer than a render quantum, so a block's
// reads all precede its writes): the same arithmetic as sample by sample, in tighter loops.
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
// Input weights per line (equal magnitude, mixed signs), written out in `block`: +, −, +, +, −, +, −, − / 4.
/** The largest block the network runs at once (a render quantum). */
const BLOCK = 128;
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
  /** Block scratch: the diffused input, and per line its filtered output, then its next input. */
  private readonly xd = new Float64Array(BLOCK);
  private readonly vb: Float64Array[] = Array.from({ length: N }, () => new Float64Array(BLOCK));
  /** The block size: a quantum, or the shortest line if that is shorter. */
  private readonly chunk: number;

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
    this.chunk = Math.min(BLOCK, ...this.len);
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
    let peak = 0;
    for (let off = 0; off < n; off += this.chunk) {
      const p = this.block(inp, out, off, Math.min(this.chunk, n - off), g);
      if (p > peak) peak = p;
    }
    const zl = this.zl;
    const zh = this.zh;
    for (let i = 0; i < N; i++) {
      if (Math.abs(zl[i]!) < 1e-25) zl[i] = 0;
      if (Math.abs(zh[i]!) < 1e-25) zh[i] = 0;
    }
    return peak;
  }

  private block(inp: Float32Array | undefined, out: Float32Array, off: number, m: number, g: number): number {
    const xd = this.xd;
    // 1. predelay and input diffusion (Schroeder allpasses: y = −g·x + d; d' = x + g·y)
    const pre = this.pre;
    const preN = pre.length;
    let pi = this.pi;
    const di = this.diffIdx;
    const d0 = this.diff[0] as Float32Array;
    const d1 = this.diff[1] as Float32Array;
    const d2 = this.diff[2] as Float32Array;
    const d3 = this.diff[3] as Float32Array;
    let i0 = di[0]!;
    let i1 = di[1]!;
    let i2 = di[2]!;
    let i3 = di[3]!;
    const g0 = DIFF_G[0]!;
    const g1 = DIFF_G[1]!;
    const g2 = DIFF_G[2]!;
    const g3 = DIFF_G[3]!;
    for (let s = 0; s < m; s++) {
      let x = pre[pi]!;
      pre[pi] = inp ? inp[off + s]! : 0;
      pi = pi + 1 === preN ? 0 : pi + 1;
      let y = d0[i0]! - g0 * x;
      d0[i0] = x + g0 * y;
      i0 = i0 + 1 === d0.length ? 0 : i0 + 1;
      x = y;
      y = d1[i1]! - g1 * x;
      d1[i1] = x + g1 * y;
      i1 = i1 + 1 === d1.length ? 0 : i1 + 1;
      x = y;
      y = d2[i2]! - g2 * x;
      d2[i2] = x + g2 * y;
      i2 = i2 + 1 === d2.length ? 0 : i2 + 1;
      x = y;
      y = d3[i3]! - g3 * x;
      d3[i3] = x + g3 * y;
      i3 = i3 + 1 === d3.length ? 0 : i3 + 1;
      xd[s] = y;
    }
    this.pi = pi;
    di[0] = i0;
    di[1] = i1;
    di[2] = i2;
    di[3] = i3;
    // 2. each line's next block through its absorption filters (low shelf with the mid gain, high shelf)
    const fl = this.filt;
    for (let i = 0; i < N; i++) {
      const line = this.lines[i] as Float32Array;
      const L = this.len[i]!;
      const V = this.vb[i] as Float64Array;
      const o = i * 6;
      const b0l = fl[o]!;
      const b1l = fl[o + 1]!;
      const a1l = fl[o + 2]!;
      const b0h = fl[o + 3]!;
      const b1h = fl[o + 4]!;
      const a1h = fl[o + 5]!;
      let z1 = this.zl[i]!;
      let z2 = this.zh[i]!;
      let j = this.idx[i]!;
      for (let s = 0; s < m; s++) {
        const xi = line[j]!;
        const y1 = b0l * xi + z1;
        z1 = b1l * xi - a1l * y1;
        const y2 = b0h * y1 + z2;
        z2 = b1h * y1 - a1h * y2;
        V[s] = y2;
        j = j + 1 === L ? 0 : j + 1;
      }
      this.zl[i] = z1;
      this.zh[i] = z2;
    }
    // 3. per sample: the output, the feedback matrix (a normalised Hadamard transform), the injection
    const V0 = this.vb[0] as Float64Array;
    const V1 = this.vb[1] as Float64Array;
    const V2 = this.vb[2] as Float64Array;
    const V3 = this.vb[3] as Float64Array;
    const V4 = this.vb[4] as Float64Array;
    const V5 = this.vb[5] as Float64Array;
    const V6 = this.vb[6] as Float64Array;
    const V7 = this.vb[7] as Float64Array;
    const s8 = 0.35355339059327373; // 1 / √8
    let peak = 0;
    for (let s = 0; s < m; s++) {
      const v0 = V0[s]!;
      const v1 = V1[s]!;
      const v2 = V2[s]!;
      const v3 = V3[s]!;
      const v4 = V4[s]!;
      const v5 = V5[s]!;
      const v6 = V6[s]!;
      const v7 = V7[s]!;
      const o = v0 - v1 + v2 - v3 + v4 - v5 + v6 - v7;
      out[off + s] = o * g;
      const a = o < 0 ? -o : o;
      if (a > peak) peak = a;
      const a0 = v0 + v1;
      const a1 = v0 - v1;
      const a2 = v2 + v3;
      const a3 = v2 - v3;
      const a4 = v4 + v5;
      const a5 = v4 - v5;
      const a6 = v6 + v7;
      const a7 = v6 - v7;
      const b0 = a0 + a2;
      const b2 = a0 - a2;
      const b1 = a1 + a3;
      const b3 = a1 - a3;
      const b4 = a4 + a6;
      const b6 = a4 - a6;
      const b5 = a5 + a7;
      const b7 = a5 - a7;
      const x = xd[s]!;
      V0[s] = (b0 + b4) * s8 + x * 0.25;
      V4[s] = (b0 - b4) * s8 + x * -0.25;
      V1[s] = (b1 + b5) * s8 + x * -0.25;
      V5[s] = (b1 - b5) * s8 + x * 0.25;
      V2[s] = (b2 + b6) * s8 + x * 0.25;
      V6[s] = (b2 - b6) * s8 + x * -0.25;
      V3[s] = (b3 + b7) * s8 + x * 0.25;
      V7[s] = (b3 - b7) * s8 + x * -0.25;
    }
    // 4. write the blocks back into the lines
    for (let i = 0; i < N; i++) {
      const line = this.lines[i] as Float32Array;
      const L = this.len[i]!;
      const W = this.vb[i] as Float64Array;
      let j = this.idx[i]!;
      for (let s = 0; s < m; s++) {
        line[j] = W[s]!;
        j = j + 1 === L ? 0 : j + 1;
      }
      this.idx[i] = j;
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
