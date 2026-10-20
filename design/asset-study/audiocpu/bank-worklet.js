// The voice bank as one AudioWorklet node (B2 audio CPU study; 10 §9.4): every sampler voice of the music engine
// and the SFX, mixed in JS, with one stereo output per mixer channel, the channels' tape and tremolo inserts, and
// looping voices for working sounds. A note costs no audio nodes.
//
// Messages (main thread -> processor); nothing in process() allocates:
//   {t: 'buf', id, chans: [Int16Array, ...], rate}            sample data, once per file (transferred)
//   {t: 'notes', n, data: Float64Array(n * NF)}               a batch of notes, one message per scheduler tick
//   {t: 'insert', out, kind: 'tape' | 'tremolo', p: {...}}    a channel's insert, configured once
//   {t: 'stats'}                                              -> {stolen, active, maxActive, dropped}
// A note's fields (NF = 14): when, buf, out, rate, gain, attack, linear, off, release, stop, offset, pan,
//   loopStart, loopEnd (in source samples; loopEnd 0 = no loop). Times in context seconds.
const NF = 14;
const QCAP = 2048;
class Bank extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions ?? {};
    const M = o.maxVoices ?? 72;
    this.M = M;
    this.bufs = new Array(4096).fill(null);
    this.on = new Uint8Array(M);
    this.buf = new Int32Array(M);
    this.out = new Int32Array(M);
    this.pos = new Float64Array(M);
    this.inc = new Float64Array(M);
    this.gl = new Float32Array(M);
    this.gr = new Float32Array(M);
    this.env = new Float32Array(M);
    this.aStep = new Float32Array(M);
    this.aK = new Float32Array(M);
    this.rK = new Float32Array(M);
    this.t0 = new Float64Array(M);
    this.tOff = new Float64Array(M);
    this.tStop = new Float64Array(M);
    this.lS = new Float64Array(M);
    this.lE = new Float64Array(M);
    // pending notes: a preallocated table; slots are reused, never spliced
    this.q = new Float64Array(QCAP * NF);
    this.qUsed = new Uint8Array(QCAP);
    this.qCount = 0;
    this.dropped = 0;
    this.stolen = 0;
    this.maxActive = 0;
    // per-output inserts (allocated when configured, outside process())
    this.ins = [];
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.t === 'buf') this.bufs[m.id] = { chans: m.chans, rate: m.rate, len: m.chans[0].length };
    else if (m.t === 'notes') {
      const d = m.data;
      for (let i = 0; i < m.n; i++) {
        let slot = -1;
        for (let s = 0; s < QCAP; s++) if (!this.qUsed[s]) { slot = s; break; }
        if (slot < 0) { this.dropped++; continue; }
        this.qUsed[slot] = 1;
        this.qCount++;
        for (let f = 0; f < NF; f++) this.q[slot * NF + f] = d[i * NF + f];
      }
    } else if (m.t === 'insert') this.ins[m.out] = this.makeInsert(m.kind, m.p ?? {});
    else if (m.t === 'stats') {
      let a = 0;
      for (let i = 0; i < this.M; i++) a += this.on[i];
      this.port.postMessage({ stolen: this.stolen, active: a, maxActive: this.maxActive, dropped: this.dropped });
    }
  }

  makeInsert(kind, p) {
    if (kind === 'tremolo') return { kind: 1, rate: p.rate ?? 5.2, depth: p.depth ?? 0.3, ph: 0 };
    const size = Math.ceil(0.1 * sampleRate);
    const lp = biquad('lp', p.lowpass ?? 11000, 0.5), hp = biquad('hp', p.highpass ?? 45, 0.7071);
    const drive = p.drive ?? 1.6;
    return { kind: 2, size, bufL: new Float32Array(size), bufR: new Float32Array(size), w: 0,
      wowHz: p.wowHz ?? 0.55, wowMs: p.wowMs ?? 0.9, flHz: p.flutterHz ?? 7.3, flMs: p.flutterMs ?? 0.09, ph1: 0, ph2: 0,
      drive, post: tanhApprox(drive) / (0.7 * drive), lp, hp, sL: new Float64Array(8), sR: new Float64Array(8) };
  }

  start(slot) {
    const b = this.q;
    const o = slot * NF;
    const src = this.bufs[b[o + 1]];
    if (!src) { this.dropped++; return; }          // a sample that is not loaded: dropped, never queued
    let k = -1, quiet = Infinity;
    for (let i = 0; i < this.M; i++) {
      if (!this.on[i]) { k = i; break; }
      const lvl = (this.gl[i] + this.gr[i]) * this.env[i];
      if (lvl < quiet) { quiet = lvl; k = i; }
    }
    if (this.on[k]) this.stolen++;
    this.on[k] = 1;
    this.buf[k] = b[o + 1];
    this.out[k] = b[o + 2];
    this.pos[k] = b[o + 10] * src.rate;
    this.inc[k] = b[o + 3] * src.rate / sampleRate;
    const g = b[o + 4] / 32768;
    const pan = b[o + 11];
    const a = (pan + 1) * Math.PI / 4;
    this.gl[k] = g * Math.cos(a) * Math.SQRT2;
    this.gr[k] = g * Math.sin(a) * Math.SQRT2;
    const attack = b[o + 5];
    this.env[k] = attack > 0.004 ? 0 : 1;
    this.aStep[k] = attack > 0.004 && b[o + 6] ? 1 / (attack * sampleRate) : 0;
    this.aK[k] = attack > 0.004 && !b[o + 6] ? 1 - Math.exp(-1 / (attack / 3 * sampleRate)) : 1;
    this.rK[k] = Math.exp(-1 / Math.max(1, b[o + 8] / 4.5 * sampleRate));
    this.t0[k] = b[o] * sampleRate;
    this.tOff[k] = b[o + 7] * sampleRate;
    this.tStop[k] = b[o + 9] * sampleRate;
    this.lS[k] = b[o + 12];
    this.lE[k] = b[o + 13];
  }

  process(inputs, outputs) {
    const f0 = currentFrame;
    const n = outputs[0][0].length;
    if (this.qCount) {
      const lim = (f0 + n) / sampleRate;
      for (let s = 0; s < QCAP; s++) {
        if (this.qUsed[s] && this.q[s * NF] < lim) { this.start(s); this.qUsed[s] = 0; this.qCount--; }
      }
    }
    let act = 0;
    for (let i = 0; i < this.M; i++) {
      if (!this.on[i]) continue;
      act++;
      const src = this.bufs[this.buf[i]];
      const o = outputs[this.out[i]];
      const L = o[0], R = o[1];
      const c0 = src.chans[0], c1 = src.chans.length > 1 ? src.chans[1] : src.chans[0];
      const last = src.len - 1;
      let pos = this.pos[i], env = this.env[i];
      const inc = this.inc[i], gl = this.gl[i], gr = this.gr[i], aStep = this.aStep[i], aK = this.aK[i], rK = this.rK[i];
      const t0 = this.t0[i], tOff = this.tOff[i], tStop = this.tStop[i], lS = this.lS[i], lE = this.lE[i];
      let s = t0 > f0 ? Math.min(n, Math.ceil(t0 - f0)) : 0;
      let done = false;
      for (; s < n; s++) {
        const f = f0 + s;
        if (f >= tStop) { done = true; break; }
        if (lE > 0 && pos >= lE) pos -= lE - lS;
        const ip = pos | 0;
        if (ip >= last) { done = true; break; }
        if (f < tOff) {
          if (env < 1) env = aStep > 0 ? Math.min(1, env + aStep) : env + (1 - env) * aK;
        } else env *= rK;
        const fr = pos - ip;
        const a = c0[ip] + (c0[ip + 1] - c0[ip]) * fr;
        const r = c1[ip] + (c1[ip + 1] - c1[ip]) * fr;
        L[s] += a * gl * env;
        R[s] += r * gr * env;
        pos += inc;
      }
      this.pos[i] = pos;
      this.env[i] = env;
      if (done || (f0 + n > tOff && env < 1e-5)) this.on[i] = 0;
    }
    if (act > this.maxActive) this.maxActive = act;
    // the channels' inserts, in place on each output
    for (let c = 0; c < this.ins.length; c++) {
      const ins = this.ins[c];
      if (!ins) continue;
      const L = outputs[c][0], R = outputs[c][1];
      if (ins.kind === 1) {
        const w = 2 * Math.PI * ins.rate / sampleRate;
        let ph = ins.ph;
        for (let s = 0; s < n; s++) {
          const g = 1 - ins.depth / 2 + (ins.depth / 2) * Math.sin(ph);
          L[s] *= g; R[s] *= g; ph += w;
        }
        ins.ph = ph % (2 * Math.PI);
      } else {
        tape(ins, L, R, n);
      }
    }
    return true;
  }
}

function tanhApprox(x) {                 // rational approximation, |error| < 0.02 on [-3, 3], clamped beyond
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function biquad(type, f0, q) {           // RBJ coefficients, normalised: [b0, b1, b2, a1, a2]
  const w = 2 * Math.PI * f0 / sampleRate, cw = Math.cos(w), sw = Math.sin(w), a = sw / (2 * q);
  const a0 = 1 + a;
  if (type === 'lp') return [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, -2 * cw / a0, (1 - a) / a0];
  return [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - a) / a0];
}

function tape(t, L, R, n) {              // wow and flutter (a modulated delay), saturation, tape bandwidth
  const sr = sampleRate, size = t.size, bL = t.bufL, bR = t.bufR;
  const w1 = 2 * Math.PI * t.wowHz / sr, w2 = 2 * Math.PI * t.flHz / sr;
  const base = 0.012 * sr, a1 = t.wowMs / 1000 * sr, a2 = t.flMs / 1000 * sr;
  const lp = t.lp, hp = t.hp, sL = t.sL, sR = t.sR, drive = t.drive, post = t.post;
  let ph1 = t.ph1, ph2 = t.ph2, wi = t.w;
  for (let s = 0; s < n; s++) {
    bL[wi] = L[s]; bR[wi] = R[s];
    const d = base + a1 * Math.sin(ph1) + a2 * Math.sin(ph2);
    let rp = wi - d; if (rp < 0) rp += size;
    const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 === size ? 0 : i0 + 1;
    let xl = bL[i0] + (bL[i1] - bL[i0]) * fr, xr = bR[i0] + (bR[i1] - bR[i0]) * fr;
    xl = tanhApprox(drive * 0.7 * xl) * post; xr = tanhApprox(drive * 0.7 * xr) * post;
    // lowpass then highpass, direct form I; state: [x1, x2, y1, y2] for each filter
    let y = lp[0] * xl + lp[1] * sL[0] + lp[2] * sL[1] - lp[3] * sL[2] - lp[4] * sL[3];
    sL[1] = sL[0]; sL[0] = xl; sL[3] = sL[2]; sL[2] = y; xl = y;
    y = hp[0] * xl + hp[1] * sL[4] + hp[2] * sL[5] - hp[3] * sL[6] - hp[4] * sL[7];
    sL[5] = sL[4]; sL[4] = xl; sL[7] = sL[6]; sL[6] = y; L[s] = y;
    y = lp[0] * xr + lp[1] * sR[0] + lp[2] * sR[1] - lp[3] * sR[2] - lp[4] * sR[3];
    sR[1] = sR[0]; sR[0] = xr; sR[3] = sR[2]; sR[2] = y; xr = y;
    y = hp[0] * xr + hp[1] * sR[4] + hp[2] * sR[5] - hp[3] * sR[6] - hp[4] * sR[7];
    sR[5] = sR[4]; sR[4] = xr; sR[7] = sR[6]; sR[6] = y; R[s] = y;
    ph1 += w1; ph2 += w2;
    wi = wi + 1 === size ? 0 : wi + 1;
  }
  t.ph1 = ph1 % (2 * Math.PI); t.ph2 = ph2 % (2 * Math.PI); t.w = wi;
}

registerProcessor('sampler-bank', Bank);
