// The music engine's WebAudio graph: channels -> (dry, reverb send) -> music bus -> master.
//
//   voice ─> channel.input ─> [insert fx] ─> pan ─┬─> dry ─────────────> musicBus ─> glue ─> master ─> limiter ─> out
//                                                 └─> send ─> reverb ─> wet ─────┘
//
// Everything here runs on the audio thread once built; the main thread only creates short-lived
// voice nodes (instruments.js) a little ahead of time (clock.js).

import { makeRng } from './rng.js';

export const dbToGain = (db) => 10 ** (db / 20);

// ---------- impulse responses (generated, so they cost no download) ----------

/** RBJ biquad, applied in place to a Float32Array. */
function biquad(x, type, f0, sr, q = 0.7071) {
  const w = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const a = sw / (2 * q);
  let b0;
  let b1;
  let b2;
  if (type === 'lp') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
  } else {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
  }
  const a0 = 1 + a;
  const a1 = -2 * cw;
  const a2 = 1 - a;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    x[i] = yi;
  }
  return x;
}

/**
 * A stereo room/plate impulse response: decorrelated noise in three bands, each with its own
 * T60 (low, mid, high), a diffuse build-up, optional early reflections and pre-delay.
 */
export function makeIR(ctx, p = {}) {
  const sr = ctx.sampleRate;
  const {
    seconds = 4.5,
    t60 = [3.0, 2.6, 1.3], // low (<350 Hz), mid, high (>3.5 kHz)
    predelay = 0.018,
    build = 0.012, // diffuse onset time constant
    early = 18, // number of early reflections (0 for a plate)
    earlySpan = 0.07,
    earlyGain = 0.5,
    xover = [350, 3500],
    seed = 1945,
    widthDecorrelate = true,
  } = p;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const rng = makeRng(seed);
  const pre = Math.floor(predelay * sr);
  for (let c = 0; c < 2; c++) {
    const r = widthDecorrelate ? rng.fork(`ch${c}`) : rng.fork('ch0');
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = r.next() * 2 - 1;
    const low = biquad(biquad(noise.slice(), 'lp', xover[0], sr), 'lp', xover[0], sr);
    const high = biquad(biquad(noise.slice(), 'hp', xover[1], sr), 'hp', xover[1], sr);
    const out = buf.getChannelData(c);
    const k = [6.9078 / t60[0], 6.9078 / t60[1], 6.9078 / t60[2]]; // ln(1000)/T60
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const mid = noise[i] - low[i] - high[i];
      const onset = 1 - Math.exp(-t / build);
      out[i] = onset * (low[i] * Math.exp(-k[0] * t) + mid * Math.exp(-k[1] * t) + high[i] * Math.exp(-k[2] * t));
    }
    // early reflections: sparse, slightly low-passed taps, panned by channel
    for (let e = 0; e < early; e++) {
      const te = predelay * 0.4 + r.next() * earlySpan;
      const idx = Math.floor(te * sr);
      const amp = earlyGain * (r.next() * 0.6 + 0.4) * Math.exp(-te * 18) * (r.chance(0.5) ? 1 : -1);
      for (let j = 0; j < 24 && idx + j < n; j++) out[idx + j] += amp * Math.exp(-j / 5) * 0.35;
    }
    // fade the last 10% to avoid a truncation step
    const f0 = Math.floor(n * 0.9);
    for (let i = f0; i < n; i++) out[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (n - f0));
  }
  return buf;
}

export const IR_PRESETS = {
  // A mid-size hall: the 1945 era (strings, piano)
  hall: { seconds: 5.0, t60: [3.4, 2.7, 1.2], predelay: 0.022, early: 20, earlySpan: 0.08, seed: 1945 },
  // An EMT 140-style plate (1957): dense at once, brighter, no early reflections
  plate: { seconds: 4.0, t60: [2.6, 2.6, 1.9], predelay: 0.004, build: 0.002, early: 0, seed: 1957 },
  // A long digital hall (1978-), smooth
  digital: { seconds: 7.0, t60: [5.0, 4.4, 2.2], predelay: 0.03, early: 10, earlySpan: 0.05, seed: 1978 },
  // Takeoff: very long, dark
  vast: { seconds: 12.0, t60: [10.0, 8.5, 3.0], predelay: 0.04, early: 8, earlySpan: 0.1, seed: 2024 },
};

// ---------- the mixer ----------

export class Mixer {
  constructor(ctx, out = ctx.destination, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.channels = new Map();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = dbToGain(opts.musicDb ?? 0);
    // gentle glue on the music bus (not a loudness maximiser)
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -20;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 1.8;
    this.glue.attack.value = 0.04;
    this.glue.release.value = 0.5;
    // a low cut on the whole bus: nothing useful below 30 Hz
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 30;
    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(opts.masterDb ?? 0);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.musicBus.connect(this.hp);
    this.glueIn = opts.glue === false ? this.master : this.glue;
    this.hp.connect(this.glueIn);
    if (opts.glue !== false) this.glue.connect(this.master);
    this.master.connect(opts.limiter === false ? out : this.limiter);
    if (opts.limiter !== false) this.limiter.connect(out);
    this.reverbs = new Map();
  }

  /** A gentle high shelf on the music bus ("air"), dB at 7 kHz and above. */
  air(db = 2) {
    if (!this.airShelf) {
      this.airShelf = this.ctx.createBiquadFilter();
      this.airShelf.type = 'highshelf';
      this.airShelf.frequency.value = 7000;
      this.hp.disconnect();
      this.hp.connect(this.airShelf);
      this.airShelf.connect(this.glueIn);
    }
    this.airShelf.gain.value = db;
  }

  /** A convolution reverb return. Several may exist (one per era); channels choose by name. */
  addReverb(name, preset, wetDb = 0) {
    if (this.opts.noReverb) {
      // benchmark variant: a plain gain where the convolver would be
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.reverbs.set(name, { input: g, wet: g });
      return g;
    }
    const conv = this.ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = makeIR(this.ctx, typeof preset === 'string' ? IR_PRESETS[preset] : preset);
    const wet = this.ctx.createGain();
    wet.gain.value = dbToGain(wetDb);
    conv.connect(wet);
    wet.connect(this.musicBus);
    this.reverbs.set(name, { input: conv, wet });
    return conv;
  }

  /**
   * A channel: input gain (trim) -> optional inserts -> pan -> dry + reverb send.
   * opts: { trimDb, pan, sendDb, reverb, inserts: [AudioNode-like {input, output}] }
   */
  channel(name, opts = {}) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = dbToGain(opts.trimDb ?? 0);
    let head = input;
    // channel EQ: [{type: 'peaking'|'highshelf'|'lowshelf'|'highpass'|'lowpass', f, q, gain}]
    for (const b of opts.eq ?? []) {
      const f = ctx.createBiquadFilter();
      f.type = b.type ?? 'peaking';
      f.frequency.value = b.f;
      if (b.q != null) f.Q.value = b.q;
      if (b.gain != null) f.gain.value = b.gain;
      head.connect(f);
      head = f;
    }
    for (const fx of opts.inserts ?? []) {
      head.connect(fx.input);
      head = fx.output;
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    head.connect(pan);
    const dry = ctx.createGain();
    dry.gain.value = dbToGain(opts.dryDb ?? 0);
    pan.connect(dry);
    dry.connect(opts.bus ?? this.musicBus);
    const send = ctx.createGain();
    send.gain.value = opts.sendDb == null ? 0 : dbToGain(opts.sendDb);
    pan.connect(send);
    const rv = this.reverbs.get(opts.reverb ?? [...this.reverbs.keys()][0]);
    if (rv) send.connect(rv.input);
    const ch = { name, input, pan, dry, send, fader: input };
    this.channels.set(name, ch);
    return ch;
  }
}

// ---------- inserts ----------

/** Vibraphone motor / organ tremolo: amplitude modulation by a sine LFO. depth 0..1. */
export function tremolo(ctx, rate = 5, depth = 0.35) {
  const g = ctx.createGain();
  g.gain.value = 1 - depth / 2;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amt = ctx.createGain();
  amt.gain.value = depth / 2;
  lfo.connect(amt);
  amt.connect(g.gain);
  lfo.start();
  return { input: g, output: g, lfo, depth: amt };
}

/**
 * Tape: wow and flutter (a modulated short delay), soft saturation and the bandwidth of a 1960s
 * 1/4" machine. All pitch wobble comes from the delay-time modulation, as on a real transport.
 */
export function tape(ctx, p = {}) {
  const { wowHz = 0.55, wowMs = 0.9, flutterHz = 7.3, flutterMs = 0.09, drive = 1.6, lowpass = 11000, highpass = 45 } = p;
  const input = ctx.createGain();
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.012;
  const wow = ctx.createOscillator();
  wow.frequency.value = wowHz;
  const wowAmt = ctx.createGain();
  wowAmt.gain.value = wowMs / 1000;
  wow.connect(wowAmt);
  wowAmt.connect(delay.delayTime);
  const flut = ctx.createOscillator();
  flut.frequency.value = flutterHz;
  const flutAmt = ctx.createGain();
  flutAmt.gain.value = flutterMs / 1000;
  flut.connect(flutAmt);
  flutAmt.connect(delay.delayTime);
  wow.start();
  flut.start();
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve(drive);
  shaper.oversample = '2x';
  const pre = ctx.createGain();
  pre.gain.value = 0.7;
  const post = ctx.createGain();
  post.gain.value = Math.tanh(drive) / (0.7 * drive); // unity small-signal gain through pre * shaper * post
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lowpass;
  lp.Q.value = 0.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  input.connect(delay);
  delay.connect(pre);
  pre.connect(shaper);
  shaper.connect(post);
  post.connect(lp);
  lp.connect(hp);
  return { input, output: hp };
}

export function saturationCurve(drive = 1.5, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

/**
 * Tape echo / time-lag accumulator (Riley, early 1960s): a long delay with feedback through tape
 * bandwidth and a little wow, so each repeat is slightly darker and wobblier than the last.
 * Returns {input, output, setFeedback(t, v)}; output carries only the echoes.
 */
export function tapeEcho(ctx, p = {}) {
  const { time = 3.0, feedback = 0.55, lowpass = 3800, highpass = 160, wowMs = 1.6, wowHz = 0.35 } = p;
  const input = ctx.createGain();
  const delay = ctx.createDelay(Math.max(1, time + 0.5));
  delay.delayTime.value = time;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lowpass;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const sat = ctx.createWaveShaper();
  sat.curve = saturationCurve(1.2);
  const wow = ctx.createOscillator();
  wow.frequency.value = wowHz;
  const wa = ctx.createGain();
  wa.gain.value = wowMs / 1000;
  wow.connect(wa);
  wa.connect(delay.delayTime);
  wow.start();
  input.connect(delay);
  delay.connect(lp);
  lp.connect(hp);
  hp.connect(sat);
  sat.connect(fb);
  fb.connect(delay);
  const output = ctx.createGain();
  sat.connect(output);
  return {
    input,
    output,
    feedback: fb.gain,
    delay,
  };
}

/** A looping noise bed (tape hiss, room tone). Band-limited pink-ish noise, generated. */
export function noiseBed(ctx, p = {}) {
  const { seconds = 6, seed = 7, lowpass = 9000, highpass = 1500, gainDb = -60 } = p;
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const r = makeRng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    // Voss-ish pink approximation via three one-pole sums
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = r.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // crossfade the loop seam
    const xf = Math.floor(0.25 * sr);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      d[i] = d[i] * a + d[n - xf + i] * (1 - a);
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = (n - Math.floor(0.25 * sr)) / sr;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = lowpass;
  const g = ctx.createGain();
  g.gain.value = dbToGain(gainDb);
  src.connect(hp);
  hp.connect(lp);
  lp.connect(g);
  return { src, output: g, gain: g.gain };
}
