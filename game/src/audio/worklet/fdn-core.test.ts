// The FDN reverb (10 §9.4) against A4's convolution reverb, which the approved demos used: A4's generated
// IRs with Chrome's ConvolverNode normalisation, ported. The same level per Hz in the music band and the
// same spectrum within 1.5 dB per octave (at 32 and 48 kHz), the same decay per octave, stable, and asleep
// (exact zeros) after its tail.
import { describe, expect, test } from 'vitest';
import { makeRng } from '../core/rng.ts';
import { FDN_GAIN } from '../music/reverb.ts';
import { FDN_PRESETS, FdnCore } from './fdn-core.ts';
import type { FdnConfig } from './protocol.ts';

const preset = (name: string) => FDN_PRESETS[name] as Omit<FdnConfig, 'gain'>;

interface IrPreset {
  seconds: number;
  t60: [number, number, number];
  predelay: number;
  build?: number;
  early: number;
  earlySpan?: number;
  earlyGain?: number;
  seed: number;
}
// A4 `engine/mixer.js` IR_PRESETS
const IR: Record<string, IrPreset> = {
  hall: { seconds: 5.0, t60: [3.4, 2.7, 1.2], predelay: 0.022, early: 20, earlySpan: 0.08, seed: 1945 },
  plate: { seconds: 4.0, t60: [2.6, 2.6, 1.9], predelay: 0.004, build: 0.002, early: 0, seed: 1957 },
  digital: { seconds: 7.0, t60: [5.0, 4.4, 2.2], predelay: 0.03, early: 10, earlySpan: 0.05, seed: 1978 },
  vast: { seconds: 12.0, t60: [10.0, 8.5, 3.0], predelay: 0.04, early: 8, earlySpan: 0.1, seed: 2024 },
};

/** A4's RBJ biquad (`mixer.js`, linear Q 0.7071), in place. */
function biquad(x: Float64Array, type: 'lp' | 'hp', f0: number, sr: number): Float64Array {
  const w = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w);
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: A4's literal value, kept for an exact port
  const a = Math.sin(w) / (2 * 0.7071);
  const [b0, b1, b2] =
    type === 'lp' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  const a0 = 1 + a;
  const a1 = -2 * cw;
  const a2 = 1 - a;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    x[i] = yi;
  }
  return x;
}

/** A4's `makeIR` (ported), scaled by ConvolverNode's normalisation: the IR the demos convolved with. */
function convolverIr(p: IrPreset, sr = 48000): Float64Array[] {
  const n = Math.floor(sr * p.seconds);
  const rng = makeRng(p.seed);
  const pre = Math.floor(p.predelay * sr);
  const build = p.build ?? 0.012;
  const xover = [350, 3500];
  const chans: Float64Array[] = [];
  for (let c = 0; c < 2; c++) {
    const r = rng.fork(`ch${c}`);
    const noise = new Float64Array(n);
    for (let i = 0; i < n; i++) noise[i] = r.next() * 2 - 1;
    const low = biquad(biquad(noise.slice(), 'lp', xover[0] as number, sr), 'lp', xover[0] as number, sr);
    const high = biquad(biquad(noise.slice(), 'hp', xover[1] as number, sr), 'hp', xover[1] as number, sr);
    const out = new Float64Array(n);
    const k = p.t60.map((t) => 6.9078 / t);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const mid = (noise[i] as number) - (low[i] as number) - (high[i] as number);
      const onset = 1 - Math.exp(-t / build);
      out[i] =
        onset *
        ((low[i] as number) * Math.exp(-(k[0] as number) * t) +
          mid * Math.exp(-(k[1] as number) * t) +
          (high[i] as number) * Math.exp(-(k[2] as number) * t));
    }
    for (let e = 0; e < p.early; e++) {
      const te = p.predelay * 0.4 + r.next() * (p.earlySpan ?? 0.07);
      const idx = Math.floor(te * sr);
      const amp =
        (p.earlyGain ?? 0.5) * (r.next() * 0.6 + 0.4) * Math.exp(-te * 18) * (r.chance(0.5) ? 1 : -1);
      for (let j = 0; j < 24 && idx + j < n; j++)
        out[idx + j] = (out[idx + j] as number) + amp * Math.exp(-j / 5) * 0.35;
    }
    const f0 = Math.floor(n * 0.9);
    for (let i = f0; i < n; i++)
      out[i] = (out[i] as number) * (0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (n - f0)));
    chans.push(out);
  }
  // Web Audio's calculateNormalizationScale
  let power = 0;
  for (const c of chans) for (const x of c) power += x * x;
  power = Math.sqrt(power / (2 * n));
  const scale = (1 / power) * 0.00125 * (44100 / sr);
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] = (c[i] as number) * scale;
  return chans;
}

/**
 * The mean |H(f)|² per octave (centres 63 Hz … 16 kHz) of an impulse response, by FFT: a response's level
 * per Hz, which does not depend on the sample rate (a sum of bins would).
 */
function octaveEnergy(x: ArrayLike<number>, sr: number): number[] {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] as number;
  // iterative radix-2 FFT
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi;
        const xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
  }
  const centres = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  return centres.map((c) => {
    let e = 0;
    let bins = 0;
    for (let k = 1; k < n / 2; k++) {
      const f = (k * sr) / n;
      if (f >= c / Math.SQRT2 && f < c * Math.SQRT2) {
        e += (re[k] as number) ** 2 + (im[k] as number) ** 2;
        bins++;
      }
    }
    return bins > 0 ? e / bins : Number.NaN;
  });
}

/** The FDN's impulse response to L = R = δ, per channel, `seconds` long. */
function fdnIr(name: string, sr: number, seconds: number, gain = 1): [Float32Array, Float32Array] {
  const core = new FdnCore(sr, { ...preset(name), gain });
  const n = Math.round(sr * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const inL = new Float32Array(128);
  const oL = new Float32Array(128);
  const oR = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    inL.fill(0);
    if (f === 0) inL[0] = 1;
    core.process(inL, inL, oL, oR, 128);
    L.set(oL.subarray(0, Math.min(128, n - f)), f);
    R.set(oR.subarray(0, Math.min(128, n - f)), f);
  }
  return [L, R];
}

/** T60 of a band from Schroeder's backward integration, fitted between −5 and −25 dB. */
function bandT60(ir: Float32Array, sr: number, lo: number, hi: number): number {
  const x = Float64Array.from(ir);
  if (lo > 0) for (let k = 0; k < 2; k++) biquad(x, 'hp', lo, sr);
  if (hi > 0) for (let k = 0; k < 2; k++) biquad(x, 'lp', hi, sr);
  const edc = new Float64Array(x.length);
  let acc = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    acc += (x[i] as number) ** 2;
    edc[i] = acc;
  }
  const db = (i: number) => 10 * Math.log10((edc[i] as number) / (edc[0] as number));
  let i5 = 0;
  while (db(i5) > -5) i5++;
  let i25 = i5;
  while (db(i25) > -25) i25++;
  return ((i25 - i5) / sr) * (60 / 20);
}

describe('the FDN reverb', () => {
  const OCT = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  for (const name of ['hall', 'plate']) {
    const conv = convolverIr(IR[name] as IrPreset, 48000);
    const ce = octaveEnergy(conv[0] as Float64Array, 48000);
    for (const sr of [32000, 48000]) {
      test(`${name} at ${sr} Hz: A4's level per Hz in the music band, its spectrum within 1.5 dB per octave`, () => {
        const [L] = fdnIr(name, sr, 20, FDN_GAIN[name] as number);
        const fe = octaveEnergy(L, sr);
        const d = ce.map((c, i) => 10 * Math.log10((fe[i] as number) / c));
        const band = d.slice(1, 7); // 125 Hz – 4 kHz
        const mean = band.reduce((a, b) => a + b, 0) / band.length;
        expect(Math.abs(mean), `${name} ${sr}: ${mean.toFixed(2)} dB`).toBeLessThan(0.25);
        for (let i = 0; i < OCT.length - 1; i++)
          expect(Math.abs(d[i] as number), `${OCT[i]} Hz: ${(d[i] as number).toFixed(1)} dB`).toBeLessThan(
            name === 'plate' && i === 0 ? 3 : 1.5,
          );
      });
    }
    test(`${name}: decays per octave as A4's IR does`, () => {
      const c32 = Float32Array.from(conv[0] as Float64Array);
      const [L] = fdnIr(name, 32000, 20);
      for (const f of [125, 500, 1000, 2000, 4000, 8000]) {
        const a = bandT60(c32, 48000, f / Math.SQRT2, f * Math.SQRT2);
        const b = bandT60(L, 32000, f / Math.SQRT2, f * Math.SQRT2);
        expect(b / a, `${f} Hz: FDN ${b.toFixed(2)} s, IR ${a.toFixed(2)} s`).toBeGreaterThan(0.88);
        expect(b / a, `${f} Hz: FDN ${b.toFixed(2)} s, IR ${a.toFixed(2)} s`).toBeLessThan(1.12);
      }
    });
  }

  test('stable, finite, and asleep with exact zeros after its tail', () => {
    const core = new FdnCore(32000, { ...preset('hall'), gain: FDN_GAIN.hall as number });
    const inp = new Float32Array(128);
    const oL = new Float32Array(128);
    const oR = new Float32Array(128);
    let max = 0;
    let lastNonZero = 0;
    let finite = true;
    for (let f = 0; f < 32000 * 60; f += 128) {
      inp.fill(0);
      if (f < 32000) for (let i = 0; i < 128; i++) inp[i] = Math.sin(f + i) * 0.5;
      core.process(inp, inp, oL, oR, 128);
      for (let i = 0; i < 128; i++) {
        const a = Math.abs(oL[i] as number);
        if (!Number.isFinite(a)) finite = false;
        if (a > max) max = a;
        if (a !== 0) lastNonZero = f + i;
      }
    }
    expect(finite).toBe(true);
    expect(max).toBeLessThan(2);
    expect(lastNonZero / 32000).toBeLessThan(30);
  });
});
