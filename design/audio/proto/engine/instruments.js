// Instruments: a multi-sample player and a few synthesised voices.
// Each play() creates short-lived nodes that disconnect themselves when done.

import { dbToGain } from './mixer.js';
import { midiToHz } from './theory.js';

/** Velocity (0..1) to gain: a 28 dB range, so pp sits about 20 dB under ff. */
export const velGain = (v) => dbToGain(-28 * (1 - Math.max(0, Math.min(1, v))));

/** Fetch and decode one instrument pack (manifest entry from prep_samples.py). */
export async function loadSampler(ctx, name, def, baseUrl) {
  const buffers = new Map();
  await Promise.all(
    def.zones.map(async (z) => {
      const res = await fetch(`${baseUrl}/${z.file}`);
      if (!res.ok) throw new Error(`${z.file}: ${res.status}`);
      buffers.set(z.file, await ctx.decodeAudioData(await res.arrayBuffer()));
    }),
  );
  return new Sampler(ctx, name, def, buffers);
}

export class Sampler {
  constructor(ctx, name, def, buffers) {
    this.ctx = ctx;
    this.name = name;
    this.def = def;
    this.buffers = buffers;
    this.layers = [];
    for (const z of def.zones) (this.layers[z.layer] ??= []).push(z);
    for (const l of this.layers) l.sort((a, b) => a.root - b.root);
    this.out = null; // set by connect()
    this.active = 0;
    // a pack attenuated to keep its files below full scale says by how much; restore it here
    this.makeup = dbToGain(def.makeup_db ?? 0);
    this.defaults = {
      attack: def.kind === 'sustain' ? 0.25 : 0,
      release: def.kind === 'sustain' ? 0.9 : 0.35,
    };
  }

  connect(channel) {
    this.out = channel.input;
    return this;
  }

  zoneFor(layer, midi) {
    const zs = this.layers[Math.min(layer, this.layers.length - 1)];
    let best = zs[0];
    let bd = Infinity;
    for (const z of zs) {
      // prefer shifting a sample down over shifting it up by the same amount (brighter, more natural)
      const d = Math.abs(z.root - midi) + (z.root < midi ? 0.25 : 0);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  /**
   * Play a note. t: start (context time). dur: held length (s). opts: attack, release, gainDb,
   * rate (tape speed multiplier: transposes like tape), offset (s into the sample), layer (force).
   */
  play(t, midi, vel, dur, opts = {}) {
    const L = this.layers.length;
    const g = velGain(vel) * dbToGain(opts.gainDb ?? 0) * this.makeup;
    if (L === 1 || opts.layer != null) {
      this._voice(t, midi, g, dur, opts.layer ?? 0, opts);
      return;
    }
    // equal-power crossfade between the two nearest velocity layers
    const p = Math.max(0, Math.min(1, vel)) ** 0.9 * (L - 1);
    const lo = Math.floor(p);
    const hi = Math.min(L - 1, lo + 1);
    const f = p - lo;
    if (hi === lo || f < 0.08) this._voice(t, midi, g, dur, lo, opts);
    else if (f > 0.92) this._voice(t, midi, g, dur, hi, opts);
    else {
      this._voice(t, midi, g * Math.cos((f * Math.PI) / 2), dur, lo, opts);
      this._voice(t, midi, g * Math.sin((f * Math.PI) / 2), dur, hi, opts);
    }
  }

  _voice(t, midi, gain, dur, layer, opts) {
    const z = this.zoneFor(layer, midi);
    const buf = this.buffers.get(z.file);
    const rate = 2 ** ((midi - z.root) / 12) * (opts.rate ?? 1);
    const attack = opts.attack ?? this.defaults.attack;
    const release = opts.release ?? this.defaults.release;
    const usable = (buf.duration - (opts.offset ?? 0)) / rate; // seconds of output the sample can supply
    if (this.def.kind === 'sustain' && dur + release > usable - 0.2) {
      this._sustained(t, z, buf, rate, gain, dur, attack, release, usable, opts);
      return;
    }
    this._segment(t, buf, rate, gain, attack, Math.min(dur, usable - 0.05), release, opts.offset ?? 0, true);
  }

  /** Long notes on bowed and blown instruments: overlapping segments with crossfades (a bow change). */
  _sustained(t, z, buf, rate, gain, dur, attack, release, usable, opts) {
    const xf = 1.6; // crossfade between segments
    const skip = 0.45; // later segments start past the attack transient
    const segOut = (buf.duration - skip) / rate; // output seconds per later segment
    let start = t;
    let first = true;
    const end = t + dur;
    while (true) {
      const avail = first ? usable : segOut;
      const segEnd = start + avail - 0.15;
      if (segEnd >= end + 0.05 || avail < xf * 2) {
        this._segment(start, buf, rate, gain, first ? attack : xf, end - start, release, first ? opts.offset ?? 0 : skip, first);
        return;
      }
      const holdEnd = segEnd - xf;
      this._segment(start, buf, rate, gain, first ? attack : xf, holdEnd - start, xf * 0.45, first ? opts.offset ?? 0 : skip, first);
      start = holdEnd;
      first = false;
    }
  }

  _segment(t, buf, rate, gain, attack, hold, release, offset, linearAttack) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    if (attack > 0.004) {
      g.gain.setValueAtTime(0, t);
      if (linearAttack) g.gain.linearRampToValueAtTime(gain, t + attack);
      else g.gain.setTargetAtTime(gain, t, attack / 3);
    } else g.gain.setValueAtTime(gain, t);
    const off = t + Math.max(hold, attack + 0.01);
    g.gain.setTargetAtTime(0, off, release / 4.5);
    src.connect(g);
    g.connect(this.out);
    src.start(t, offset);
    src.stop(off + release * 1.3);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
    };
  }
}

// ---------- synthesised voices ----------

/** Additive organ (drawbar footages as harmonic amplitudes) as a PeriodicWave. */
export function organWave(ctx, drawbars = { 1: 1, 2: 0.5, 3: 0.12, 4: 0.18, 6: 0.05, 8: 0.06 }) {
  const n = 17;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (const [h, a] of Object.entries(drawbars)) imag[Number(h)] = a;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export class Synth {
  /** kind: 'sine' | 'organ' | 'bell' | 'fm' */
  constructor(ctx, kind, opts = {}) {
    this.ctx = ctx;
    this.kind = kind;
    this.opts = opts;
    this.out = null;
    if (kind === 'organ') this.wave = organWave(ctx, opts.drawbars);
  }

  connect(channel) {
    this.out = channel.input;
    return this;
  }

  play(t, midi, vel, dur, o = {}) {
    const ctx = this.ctx;
    const f = midiToHz(midi) * (o.rate ?? 1);
    const g = ctx.createGain();
    const peak = velGain(vel) * dbToGain(o.gainDb ?? 0);
    g.connect(this.out);
    const nodes = [g];
    const end = (stopAt) => {
      const last = nodes[1];
      if (last)
        last.onended = () => {
          for (const n of nodes) n.disconnect();
        };
      for (const n of nodes) if (n.stop) n.stop(stopAt);
    };
    if (this.kind === 'sine' || this.kind === 'organ') {
      const osc = ctx.createOscillator();
      if (this.kind === 'organ') osc.setPeriodicWave(this.wave);
      osc.frequency.value = f;
      if (o.detuneCents) osc.detune.value = o.detuneCents;
      const atk = o.attack ?? (this.kind === 'sine' ? 0.06 : 0.03);
      const rel = o.release ?? (this.kind === 'sine' ? 0.8 : 0.25);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + atk);
      if (o.decay) g.gain.setTargetAtTime(peak * (o.sustainLevel ?? 0.0), t + atk, o.decay / 4);
      g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 4.5);
      osc.connect(g);
      nodes.push(osc);
      osc.start(t);
      end(t + Math.max(dur, atk) + rel * 1.3);
      return;
    }
    if (this.kind === 'bell') {
      // Risset's additive bell (1969 catalogue): inharmonic partials, durations falling with frequency.
      // [frequency ratio, amplitude, relative duration, offset in Hz (the beating pairs)]
      const parts = [
        [0.56, 1.0, 1.0],
        [0.56, 0.67, 0.9, 1],
        [0.92, 1.0, 0.65],
        [0.92, 1.8, 0.55, 1.7],
        [1.19, 2.67, 0.325],
        [1.7, 1.67, 0.35],
        [2.0, 1.46, 0.25],
        [2.74, 1.33, 0.2],
        [3.0, 1.33, 0.15],
        [3.76, 1.0, 0.1],
        [4.07, 1.33, 0.075],
      ];
      const T = dur; // total decay of the fundamental group
      const sum = parts.reduce((s, p) => s + p[1], 0);
      for (const [ratio, amp, life, hz = 0] of parts) {
        const osc = ctx.createOscillator();
        osc.frequency.value = (f / 0.56) * ratio + hz; // the hum (0.56) sounds at the nominal pitch
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0, t);
        pg.gain.linearRampToValueAtTime((peak * amp) / sum, t + 0.004);
        pg.gain.setTargetAtTime(0, t + 0.004, (T * life) / 6.9);
        osc.connect(pg);
        pg.connect(g);
        osc.start(t);
        osc.stop(t + T * life + 0.1);
        osc.onended = () => {
          osc.disconnect();
          pg.disconnect();
        };
      }
      g.gain.value = 1;
      whenDone(ctx, g, t + T + 0.5, () => g.disconnect());
      return;
    }
    if (this.kind === 'fm') {
      // Two-operator FM (Chowning 1973): carrier c, modulator m = ratio * c, index decays (bright -> mellow).
      const ratio = o.ratio ?? this.opts.ratio ?? 3.5;
      const index = (o.index ?? this.opts.index ?? 2.2) * (0.5 + vel);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f * ratio;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(index * f * ratio, t);
      mg.gain.setTargetAtTime(index * f * ratio * 0.08, t, (o.indexDecay ?? this.opts.indexDecay ?? 0.35) / 2);
      mod.connect(mg);
      mg.connect(car.frequency);
      const decay = o.decay ?? this.opts.decay ?? 2.5;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + (o.attack ?? 0.003));
      g.gain.setTargetAtTime(0, t + 0.003, decay / 5);
      g.gain.setTargetAtTime(0, t + Math.max(dur, 0.01), (o.release ?? 0.3) / 4.5);
      car.connect(g);
      nodes.push(car, mod, mg);
      car.start(t);
      mod.start(t);
      end(t + Math.min(dur + (o.release ?? 0.3) * 1.3, decay * 1.6));
    }
  }
}

/** Run fn at context time `when`, in realtime and offline contexts alike: a silent source's onended.
 *  The source is connected (offset 0, so it adds nothing) because unconnected nodes may not be pulled. */
export function whenDone(ctx, node, when, fn) {
  const s = ctx.createConstantSource();
  s.offset.value = 0;
  s.connect(node);
  s.onended = () => {
    s.disconnect();
    fn();
  };
  s.start(when);
  s.stop(when + 0.01);
}
