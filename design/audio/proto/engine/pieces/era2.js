// Era II, "Tape and oscillators" (the Report tier; Literature 1957-1975).
// The sound of a computing centre at night: tape loops, sine tones, an electric organ, vibraphone.
//
// Process (rules, no fixed score):
// - Additive entry (Glass, Music in Fifths, 1969): a marimba loop starts with three notes of its
//   pattern and gains one per cycle.
// - Tape phasing (Reich, It's Gonna Rain, 1965; Come Out, 1966): a second copy of the loop runs
//   0.4% fast, so it drifts a pulse ahead every ~45 s and, being tape, 7 cents sharp.
// - A just-intonation sine drone (the fifth is 3:2, as in La Monte Young's drones) under a fixed
//   pentatonic field; the drone alone moves the harmony: A, then F (bVI), G (bVII), A.
// - Organ modules repeated In C-fashion (Riley, 1964) into a tape time-lag accumulator (a long
//   echo with feedback), which stacks them into canons.
// - Vibraphone chords with the motor on; two Risset bells (additive synthesis, 1969).
// - The Era I motif returns as a tape recording played at half speed (an octave down, slower).
// - Subtractive exit: the loops lose one note per cycle until they are gone.
// Activity (0..1) decides whether the second loop (the phasing) runs at all.

import { makeRng } from '../rng.js';
import { consonantSet, justAbove, mod12, notesIn, pentatonic, voiceChord } from '../theory.js';

export const ERA2_SAMPLERS = ['marimba', 'vibes', 'piano'];

// Channel trims (dB), calibrated from stem loudness: analysis/calibrate.py rewrites this table.
export const TRIMS = {
  marimbaA: -9.4,
  marimbaB: -9.2,
  vibes: -1.5,
  piano: 5.8,
  organ: -14.1,
  echo: -7.1,
  drone: -26.8,
  bell: -1.3,
  hiss: 0.0,
};

export function setupEra2(engine) {
  const m = engine.mixer;
  m.addReverb('plate', 'plate', 4);
  m.air(4.5);
  engine.alias('marimbaB', 'marimba');
  engine.route('marimba', { channel: 'marimbaA', reverb: 'plate', sendDb: -11, trimDb: TRIMS.marimbaA, pan: -0.42, inserts: ['tape'], tape: { wowMs: 0.35, flutterMs: 0.04 } });
  engine.route('marimbaB', { reverb: 'plate', sendDb: -11, trimDb: TRIMS.marimbaB, pan: 0.42, inserts: ['tape'], tape: { wowMs: 0.35, flutterMs: 0.04, wowHz: 0.47 } });
  engine.route('vibes', { reverb: 'plate', sendDb: -6, trimDb: TRIMS.vibes, pan: 0.12, inserts: ['tremolo'], tremoloHz: 5.4, tremoloDepth: 0.38 });
  engine.route('piano', { reverb: 'plate', sendDb: -7, trimDb: TRIMS.piano, pan: -0.1, inserts: ['tape'], tape: { wowMs: 1.4, flutterMs: 0.12, drive: 2.0, lowpass: 7500 }, eq: [{ type: 'peaking', f: 2800, q: 0.8, gain: -3 }] });
  engine.synth('organ', 'organ', { drawbars: { 1: 1, 2: 0.55, 3: 0.12, 4: 0.16, 6: 0.04, 8: 0.05 } });
  engine.route('organ', { reverb: 'plate', sendDb: -10, trimDb: TRIMS.organ, pan: 0.05, inserts: ['tremolo'], tremoloHz: 6.2, tremoloDepth: 0.12 });
  // The time-lag accumulator. Feedback 0.36 (three audible repeats), a darker loop, and almost no wow: a
  // sustained voice must not drift against its own copies. The piece erases the tape at chord changes.
  engine.fx.echo = engine.echo('organ', 'echo', { time: 4 * BEAT, feedback: ECHO_FB, lowpass: 2400, highpass: 220, wowMs: 0.3 }, { reverb: 'plate', sendDb: -6, trimDb: TRIMS.echo, pan: -0.25 });
  engine.synth('drone', 'sine');
  engine.route('drone', { reverb: 'plate', sendDb: -14, trimDb: TRIMS.drone, pan: 0 });
  engine.synth('bell', 'bell');
  engine.route('bell', { reverb: 'plate', sendDb: -3, trimDb: TRIMS.bell, pan: 0.2 });
  engine.noise('hiss', { gainDb: -58, highpass: 1800, lowpass: 9500, seed: 1957 }, { reverb: 'plate', sendDb: -40, trimDb: TRIMS.hiss });
}

const BEAT = 60 / 83;
const ECHO_FB = 0.36;
const PULSE = BEAT / 4;
// The phasing pattern: 12 pulses, pentatonic (A minor / C major), accents on 0, 4 and 7.
const PATTERN = [
  [69, 0.34],
  [76, 0.24],
  [74, 0.28],
  null,
  [69, 0.3],
  [72, 0.24],
  null,
  [76, 0.3],
  [67, 0.24],
  [74, 0.27],
  null,
  [72, 0.24],
];
const ADD_ORDER = [0, 4, 7, 2, 9, 1, 5, 8, 11]; // which notes enter first (additive) / leave last (subtractive)

export class Era2Piece {
  constructor(engine, p = {}) {
    this.e = engine;
    // a piece is composed in its home key and transposed as a whole (the conductor walks the circle of fifths)
    this.tr = p.transpose ?? 0;
    this.play = (ev) => engine.play({ ...ev, midi: ev.midi + this.tr });
    this.rng = makeRng(p.seed ?? 1962);
    this.T0 = p.start ?? 0;
    this.D = p.duration ?? 140;
    this.field = pentatonic(0); // C major pentatonic = A minor pentatonic
    this.patternPcs = [...new Set(PATTERN.filter(Boolean).map(([m]) => mod12(m)))]; // the loop never stops
    this.eps = p.phase ?? 0.004;
    this.events = [];
    this.loopLen = PATTERN.length * PULSE;
    // loop A: additive from 4 s; loop B joins at a loop boundary after 18 s; both thin out at the end
    this.A = { t0: 4.0, k: 0, rate: 1 };
    const bStartCycle = Math.ceil((0.18 * this.D - this.A.t0) / this.loopLen);
    this.B = { t0: this.A.t0 + bStartCycle * this.loopLen, k: 0, rate: 1 + this.eps };
    this.exitA = this.D * 0.72; // subtractive exit of A begins (about 20 s to silence)
    this.exitB = this.D * 0.6;
    this.plan();
    this.idx = 0;
    // harmonic gate on the time-lag accumulator: the feedback is erased from half a second before each
    // drone change until one delay after it, so no echo tail carries one chord into the next
    const fb = engine.fx?.echo?.feedback;
    if (fb?.setTargetAtTime) {
      for (const c of [0.44, 0.57, 0.68].map((f) => f * this.D)) {
        fb.setTargetAtTime(0, this.T0 + c - 0.5, 0.12);
        fb.setTargetAtTime(ECHO_FB, this.T0 + c + 4 * BEAT, 0.4);
      }
    }
    // the tape hiss comes and goes with the piece
    const hiss = engine.channels?.get?.('hiss');
    if (hiss) {
      const g = hiss.fader.gain;
      g.setValueAtTime(0.0001, this.T0);
      g.setTargetAtTime(1, this.T0 + 0.3, 1.0);
      g.setTargetAtTime(0.0001, this.T0 + this.D - 6, 1.5);
    }
  }

  /** How many pattern notes a loop plays in its cycle number c (additive entry, subtractive exit). */
  notesInCycle(loop, c, tCycle, exitAt) {
    const full = ADD_ORDER.length;
    let n = Math.min(full, 3 + c);
    if (tCycle >= exitAt) n = Math.max(0, full - 1 - Math.floor((tCycle - exitAt) / this.loopLen));
    return new Set(ADD_ORDER.slice(0, n));
  }

  droneAt(t) {
    const D = this.D;
    if (t < 0.44 * D) return 33; // A1
    if (t < 0.57 * D) return 29; // F1
    if (t < 0.68 * D) return 31; // G1
    return 33;
  }

  plan() {
    const D = this.D;
    const r = this.rng.fork('plan');
    const E = this.events;
    // drone: root + just fifth + octave, each a long sine; changes with crossfades
    const changes = [1.5, 0.44 * D, 0.57 * D, 0.68 * D];
    // each drone fades out (1.4 s) just before the next fades in (3 s): roots a step apart never overlap
    changes.forEach((t, i) => {
      const last = i + 1 === changes.length;
      const end = last ? D - 3 : changes[i + 1] - 1.0;
      const root = this.droneAt(t + 0.01);
      const atk = i === 0 ? 7 : 3;
      for (const [m, v] of [[root, 0.62], [justAbove(root, 1.5), 0.42], [root + 12, 0.36], [justAbove(root + 12, 1.5), 0.2]]) {
        E.push({ t: i === 0 ? t : t - 0.3, inst: 'drone', midi: m, vel: v, dur: end - t, opts: { attack: atk, release: last ? 6 : 1.4 } });
      }
    });
    // vibraphone chords: quartal voicings of the field over the drone, rolled, soft
    let prev = null;
    let prevBass = null;
    for (let t = 0.17 * D; t < 0.86 * D; t += r.range(9, 12.5)) {
      const bass = this.droneAt(t) + 12; // the drone root an octave up: the voicing's reference bass
      // upper tones: the field ordered by their colour over this bass (third, fifth, seventh, ninth...);
      // while the organ sounds (30-70%), only its consonant set, so the held chords agree
      const underOrgan = t >= 0.3 * D - 1 && t < 0.7 * D;
      const upper = underOrgan
        ? consonantSet(mod12(bass), this.field, this.patternPcs)
        : [3, 4, 7, 10, 11, 2, 9, 5].map((iv) => (bass + iv) % 12).filter((pc) => this.field.includes(pc));
      const v = voiceChord(bass, upper, [[55, 67], [60, 72], [64, 76], [67, 81]], prev, r, { need: Math.min(3, upper.length), topTarget: r.range(70, 79), prevBass });
      if (!v) continue;
      prev = v;
      prevBass = bass;
      v.forEach((m, j) => E.push({ t: t + j * 0.035 + r.range(0, 0.01), inst: 'vibes', midi: m, vel: 0.24 + r.range(0, 0.06) + (j === 3 ? 0.04 : 0), dur: 7, opts: {} }));
    }
    // a last chord, left to ring over the drone: A minor 9 (A C E G B is outside the field: B as the 9th is
    // the one colour the piece has saved)
    [57, 64, 67, 71, 76].forEach((m, j) => E.push({ t: 0.9 * D + j * 0.05, inst: 'vibes', midi: m, vel: 0.3 - j * 0.015, dur: 10, opts: {} }));
    // organ modules (In C fashion) from 30% to 68%, into the time-lag accumulator. Each module is built
    // from the consonant set of the drone it sounds over (consonantSet: no seconds, no tritone), because
    // the echo stacks a module's notes into one chord. Modules follow the drone sections, and the last beat
    // before a drone change is a rest (the tape is erased there, see the constructor).
    const SHAPES = [
      [[0, 2, 2], [2, 1, 1]], // two notes, falling
      [[0, 0, 1], [1, 1, 1], [2, 2, 2]], // three, rising
      [[0, 2, 3], [3, 1, 1]], // long high, short low
      [[0, 1, 1], [1, 2, 1], [2, 3, 2]], // rising to the top
    ];
    const orgStart = 0.3 * D;
    const orgEnd = 0.68 * D;
    const sections = [orgStart, ...changes.filter((c) => c > orgStart && c < orgEnd), orgEnd];
    let shapeIdx = 0;
    this.organSets = [];
    for (let k = 0; k + 1 < sections.length; k++) {
      const a = sections[k];
      const b = sections[k + 1];
      const root = mod12(this.droneAt(a + 0.01));
      const set = consonantSet(root, this.field, this.patternPcs);
      this.organSets.push({ from: a, to: b, set });
      const pool = notesIn(set, 64, 81); // E4..A5
      // the module count per section follows its length (about 13 s each)
      const nMod = Math.max(1, Math.round((b - a) / 13));
      const per = (b - a) / nMod;
      for (let j = 0; j < nMod; j++) {
        const shape = SHAPES[shapeIdx++ % SHAPES.length];
        const top = Math.min(pool.length - 1, Math.max(...shape.map((x) => x[1])) + r.int(0, Math.max(0, pool.length - 4)));
        const base = Math.max(0, top - Math.max(...shape.map((x) => x[1])));
        const len = Math.max(...shape.map(([b0, , d]) => b0 + d)) + 1;
        let t = a + j * per;
        const until = Math.min(a + (j + 1) * per, b - BEAT); // a rest in the beat before a change
        while (t + len * BEAT <= until) {
          for (const [b0, idx, d] of shape) {
            const m = pool[Math.min(pool.length - 1, base + idx)];
            E.push({ t: t + b0 * BEAT, inst: 'organ', midi: m, vel: 0.36 + r.range(-0.02, 0.02), dur: d * BEAT * 0.92, opts: { attack: 0.03, release: 0.25 } });
          }
          t += (len + r.int(0, 1)) * BEAT;
        }
      }
    }
    // two Risset bells: the drone's return, and the last section
    E.push({ t: 0.69 * D, inst: 'bell', midi: 57, vel: 0.5, dur: 11, opts: {} });
    E.push({ t: 0.84 * D, inst: 'bell', midi: 64, vel: 0.42, dur: 9, opts: {} });
    // the 1945 motif, transposed to A, on tape at half speed (an octave down, twice as long)
    const b45 = 60 / 58;
    let tm = 0.74 * D;
    for (const [m, d, v] of [[76, 1.5, 0.42], [81, 0.5, 0.38], [79, 1, 0.4], [76, 1, 0.36], [74, 2.5, 0.34]]) {
      E.push({ t: tm, inst: 'piano', midi: m, vel: v, dur: d * b45 * 2 + 2.5, opts: { rate: 0.5 } });
      tm += d * b45 * 2;
    }
    E.sort((a, b) => a.t - b.t);
  }

  schedule(t0abs, t1abs) {
    const t0 = t0abs - this.T0;
    const t1 = t1abs - this.T0;
    const e = this.e;
    while (this.idx < this.events.length && this.events[this.idx].t < t1) {
      const ev = this.events[this.idx++];
      if (ev.t >= t0 - 0.05) this.play({ ...ev, t: this.T0 + Math.max(ev.t, t0) });
    }
    const act = e.state.activity ?? 0.5;
    for (const [name, L, exitAt] of [['marimba', this.A, this.exitA], ['marimbaB', this.B, this.exitB]]) {
      if (name === 'marimbaB' && act < 0.3) continue; // a quiet factory: no phasing, one loop
      const cyc = this.loopLen / L.rate;
      while (true) {
        const c = Math.floor(L.k / PATTERN.length);
        const step = L.k % PATTERN.length;
        const t = L.t0 + L.k * (PULSE / L.rate);
        if (t >= t1) break;
        L.k++;
        if (t > this.D - 2) continue;
        const tCycle = L.t0 + c * cyc;
        const on = this.notesInCycle(L, c, tCycle, exitAt);
        const p = PATTERN[step];
        if (!p || !on.has(step)) continue;
        const [m, v] = p;
        // the loops breathe: slow swells in opposite phase, so the emphasis passes between them
        const swell = 0.84 + 0.16 * Math.sin((2 * Math.PI * t) / 23 + (name === 'marimbaB' ? Math.PI : 0));
        // tape: loop B's pitch is raised with its speed (rate), exactly as on a faster tape transport
        this.play({ t: this.T0 + t, inst: name, midi: m, vel: Math.min(0.62, v * 1.45 * swell * (0.95 + 0.1 * act)), dur: 1.6, opts: { rate: L.rate } });
      }
    }
  }

  done(now) {
    return now - this.T0 > this.D + 8;
  }
}
