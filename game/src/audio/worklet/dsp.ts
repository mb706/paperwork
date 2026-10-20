// DSP primitives shared by the voice bank and the reverb (10 §9.4). They reproduce the Web Audio nodes of
// A4's prototype graph, so the trims and levels A4 calibrated stay valid: BiquadFilterNode's coefficient
// formulas (lowpass and highpass Q in dB), WaveShaperNode's curve interpolation, StereoPannerNode's
// equal-power law and PeriodicWave's peak normalisation. No allocation after construction.

/** Normalised biquad coefficients [b0, b1, b2, a1, a2] (a0 = 1), as BiquadFilterNode computes them. */
export type BiquadType = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf';

export function biquadCoefs(
  type: BiquadType,
  f0: number,
  q: number,
  gainDb: number,
  sr: number,
  out: Float64Array,
  at = 0,
): void {
  const nyq = sr / 2;
  const f = Math.min(Math.max(f0, 1e-3), nyq * 0.9999);
  const w0 = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const A = 10 ** (gainDb / 40);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  switch (type) {
    case 'lowpass': {
      const alpha = sw / (2 * 10 ** (q / 20)); // Q in dB (Web Audio)
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    }
    case 'highpass': {
      const alpha = sw / (2 * 10 ** (q / 20));
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    }
    case 'peaking': {
      const alpha = sw / (2 * q);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
      break;
    }
    case 'lowshelf': {
      const alphaS = (sw / 2) * Math.SQRT2; // shelf slope S = 1
      const k = 2 * Math.sqrt(A) * alphaS;
      b0 = A * (A + 1 - (A - 1) * cw + k);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - k);
      a0 = A + 1 + (A - 1) * cw + k;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - k;
      break;
    }
    case 'highshelf': {
      const alphaS = (sw / 2) * Math.SQRT2;
      const k = 2 * Math.sqrt(A) * alphaS;
      b0 = A * (A + 1 + (A - 1) * cw + k);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - k);
      a0 = A + 1 - (A - 1) * cw + k;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - k;
      break;
    }
  }
  out[at] = b0 / a0;
  out[at + 1] = b1 / a0;
  out[at + 2] = b2 / a0;
  out[at + 3] = a1 / a0;
  out[at + 4] = a2 / a0;
}

/**
 * One biquad over `n` samples in place, transposed direct form II. `c` holds the coefficients at `ci`,
 * `z` the two state words at `zi`. States below 1e-25 are flushed, so a silent tail never becomes denormal.
 */
export function biquadRun(
  x: Float32Array,
  n: number,
  c: Float64Array,
  ci: number,
  z: Float64Array,
  zi: number,
): void {
  const b0 = c[ci] as number;
  const b1 = c[ci + 1] as number;
  const b2 = c[ci + 2] as number;
  const a1 = c[ci + 3] as number;
  const a2 = c[ci + 4] as number;
  let z1 = z[zi] as number;
  let z2 = z[zi + 1] as number;
  for (let i = 0; i < n; i++) {
    const xi = x[i] as number;
    const y = b0 * xi + z1;
    z1 = b1 * xi - a1 * y + z2;
    z2 = b2 * xi - a2 * y;
    x[i] = y;
  }
  z[zi] = Math.abs(z1) < 1e-25 ? 0 : z1;
  z[zi + 1] = Math.abs(z2) < 1e-25 ? 0 : z2;
}

/** WaveShaperNode's curve: tanh(drive·x) ÷ tanh(drive) on [−1, 1], `n` points (A4 `saturationCurve`). */
export function saturationCurve(drive: number, n = 2048): Float32Array {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

/** WaveShaperNode's lookup: linear interpolation over the curve, clamped at its ends (no oversampling). */
export function shape(curve: Float32Array, x: number): number {
  const n = curve.length;
  const v = ((n - 1) / 2) * (x + 1);
  if (v <= 0) return curve[0] as number;
  if (v >= n - 1) return curve[n - 1] as number;
  const k = v | 0;
  const f = v - k;
  return (1 - f) * (curve[k] as number) + f * (curve[k + 1] as number);
}

/** StereoPannerNode, mono input: equal-power gains [left, right] for pan −1..1. */
export function panMono(pan: number, out: Float64Array, at = 0): void {
  const x = (Math.min(1, Math.max(-1, pan)) + 1) / 2;
  out[at] = Math.cos((x * Math.PI) / 2);
  out[at + 1] = Math.sin((x * Math.PI) / 2);
}

/**
 * StereoPannerNode, stereo input: [ll, rl, lr, rr] so that L' = ll·L + rl·R and R' = lr·L + rr·R. At pan 0
 * it is the identity.
 */
export function panStereo(pan: number, out: Float64Array, at = 0): void {
  const p = Math.min(1, Math.max(-1, pan));
  if (p <= 0) {
    const x = p + 1;
    out[at] = 1;
    out[at + 1] = Math.cos((x * Math.PI) / 2);
    out[at + 2] = 0;
    out[at + 3] = Math.sin((x * Math.PI) / 2);
  } else {
    out[at] = Math.cos((p * Math.PI) / 2);
    out[at + 1] = 0;
    out[at + 2] = Math.sin((p * Math.PI) / 2);
    out[at + 3] = 1;
  }
}

/** A sine table of 4096 points plus a guard point, for oscillators and LFOs (linear interpolation). */
export const SINE_SIZE = 4096;
export function sineTable(): Float32Array {
  const t = new Float32Array(SINE_SIZE + 1);
  for (let i = 0; i <= SINE_SIZE; i++) t[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);
  return t;
}

/**
 * A PeriodicWave of sine harmonics (drawbar footages as amplitudes), normalised to a peak of 1 as Web
 * Audio does unless `disableNormalization` is set. `SINE_SIZE` points plus a guard point.
 */
export function harmonicTable(harmonics: readonly number[]): Float32Array {
  const t = new Float32Array(SINE_SIZE + 1);
  let peak = 0;
  for (let i = 0; i < SINE_SIZE; i++) {
    let s = 0;
    for (let k = 1; k < harmonics.length; k++) {
      const a = harmonics[k] as number;
      if (a !== 0) s += a * Math.sin((2 * Math.PI * k * i) / SINE_SIZE);
    }
    t[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  const g = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < SINE_SIZE; i++) t[i] = (t[i] as number) * g;
  t[SINE_SIZE] = t[0] as number;
  return t;
}

/** Table lookup with linear interpolation; `phase` in [0, 1). */
export function lookup(table: Float32Array, phase: number): number {
  const v = phase * SINE_SIZE;
  const k = v | 0;
  const a = table[k] as number;
  return a + ((table[k + 1] as number) - a) * (v - k);
}

/** Risset's additive bell (1969 catalogue): [frequency ratio, amplitude, relative duration, offset Hz]. */
export const RISSET_BELL: readonly (readonly [number, number, number, number])[] = [
  [0.56, 1.0, 1.0, 0],
  [0.56, 0.67, 0.9, 1],
  [0.92, 1.0, 0.65, 0],
  [0.92, 1.8, 0.55, 1.7],
  [1.19, 2.67, 0.325, 0],
  [1.7, 1.67, 0.35, 0],
  [2.0, 1.46, 0.25, 0],
  [2.74, 1.33, 0.2, 0],
  [3.0, 1.33, 0.15, 0],
  [3.76, 1.0, 0.1, 0],
  [4.07, 1.33, 0.075, 0],
];
export const RISSET_SUM = RISSET_BELL.reduce((s, p) => s + p[1], 0);

/** xorshift32 white noise in [−1, 1): the hiss generator's source. State must be non-zero. */
export function xorshift(state: Uint32Array, i: number): number {
  let x = state[i] as number;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state[i] = x >>> 0;
  return (x >>> 0) / 2147483648 - 1;
}
