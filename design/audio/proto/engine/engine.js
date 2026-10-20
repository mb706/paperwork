// The music engine: instruments + mixer + clock + the current piece.
// A piece is a rule set (pieces/*.js) that turns (seed, game state) into note events.

import { Clock } from './clock.js';
import { loadSampler, Sampler, Synth } from './instruments.js';
import { dbToGain, Mixer, noiseBed, tape, tapeEcho, tremolo } from './mixer.js';

export class MusicEngine {
  /**
   * ctx: AudioContext or OfflineAudioContext. manifest: instruments.json. baseUrl: where the packs live.
   * opts.mute: set of channel names to silence (stem renders).
   */
  constructor(ctx, { manifest, baseUrl, out, mixer = {}, mute = null, solo = null } = {}) {
    this.ctx = ctx;
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.mixer = new Mixer(ctx, out ?? ctx.destination, mixer);
    this.clock = new Clock(ctx);
    this.inst = new Map(); // name -> Sampler | Synth
    this.channels = new Map();
    this.log = []; // every note: for symbolic analysis of renders
    this.mute = mute;
    this.solo = solo;
    this.state = { activity: 0.5, doublingTime: null, night: 0 };
    this.fx = {};
  }

  async loadSamplers(names) {
    await Promise.all(
      names
        .filter((n) => !this.inst.has(n))
        .map(async (n) => {
          const def = this.manifest[n];
          if (!def) throw new Error(`no instrument ${n}`);
          this.inst.set(n, await loadSampler(this.ctx, n, def, this.baseUrl));
        }),
    );
  }

  synth(name, kind, opts) {
    this.inst.set(name, new Synth(this.ctx, kind, opts));
  }

  /** A second player of an already loaded sample pack (shares the decoded buffers), for its own channel. */
  alias(name, src) {
    const s = this.inst.get(src);
    this.inst.set(name, new Sampler(this.ctx, name, s.def, s.buffers));
  }

  /** Route an instrument to a new channel. insert names: 'tape', 'tremolo'. */
  route(instName, chOpts = {}) {
    const inserts = [];
    for (const ins of chOpts.inserts ?? []) {
      if (ins === 'tape') inserts.push(tape(this.ctx, chOpts.tape));
      else if (ins === 'tremolo') inserts.push(tremolo(this.ctx, chOpts.tremoloHz ?? 5.2, chOpts.tremoloDepth ?? 0.3));
      else inserts.push(ins);
    }
    const name = chOpts.channel ?? instName;
    const silenced = (this.mute && this.mute.has(name)) || (this.solo && !this.solo.has(name));
    let ch = this.channels.get(name);
    if (!ch) {
      ch = this.mixer.channel(name, { ...chOpts, inserts });
      if (silenced) {
        ch.dry.gain.value = 0;
        ch.send.gain.value = 0;
      }
      this.channels.set(name, ch);
    }
    this.inst.get(instName).connect(ch);
    return ch;
  }

  /**
   * A tape echo (Riley's time-lag accumulator) fed from a channel (post-pan), returning on a channel
   * of its own so it has its own level, pan and reverb send. Returns the echo.
   */
  echo(fromChannel, toChannel, p, chOpts = {}) {
    const e = tapeEcho(this.ctx, p);
    this.channels.get(fromChannel).pan.connect(e.input);
    const silenced = (this.mute && this.mute.has(toChannel)) || (this.solo && !this.solo.has(toChannel));
    const ch = this.mixer.channel(toChannel, chOpts);
    if (silenced) {
      ch.dry.gain.value = 0;
      ch.send.gain.value = 0;
    }
    this.channels.set(toChannel, ch);
    e.output.connect(ch.input);
    return e;
  }

  /** A looping noise bed (tape hiss) on a channel of its own. Starts at time t. */
  noise(channelName, p, chOpts = {}, t = 0) {
    const n = noiseBed(this.ctx, p);
    const ch = this.channels.get(channelName) ?? this.mixer.channel(channelName, chOpts);
    this.channels.set(channelName, ch);
    n.output.connect(ch.input);
    n.src.start(t);
    return n;
  }

  play(ev) {
    const inst = this.inst.get(ev.inst);
    if (!inst) throw new Error(`unknown instrument ${ev.inst}`);
    // a note due in the past (a main-thread stall, or a piece joined in the middle): up to 50 ms late
    // it plays at once; later than that it is dropped and counted, never scheduled in the past
    const now = this.ctx.currentTime;
    if (ev.t < now - 0.05) {
      this.dropped = (this.dropped ?? 0) + 1;
      return;
    }
    if (ev.t < now) ev = { ...ev, t: now };
    inst.play(ev.t, ev.midi, ev.vel, ev.dur, ev.opts ?? {});
    // log the sounding pitch: a tape rate transposes (rate 0.5 = an octave down)
    const m = ev.midi + (ev.opts?.rate ? 12 * Math.log2(ev.opts.rate) : 0);
    this.log.push({ t: +ev.t.toFixed(4), i: ev.inst, m: +m.toFixed(3), v: +ev.vel.toFixed(3), d: +ev.dur.toFixed(3) });
  }

  /** Smoothly set a channel's fader (dB) at time t over tau seconds. */
  fade(channelName, t, db, tau = 1) {
    const ch = this.channels.get(channelName);
    ch.fader.gain.setTargetAtTime(dbToGain(db), t, tau / 3);
  }
}

/** Small helpers shared by pieces. */
export const human = (rng, sd) => rng.gauss() * sd; // timing or velocity jitter
