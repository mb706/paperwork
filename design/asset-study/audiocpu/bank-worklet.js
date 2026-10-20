// A sampler bank as one AudioWorklet node (B2 audio CPU study; 10 §9.4): every sampler voice of the music engine
// mixed in JS, one stereo output per mixer channel, so a note costs no audio nodes at all.
// Buffers arrive once as Int16 PCM per channel ({t:'buf', id, chans: [Int16Array, ...], rate}); notes arrive as
// {t:'notes', notes: [{when, buf, out, rate, gain, attack, linear, off, release, stop, offset}]} in context seconds.
// Envelope as A4's Sampler._segment: linear (or exponential-approach) attack, hold, exponential release with
// time constant release/4.5, hard stop at `stop`. Voice cap with stealing of the quietest. No allocation in process().
class Bank extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const M = (opts.processorOptions ?? {}).maxVoices ?? 48;
    this.M = M;
    this.bufs = [];
    this.on = new Uint8Array(M);
    this.buf = new Int32Array(M);
    this.out = new Int32Array(M);
    this.pos = new Float64Array(M);
    this.inc = new Float64Array(M);
    this.g = new Float32Array(M);
    this.env = new Float32Array(M);
    this.aStep = new Float32Array(M);   // linear attack step per sample, 0 = exponential approach
    this.aK = new Float32Array(M);      // exponential approach coefficient
    this.rK = new Float32Array(M);
    this.t0 = new Float64Array(M);
    this.tOff = new Float64Array(M);
    this.tStop = new Float64Array(M);
    this.q = [];
    this.stolen = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'buf') this.bufs[m.id] = { chans: m.chans, rate: m.rate, len: m.chans[0].length };
      else if (m.t === 'notes') for (const n of m.notes) this.q.push(n);
      else if (m.t === 'stats') this.port.postMessage({ stolen: this.stolen, active: this.on.reduce((a, b) => a + b, 0) });
    };
  }

  start(n) {
    let k = -1;
    let quiet = Infinity;
    for (let i = 0; i < this.M; i++) {
      if (!this.on[i]) { k = i; break; }
      const lvl = this.g[i] * this.env[i];
      if (lvl < quiet) { quiet = lvl; k = i; }
    }
    if (this.on[k]) this.stolen++;
    const b = this.bufs[n.buf];
    this.on[k] = 1;
    this.buf[k] = n.buf;
    this.out[k] = n.out;
    this.pos[k] = (n.offset ?? 0) * b.rate;
    this.inc[k] = n.rate * b.rate / sampleRate;
    this.g[k] = n.gain / 32768;
    this.env[k] = n.attack > 0.004 ? 0 : 1;
    this.aStep[k] = n.attack > 0.004 && n.linear ? 1 / (n.attack * sampleRate) : 0;
    this.aK[k] = n.attack > 0.004 && !n.linear ? 1 - Math.exp(-1 / (n.attack / 3 * sampleRate)) : 1;
    this.rK[k] = Math.exp(-1 / Math.max(1, n.release / 4.5 * sampleRate));
    this.t0[k] = n.when * sampleRate;
    this.tOff[k] = n.off * sampleRate;
    this.tStop[k] = n.stop * sampleRate;
  }

  process(inputs, outputs) {
    const f0 = currentFrame;
    const n = outputs[0][0].length;
    if (this.q.length) {
      for (let j = this.q.length - 1; j >= 0; j--) {
        if (this.q[j].when * sampleRate < f0 + n) { this.start(this.q[j]); this.q.splice(j, 1); }
      }
    }
    for (let i = 0; i < this.M; i++) {
      if (!this.on[i]) continue;
      const b = this.bufs[this.buf[i]];
      const o = outputs[this.out[i]];
      const L = o[0], R = o[1];
      const c0 = b.chans[0], c1 = b.chans.length > 1 ? b.chans[1] : b.chans[0];
      const last = b.len - 1;
      let pos = this.pos[i], env = this.env[i];
      const inc = this.inc[i], g = this.g[i], aStep = this.aStep[i], aK = this.aK[i], rK = this.rK[i];
      const t0 = this.t0[i], tOff = this.tOff[i], tStop = this.tStop[i];
      let s = t0 > f0 ? Math.min(n, Math.ceil(t0 - f0)) : 0;
      let done = false;
      for (; s < n; s++) {
        const f = f0 + s;
        if (f >= tStop) { done = true; break; }
        const ip = pos | 0;
        if (ip >= last) { done = true; break; }
        if (f < tOff) {
          if (env < 1) env = aStep > 0 ? Math.min(1, env + aStep) : env + (1 - env) * aK;
        } else env *= rK;
        const fr = pos - ip;
        const a = c0[ip] + (c0[ip + 1] - c0[ip]) * fr;
        const bR = c1[ip] + (c1[ip + 1] - c1[ip]) * fr;
        const k = g * env;
        L[s] += a * k;
        R[s] += bR * k;
        pos += inc;
      }
      this.pos[i] = pos;
      this.env[i] = env;
      if (done || (f0 + n > tOff && env < 1e-5)) this.on[i] = 0;
    }
    return true;
  }
}
registerProcessor('sampler-bank', Bank);
