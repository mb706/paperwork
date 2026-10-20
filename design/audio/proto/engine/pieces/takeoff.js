// Era V, "Takeoff" (the System card tier: closure, then Model generation 6-25).
//
// 1. The loop closes (the soundtrack's one unique cue, 08-text §2 rule 8). A tempo canon after
//    Nancarrow (Studies for Player Piano, from 1948): the 1945 motif in five voices, one per era
//    (piano, vibraphone, a 1987 FM synthesizer, sine tones, glockenspiel), at tempo ratios
//    1 : 4/3 : 2 : 3 : 4. Entries are timed so that every voice reaches the final D at the same
//    instant, the canon's convergence point. Nowhere else do all the eras sound together.
// 2. Takeoff. A Risset rhythm (an "eternal accelerando", Risset, 1960s-70s) on the piano: streams of
//    notes at tempi an octave apart, each speeding up and fading in at the bottom and out at the top,
//    so the music accelerates without end. One tempo doubling per research doubling: the doubling
//    period follows the game's doubling-time readout (state.doublingTime), clamped to 3..90 s.
//    Each stream's register rises with its tempo through the harmonic series of D, tuned in 5-limit
//    just intonation (partials 2..30, no 7th, 11th or 13th): the piano leaves equal temperament,
//    and the harmony turns from D minor to the overtone series' D major.
// 3. The end: the cloud stops; after the reverb, one low D on the piano.

import { makeRng } from '../rng.js';

export const TAKEOFF_SAMPLERS = ['piano', 'vibes', 'fmpiano', 'glock', 'violins', 'violas', 'celli', 'bass', 'glass'];

const D1 = 26; // MIDI of D1: the fundamental of the takeoff's harmonic series
const partial = (p) => D1 + 12 * Math.log2(p);
const BANDS = [
  [2, 3],
  [4, 5, 6],
  [8, 9, 10, 12, 15],
  [16, 18, 20, 24, 27, 30],
];

// Channel trims (dB), calibrated from stem loudness: analysis/calibrate.py rewrites this table.
export const TRIMS = {
  piano: 0.4,
  pianoL: -2.7,
  pianoR: -2.6,
  vibes: -2.8,
  fmpiano: -8.9,
  glock: -8.1,
  sine: -20.6,
  violins: -7.3,
  violas: -3.2,
  celli: -4.5,
  bass: -8.3,
  glass: -9.6,
};

export function setupTakeoff(engine) {
  const m = engine.mixer;
  m.addReverb('hall', 'hall', 3);
  m.addReverb('vast', 'vast', 2);
  m.air(2);
  const pianoEq = [{ type: 'peaking', f: 2800, q: 0.8, gain: -3 }];
  engine.route('piano', { reverb: 'hall', sendDb: -8, trimDb: TRIMS.piano, pan: 0, eq: pianoEq });
  engine.alias('pianoL', 'piano');
  engine.alias('pianoR', 'piano');
  engine.route('pianoL', { reverb: 'hall', sendDb: -9, trimDb: TRIMS.pianoL, pan: -0.38, eq: pianoEq });
  engine.route('pianoR', { reverb: 'hall', sendDb: -9, trimDb: TRIMS.pianoR, pan: 0.38, eq: pianoEq });
  engine.route('vibes', { reverb: 'hall', sendDb: -7, trimDb: TRIMS.vibes, pan: 0.3, inserts: ['tremolo'], tremoloHz: 5.4, tremoloDepth: 0.3 });
  engine.route('fmpiano', { reverb: 'hall', sendDb: -8, trimDb: TRIMS.fmpiano, pan: -0.25 });
  engine.route('glock', { reverb: 'hall', sendDb: -5, trimDb: TRIMS.glock, pan: 0.15 });
  engine.synth('sine', 'sine');
  engine.route('sine', { reverb: 'hall', sendDb: -6, trimDb: TRIMS.sine, pan: -0.1 });
  engine.route('violins', { reverb: 'vast', sendDb: -3, trimDb: TRIMS.violins, pan: -0.25, eq: [{ type: 'peaking', f: 3200, q: 0.9, gain: -2 }] });
  engine.route('violas', { reverb: 'vast', sendDb: -3, trimDb: TRIMS.violas, pan: 0.2 });
  engine.route('celli', { reverb: 'vast', sendDb: -4, trimDb: TRIMS.celli, pan: 0.3 });
  engine.route('bass', { reverb: 'vast', sendDb: -6, trimDb: TRIMS.bass, pan: 0.1 });
  engine.route('glass', { reverb: 'vast', sendDb: -2, trimDb: TRIMS.glass, pan: -0.15 });
}

export class TakeoffPiece {
  constructor(engine, p = {}) {
    this.e = engine;
    this.rng = makeRng(p.seed ?? 2024);
    this.T0 = p.start ?? 0;
    this.D = p.duration ?? 150;
    this.events = [];
    this.Tc = p.convergence ?? 15; // the convergence point
    this.ts = p.takeoffStart ?? this.Tc + 6; // first takeoff stream
    this.te = p.cloudEnd ?? this.D - 17; // the cloud stops
    this.K = 4; // tempo octaves in the Risset window
    this.Flo = 0.55; // slowest audible stream, notes per second
    this.phi = 0.4; // doublings so far: the first streams fade in from the bottom of the window
    this.c = 0; // master counter (fastest-beat units)
    this.lastT = this.ts;
    this.nextIdx = new Map(); // stream n -> next note index j
    this.planCanon();
    this.planBed();
    this.planEnd();
    this.events.sort((a, b) => a.t - b.t);
    this.idx = 0;
    this.doublings = [];
  }

  /** The canon: the 1945 motif extended to a full phrase ending on D, in five voices converging. */
  planCanon() {
    const subject = [[69, 1.5], [74, 0.5], [72, 1], [69, 1], [67, 2], [65, 1], [67, 1], [69, 1]]; // then the final D
    const beats = subject.reduce((s, [, d]) => s + d, 0); // 9
    const b0 = 60 / 52;
    const voices = [
      { inst: 'piano', ratio: 1, tr: 0, vel: 0.42 },
      { inst: 'vibes', ratio: 4 / 3, tr: 12, vel: 0.36 },
      { inst: 'fmpiano', ratio: 2, tr: -12, vel: 0.4 },
      { inst: 'sine', ratio: 3, tr: 12, vel: 0.42, opts: { attack: 0.01, release: 0.5, decay: 0.9, sustainLevel: 0.25 } },
      { inst: 'glock', ratio: 4, tr: 24, vel: 0.3 },
    ];
    const r = this.rng.fork('canon');
    for (const v of voices) {
      const beat = b0 / v.ratio;
      let t = this.Tc - beats * beat;
      for (const [m, d] of subject) {
        // the human voice keeps a little rubato; the machine voices are exact
        const jitter = v.ratio === 1 ? r.gauss() * 0.015 : 0;
        this.events.push({ t: t + jitter, inst: v.inst, midi: m + v.tr, vel: v.vel, dur: d * beat * 1.1 + 0.3, opts: v.opts ?? {} });
        t += d * beat;
      }
    }
    // the convergence: every voice on D, the strings arriving with it
    const Tc = this.Tc;
    const tutti = [
      ['piano', 38, 0.5], ['piano', 50, 0.48], ['piano', 57, 0.42], ['piano', 62, 0.46],
      ['vibes', 74, 0.42], ['fmpiano', 50, 0.45], ['sine', 74, 0.45], ['sine', 81.02, 0.3], ['glock', 86, 0.32],
    ];
    for (const [inst, m, v] of tutti) this.events.push({ t: Tc, inst, midi: m, vel: v, dur: inst === 'sine' ? 4 : 7, opts: inst === 'sine' ? { attack: 0.01, release: 3 } : {} });
    // strings crescendo into the convergence (open fifths: the third is withheld)
    for (const [inst, m, v] of [['bass', 38, 0.4], ['celli', 45, 0.42], ['violas', 50, 0.4], ['violins', 57, 0.38], ['violins', 62, 0.4]]) {
      this.events.push({ t: Tc - 6, inst, midi: m, vel: v, dur: 7.5, opts: { attack: 5.5, release: 3.5 } });
    }
  }

  /** A sustained just-intonation chord under the takeoff: the low partials, climbing as it goes. */
  planBed() {
    const t0 = this.ts + 1;
    const t1 = this.te;
    const voicings = [
      // [instrument, partial] sets; each later voicing is higher (the bed rises with the takeoff)
      [['bass', 2], ['celli', 4], ['violas', 6], ['violins', 8], ['violins', 10]],
      [['bass', 2], ['celli', 6], ['violas', 8], ['violins', 10], ['violins', 12], ['glass', 16]],
      [['celli', 8], ['violas', 10], ['violins', 12], ['violins', 16], ['glass', 20], ['glass', 24]],
    ];
    const seg = (t1 - t0) / voicings.length;
    voicings.forEach((vs, i) => {
      const a = t0 + i * seg;
      for (const [inst, p] of vs) {
        const dyn = [0.22, 0.32, 0.45][i];
        this.events.push({ t: a + (inst === 'glass' ? 1.5 : 0), inst, midi: partial(p), vel: dyn, dur: seg + 1.5, opts: { attack: i === 0 ? 8 : 4, release: i === voicings.length - 1 ? 2.2 : 4 } });
      }
    });
  }

  planEnd() {
    // after the cloud and the reverb: one low D, soft
    const t = this.te + 4.5;
    this.events.push({ t, inst: 'piano', midi: 38, vel: 0.36, dur: 9, opts: {} });
    this.events.push({ t: t + 0.03, inst: 'piano', midi: 50, vel: 0.3, dur: 9, opts: {} });
  }

  /** Doubling period (s): from the game's doubling time, clamped to what the ear can follow. */
  period() {
    const td = this.e.state.doublingTime ?? 30;
    return Math.max(3, Math.min(90, td));
  }

  amp(u) {
    return u <= 0 || u >= this.K ? 0 : Math.sin((Math.PI * u) / this.K) ** 2;
  }

  scheduleRisset(t0, t1) {
    if (t1 <= this.ts) return;
    const e = this.e;
    const dt = 0.002;
    let t = Math.max(this.lastT, this.ts);
    const end = Math.min(t1, this.te);
    while (t < end) {
      const P = this.period();
      const phiPrev = this.phi;
      const cPrev = this.c;
      this.phi += dt / P;
      // the window's base rate rises 1.5x over the takeoff: the texture thickens as it accelerates
      const prog = Math.max(0, Math.min(1, (t - this.ts) / (this.te - this.ts)));
      this.c += dt * this.Flo * (1 + 0.5 * prog) * 2 ** this.phi;
      if (Math.floor(this.phi) > Math.floor(phiPrev)) this.doublings.push(+t.toFixed(2));
      // visible streams: u = phi - n in (0, K)
      const nHi = Math.floor(this.phi);
      const nLo = Math.ceil(this.phi - this.K);
      for (let n = nLo; n <= nHi; n++) {
        const step = 2 ** n;
        const jNext = this.nextIdx.get(n) ?? Math.ceil(cPrev / step);
        if (jNext * step > this.c) {
          this.nextIdx.set(n, jNext);
          continue;
        }
        // a note of stream n at the crossing (linear within dt)
        const frac = (jNext * step - cPrev) / (this.c - cPrev);
        const tn = t + frac * dt;
        this.nextIdx.set(n, jNext + 1);
        const u = this.phi - n;
        const a = this.amp(u);
        if (a < 0.06) continue;
        const band = BANDS[Math.min(BANDS.length - 1, Math.max(0, Math.floor(u)))];
        // rising arpeggio through the band's partials, offset per stream
        const p = band[(((jNext + n * 2) % band.length) + band.length) % band.length];
        const rate = this.Flo * 2 ** u; // this stream's notes per second
        // a crescendo across the takeoff, and a ten-second fade-in at its start
        const grow = (0.62 + 0.5 * prog) * Math.min(1, (tn - this.ts) / 10 + 0.15);
        const vel = (0.18 + 0.3 * a) * grow * (jNext % 4 === 0 ? 1.08 : 0.94);
        const dur = Math.min(2.6, 2.8 / rate);
        e.play({ t: this.T0 + tn, inst: n % 2 === 0 ? 'pianoL' : 'pianoR', midi: partial(p), vel, dur, opts: { release: 0.5 } });
        // late in the takeoff the fastest streams are doubled two octaves up: a shimmer above the piano
        if (prog > 0.6 && u > 2.4 && partial(p) + 24 <= 108) {
          e.play({ t: this.T0 + tn, inst: 'glock', midi: partial(p) + 24, vel: vel * 0.55 * Math.min(1, (prog - 0.6) / 0.2), dur: 1.2, opts: {} });
        }
      }
      t += dt;
    }
    this.lastT = t;
  }

  schedule(t0abs, t1abs) {
    const t0 = t0abs - this.T0;
    const t1 = t1abs - this.T0;
    while (this.idx < this.events.length && this.events[this.idx].t < t1) {
      const ev = this.events[this.idx++];
      if (ev.t >= t0 - 0.05) this.e.play({ ...ev, t: this.T0 + Math.max(ev.t, t0) });
    }
    this.scheduleRisset(t0, t1);
  }

  report() {
    return { doublings: this.doublings, phi: this.phi };
  }

  done(now) {
    return now - this.T0 > this.D + 8;
  }
}
