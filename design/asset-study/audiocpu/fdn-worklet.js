// A feedback-delay-network reverb as an AudioWorklet processor (B2 audio CPU study; 10 §9.4).
// Eight delay lines, an 8x8 Hadamard feedback matrix (fast Walsh-Hadamard, 24 adds), per-line gain set
// from a mid-band T60 and a one-pole lowpass in each loop whose pole gives the high-band T60
// (Jot 1991, simplified). Stereo in, stereo out, wet only. Allocation-free in process().
// Parameters (processorOptions): t60 (s, mid band), t60High (s, at 6 kHz), predelay (s), size (scales the
// line lengths), seed.
class FDN extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions ?? {};
    const fs = sampleRate;
    const base = [1009, 1201, 1361, 1523, 1693, 1871, 2063, 2251]; // primes; ~21-47 ms at 48 kHz
    const size = o.size ?? 1.0;
    this.N = 8;
    this.len = base.map((b) => Math.max(64, Math.round(b * size * fs / 48000)));
    this.buf = this.len.map((n) => new Float32Array(n));
    this.idx = new Int32Array(8);
    const t60 = o.t60 ?? 2.7;
    const t60h = o.t60High ?? 1.2;
    // per-line broadband gain for the mid T60, and a one-pole damping coefficient that lowers the
    // high-frequency T60 to t60High (approximate: matched at 6 kHz)
    this.g = new Float32Array(8);
    this.a = new Float32Array(8);
    this.z = new Float32Array(8);
    const w = 2 * Math.PI * 6000 / fs;
    for (let i = 0; i < 8; i++) {
      const L = this.len[i];
      this.g[i] = Math.pow(10, (-3 * L) / (fs * t60));
      const gh = Math.pow(10, (-3 * L) / (fs * t60h)) / this.g[i]; // extra attenuation wanted at 6 kHz
      // one-pole y = (1-a) x + a y1 has |H(w)| = (1-a)/sqrt(1 - 2a cos w + a^2); solve |H| = gh for a
      let lo = 0, hi = 0.999;
      for (let k = 0; k < 40; k++) {
        const a = (lo + hi) / 2;
        const m = (1 - a) / Math.sqrt(1 - 2 * a * Math.cos(w) + a * a);
        if (m > gh) lo = a; else hi = a;
      }
      this.a[i] = (lo + hi) / 2;
    }
    this.pre = new Float32Array(Math.max(1, Math.round((o.predelay ?? 0.02) * fs)) * 2);
    this.preN = this.pre.length / 2;
    this.pi = 0;
    this.v = new Float32Array(8);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const inL = inp[0], inR = inp[1] ?? inp[0];
    const oL = out[0], oR = out[1] ?? out[0];
    const v = this.v, g = this.g, a = this.a, z = this.z, buf = this.buf, idx = this.idx, len = this.len;
    const pre = this.pre, preN = this.preN;
    const s8 = 0.35355339; // 1/sqrt(8)
    for (let s = 0; s < n; s++) {
      // predelay (interleaved stereo ring)
      const xl = inL ? inL[s] : 0, xr = inR ? inR[s] : 0;
      const p = this.pi;
      const dl = pre[2 * p], dr = pre[2 * p + 1];
      pre[2 * p] = xl; pre[2 * p + 1] = xr;
      this.pi = p + 1 === preN ? 0 : p + 1;
      // read the lines, damp
      for (let i = 0; i < 8; i++) {
        const y = buf[i][idx[i]];
        z[i] = (1 - a[i]) * y + a[i] * z[i];
        v[i] = z[i] * g[i];
      }
      // outputs: two decorrelated sums
      oL[s] = v[0] - v[1] + v[2] - v[3] + v[4] - v[5] + v[6] - v[7];
      oR[s] = v[0] + v[1] - v[2] - v[3] + v[4] + v[5] - v[6] - v[7];
      // fast Walsh-Hadamard on v
      let a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3];
      let a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
      let b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3;
      let b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
      v[0] = (b0 + b4) * s8; v[4] = (b0 - b4) * s8; v[1] = (b1 + b5) * s8; v[5] = (b1 - b5) * s8;
      v[2] = (b2 + b6) * s8; v[6] = (b2 - b6) * s8; v[3] = (b3 + b7) * s8; v[7] = (b3 - b7) * s8;
      // inject the input with alternating signs, write back
      for (let i = 0; i < 8; i++) {
        const inj = (i & 1 ? dr : dl) * (i & 2 ? -0.25 : 0.25);
        buf[i][idx[i]] = v[i] + inj;
        idx[i] = idx[i] + 1 === len[i] ? 0 : idx[i] + 1;
      }
    }
    for (let s = 0; s < n; s++) { oL[s] *= 0.5; oR[s] *= 0.5; }
    return true;
  }
}
registerProcessor('fdn-reverb', FDN);
