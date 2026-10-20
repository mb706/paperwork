// A sampler voice mixer as an AudioWorklet processor (B2 audio CPU study; 10 §9.4).
// Samples are Int16 PCM (half the memory of decoded AudioBuffers), at any sample rate; voices are
// started by messages {when (s), buf, rate, gain, pan, dur, release}; linear interpolation, a linear
// attack and an exponential release, equal-power pan; allocation-free in process().
class SamplerProc extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions ?? {};
    this.max = o.maxVoices ?? 64;
    this.bufs = [];
    this.bufRate = [];
    const M = this.max;
    this.vBuf = new Int32Array(M).fill(-1);
    this.vPos = new Float64Array(M);
    this.vInc = new Float64Array(M);
    this.vGL = new Float32Array(M);
    this.vGR = new Float32Array(M);
    this.vEnv = new Float32Array(M);
    this.vAtk = new Float32Array(M);
    this.vRel = new Float32Array(M);
    this.vStart = new Float64Array(M);
    this.vStop = new Float64Array(M);
    this.queue = [];
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'buf') { this.bufs[m.id] = m.data; this.bufRate[m.id] = m.rate; }
      else if (m.t === 'notes') { for (const n of m.notes) this.queue.push(n); }
    };
  }

  start(n) {
    let k = -1, quiet = 1e9;
    for (let i = 0; i < this.max; i++) {
      if (this.vBuf[i] < 0) { k = i; break; }
      if (this.vEnv[i] < quiet) { quiet = this.vEnv[i]; k = i; }   // steal the quietest
    }
    this.vBuf[k] = n.buf;
    this.vPos[k] = 0;
    this.vInc[k] = n.rate * this.bufRate[n.buf] / sampleRate;
    const p = (n.pan + 1) * Math.PI / 4;
    this.vGL[k] = n.gain * Math.cos(p);
    this.vGR[k] = n.gain * Math.sin(p);
    this.vEnv[k] = 0;
    this.vAtk[k] = 1 / Math.max(1, 0.004 * sampleRate);
    this.vRel[k] = Math.exp(-1 / Math.max(1, (n.release ?? 0.3) * sampleRate / 4.5));
    this.vStart[k] = n.when * sampleRate;
    this.vStop[k] = (n.when + n.dur) * sampleRate;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const n = L.length;
    const f0 = currentFrame;
    if (this.queue.length) {
      for (let q = this.queue.length - 1; q >= 0; q--) {
        if (this.queue[q].when * sampleRate < f0 + n) { this.start(this.queue[q]); this.queue.splice(q, 1); }
      }
    }
    for (let i = 0; i < this.max; i++) {
      const b = this.vBuf[i];
      if (b < 0) continue;
      const d = this.bufs[b];
      const len = d.length - 1;
      let pos = this.vPos[i], env = this.vEnv[i];
      const inc = this.vInc[i], gl = this.vGL[i] / 32768, gr = this.vGR[i] / 32768;
      const atk = this.vAtk[i], rel = this.vRel[i], st = this.vStart[i], sp = this.vStop[i];
      let s0 = Math.max(0, Math.ceil(st - f0));
      for (let s = s0; s < n; s++) {
        const ip = pos | 0;
        if (ip >= len) { env = 0; break; }
        const fr = pos - ip;
        const x = d[ip] + (d[ip + 1] - d[ip]) * fr;
        if (f0 + s < sp) env = env < 1 ? Math.min(1, env + atk) : 1; else env *= rel;
        const y = x * env;
        L[s] += y * gl;
        R[s] += y * gr;
        pos += inc;
      }
      this.vPos[i] = pos;
      this.vEnv[i] = env;
      if ((f0 + n > sp && env < 1e-4) || pos >= len) this.vBuf[i] = -1;
    }
    return true;
  }
}
registerProcessor('sampler', SamplerProc);
