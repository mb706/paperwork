// Instruments: how a note becomes voices of the bank (A4 `engine/instruments.js`, ported; 10 §9.4). The
// sampler chooses the zone and the velocity layers and re-bows long notes on sustained instruments; the
// synths are the bank's oscillators. The bank then plays each voice with sample-accurate envelopes.
import { dbToGain, midiToHz, velGain } from '../core/units.ts';
import type { NoteOpts } from './types.ts';

/** One voice for the bank, in context seconds. */
export interface VoiceSpec {
  t: number;
  /** Bank buffer id (samples) or wavetable id (organ); −1 for sine and bell. */
  src: number;
  kind: 'sample' | 'sine' | 'organ' | 'bell';
  /** Samples: playback-rate ratio. Oscillators: frequency (Hz). */
  rate: number;
  gain: number;
  attack: number;
  /** The attack approaches the gain exponentially (re-bowed segments) instead of ramping linearly. */
  atkExp: boolean;
  /** Release start. */
  off: number;
  release: number;
  stop: number;
  /** Seconds into the sample. */
  offset: number;
  /** The bell's decay length. */
  aux: number;
}

export interface LoadedZone {
  /** The bank buffer id. */
  id: number;
  /** Fractional MIDI pitch, measured (A4 `prep_samples.py`). */
  root: number;
  layer: number;
  /** Length in seconds. */
  seconds: number;
}

export interface LoadedPack {
  kind: 'oneshot' | 'sustain';
  layers: number;
  makeupDb: number;
  zones: LoadedZone[];
}

export type VoiceSink = (v: VoiceSpec) => void;

export class Sampler {
  private readonly layers: LoadedZone[][] = [];
  private readonly makeup: number;
  private readonly defaults: { attack: number; release: number };

  /** xfade: velocity-layer crossfades (off for fast percussive parts, A4 §6.5 #2). */
  readonly pack: LoadedPack;
  private readonly xfade: boolean;
  constructor(pack: LoadedPack, xfade: boolean) {
    this.pack = pack;
    this.xfade = xfade;
    for (const z of pack.zones) {
      let l = this.layers[z.layer];
      if (!l) {
        l = [];
        this.layers[z.layer] = l;
      }
      l.push(z);
    }
    for (const l of this.layers) l.sort((a, b) => a.root - b.root);
    // a pack attenuated to keep its files below full scale says by how much; it is restored here
    this.makeup = dbToGain(pack.makeupDb);
    this.defaults = {
      attack: pack.kind === 'sustain' ? 0.25 : 0,
      release: pack.kind === 'sustain' ? 0.9 : 0.35,
    };
  }

  /** The nearest root, preferring to shift a sample down over shifting it up by the same amount. */
  zoneFor(layer: number, midi: number): LoadedZone {
    const zs = this.layers[Math.min(layer, this.layers.length - 1)] as LoadedZone[];
    let best = zs[0] as LoadedZone;
    let bd = Number.POSITIVE_INFINITY;
    for (const z of zs) {
      const d = Math.abs(z.root - midi) + (z.root < midi ? 0.25 : 0);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  /** A note: one voice, or an equal-power crossfade between the two nearest velocity layers. */
  play(t: number, midi: number, vel: number, dur: number, opts: NoteOpts, out: VoiceSink): void {
    const L = this.layers.length;
    const g = velGain(vel) * dbToGain(opts.gainDb ?? 0) * this.makeup;
    const p = Math.max(0, Math.min(1, vel)) ** 0.9 * (L - 1);
    if (L === 1 || opts.layer != null) {
      this.voice(t, midi, g, dur, opts.layer ?? 0, opts, out);
      return;
    }
    // A4 §6.5 #2: one voice per note for notes shorter than 0.5 s and for fast percussive parts
    if (!this.xfade || dur < 0.5) {
      this.voice(t, midi, g, dur, Math.min(L - 1, Math.round(p)), opts, out);
      return;
    }
    const lo = Math.floor(p);
    const hi = Math.min(L - 1, lo + 1);
    const f = p - lo;
    if (hi === lo || f < 0.08) this.voice(t, midi, g, dur, lo, opts, out);
    else if (f > 0.92) this.voice(t, midi, g, dur, hi, opts, out);
    else {
      this.voice(t, midi, g * Math.cos((f * Math.PI) / 2), dur, lo, opts, out);
      this.voice(t, midi, g * Math.sin((f * Math.PI) / 2), dur, hi, opts, out);
    }
  }

  private voice(
    t: number,
    midi: number,
    gain: number,
    dur: number,
    layer: number,
    opts: NoteOpts,
    out: VoiceSink,
  ): void {
    const z = this.zoneFor(layer, midi);
    const rate = 2 ** ((midi - z.root) / 12) * (opts.rate ?? 1);
    const attack = opts.attack ?? this.defaults.attack;
    const release = opts.release ?? this.defaults.release;
    const offset = opts.offset ?? 0;
    const usable = (z.seconds - offset) / rate; // seconds of output the sample can supply
    if (this.pack.kind === 'sustain' && dur + release > usable - 0.2) {
      this.sustained(t, z, rate, gain, dur, attack, release, usable, offset, out);
      return;
    }
    this.segment(t, z, rate, gain, attack, Math.min(dur, usable - 0.05), release, offset, true, out);
  }

  /** Long notes on bowed and blown instruments: overlapping segments with crossfades (a bow change). */
  private sustained(
    t: number,
    z: LoadedZone,
    rate: number,
    gain: number,
    dur: number,
    attack: number,
    release: number,
    usable: number,
    offset: number,
    out: VoiceSink,
  ): void {
    const xf = 1.6; // crossfade between segments
    const skip = 0.45; // later segments start past the attack transient
    const segOut = (z.seconds - skip) / rate; // output seconds per later segment
    let start = t;
    let first = true;
    const end = t + dur;
    for (;;) {
      const avail = first ? usable : segOut;
      const segEnd = start + avail - 0.15;
      if (segEnd >= end + 0.05 || avail < xf * 2) {
        this.segment(
          start,
          z,
          rate,
          gain,
          first ? attack : xf,
          end - start,
          release,
          first ? offset : skip,
          first,
          out,
        );
        return;
      }
      const holdEnd = segEnd - xf;
      this.segment(
        start,
        z,
        rate,
        gain,
        first ? attack : xf,
        holdEnd - start,
        xf * 0.45,
        first ? offset : skip,
        first,
        out,
      );
      start = holdEnd;
      first = false;
    }
  }

  private segment(
    t: number,
    z: LoadedZone,
    rate: number,
    gain: number,
    attack: number,
    hold: number,
    release: number,
    offset: number,
    linearAttack: boolean,
    out: VoiceSink,
  ): void {
    const off = t + Math.max(hold, attack + 0.01);
    out({
      t,
      src: z.id,
      kind: 'sample',
      rate,
      gain,
      attack: attack > 0.004 ? attack : 0,
      atkExp: !linearAttack,
      off,
      release,
      stop: off + release * 1.3,
      offset,
      aux: 0,
    });
  }
}

/** The synthesised voices: sine, drawbar organ (a wavetable), Risset's bell (A4 `Synth`). */
export class Synth {
  readonly kind: 'sine' | 'organ' | 'bell';
  /** The organ's wavetable id in the bank. */
  readonly wave: number;
  constructor(kind: 'sine' | 'organ' | 'bell', wave = -1) {
    this.kind = kind;
    this.wave = wave;
  }

  play(t: number, midi: number, vel: number, dur: number, o: NoteOpts, out: VoiceSink): void {
    const f = midiToHz(midi) * (o.rate ?? 1);
    const peak = velGain(vel) * dbToGain(o.gainDb ?? 0);
    if (this.kind === 'bell') {
      // the partials decay from t + 4 ms with τ = T · life / 6.9; the voice lasts T + 0.1 s
      out({
        t,
        src: -1,
        kind: 'bell',
        rate: f,
        gain: peak,
        attack: 0.004,
        atkExp: false,
        off: 1e9,
        release: 0.35,
        stop: t + dur + 0.1,
        offset: 0,
        aux: dur,
      });
      return;
    }
    const sine = this.kind === 'sine';
    const atk = o.attack ?? (sine ? 0.06 : 0.03);
    const rel = o.release ?? (sine ? 0.8 : 0.25);
    const off = t + Math.max(dur, atk);
    out({
      t,
      src: this.wave,
      kind: this.kind,
      rate: f,
      gain: peak,
      attack: atk,
      atkExp: false,
      off,
      release: rel,
      stop: off + rel * 1.3,
      offset: 0,
      aux: 0,
    });
  }
}

/** Drawbar footages (harmonic: amplitude) as an array indexed by harmonic. */
export function harmonics(drawbars: Readonly<Record<number, number>>): number[] {
  const out = new Array<number>(17).fill(0);
  for (const [h, a] of Object.entries(drawbars)) out[Number(h)] = a;
  return out;
}
