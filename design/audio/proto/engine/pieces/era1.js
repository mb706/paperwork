// Era I, "Relays and tubes" (the Start and Memo tiers; Literature to 1956).
// Acoustic instruments only: piano, string sections, clarinet, harp, glockenspiel.
//
// Process (all rules, no fixed score):
// - Piano loops of incommensurate lengths, as on Eno's Music for Airports (1978): each loop is a
//   fragment of one motif; their alignments never repeat. Loops mutate by one field step now and
//   then, so a long piece drifts (Riley's In C idea of moving modules).
// - A pentatonic "field" over a moving bass: every loop note is consonant with every chord, and the
//   bass alone turns the field into Dm7, Bbmaj9, F6/9, Csus, G9sus.
// - Strings voice-lead the chords (voiceChord: smallest motion, low-interval limits).
// - A tintinnabuli melody (Part's M-voice and T-voice, 1976) on clarinet and harp, in additive
//   phrases that close on a centre pitch.
// - Activity (factory busyness, 0..1) gates an optional harp arpeggio layer and loop density.

import { makeRng } from '../rng.js';
import { diatonicOf, mod12, notesIn, pentatonic, remap, stepIn, topLine, towardCentrePhrases, tVoice, voiceChord } from '../theory.js';

export const ERA1_SAMPLERS = ['piano', 'violins', 'violas', 'celli', 'bass', 'clarinet', 'harp', 'glock'];

// Channel trims (dB), calibrated from stem loudness: analysis/calibrate.py rewrites this table.
export const TRIMS = {
  piano: 1.0,
  violins: -12.6,
  violas: -11.7,
  celli: -10.1,
  bass: -16.6,
  clarinet: -4.4,
  harp: -7.2,
  glock: -6.8,
};

// Channel trims are calibrated from stem loudness (render.mjs with "stems"): relative to the mix,
// piano -6 LU, clarinet melody -7, each string section -13..-14, bass -16, harp -12, glock -18,
// reverb return about -9.
export function setupEra1(engine) {
  engine.mixer.addReverb('hall', 'hall', 5);
  engine.mixer.air(4);
  // a close-miked piano has a 1.2-4 kHz shelf of its own; for hours of listening it is voiced darker
  engine.route('piano', { reverb: 'hall', sendDb: -8, trimDb: TRIMS.piano, pan: 0, eq: [{ type: 'peaking', f: 2800, q: 0.8, gain: -3 }] });
  engine.route('violins', { reverb: 'hall', sendDb: -4, trimDb: TRIMS.violins, pan: -0.22, eq: [{ type: 'peaking', f: 3200, q: 0.9, gain: -2 }] });
  engine.route('violas', { reverb: 'hall', sendDb: -4, trimDb: TRIMS.violas, pan: 0.18 });
  engine.route('celli', { reverb: 'hall', sendDb: -5, trimDb: TRIMS.celli, pan: 0.3 });
  engine.route('bass', { reverb: 'hall', sendDb: -8, trimDb: TRIMS.bass, pan: 0.12 });
  engine.route('clarinet', { reverb: 'hall', sendDb: -7, trimDb: TRIMS.clarinet, pan: -0.08 });
  engine.route('harp', { reverb: 'hall', sendDb: -6, trimDb: TRIMS.harp, pan: 0.25 });
  engine.route('glock', { reverb: 'hall', sendDb: -3, trimDb: TRIMS.glock, pan: -0.3 });
}

// Upper-voice preference for a bass pitch class within a field: thirds, fifth, sevenths, ninth, sixth, fourth.
const PREF = [3, 4, 7, 10, 11, 2, 9, 5, 0];
function upperFor(bassPc, field) {
  const ivs = field.map((pc) => mod12(pc - bassPc)).filter((iv) => iv !== 1 && iv !== 6);
  return PREF.filter((iv) => ivs.includes(iv)).map((iv) => mod12(bassPc + iv));
}

const BASS_RANGE = [33, 45];
const bassNote = (pc) => notesIn([pc], BASS_RANGE[0], BASS_RANGE[1])[0];
const STRING_RANGES = [
  [45, 62], // celli
  [53, 69], // violas
  [60, 76], // violins II
  [65, 81], // violins I
];
// under the clarinet solo: three voices (violins I rest), kept below the melody where possible
const STRING_RANGES_LOW = [
  [45, 57],
  [50, 62],
  [55, 66],
];
const STRING_INST = ['celli', 'violas', 'violins', 'violins'];

export class Era1Piece {
  constructor(engine, p = {}) {
    this.e = engine;
    // a piece is composed in its home key and transposed as a whole (the conductor walks the circle of fifths)
    this.tr = p.transpose ?? 0;
    // machine: the same notes without human variation (exact time, even touch): the post-victory callback
    this.machine = !!p.machine;
    this.play = (ev) => engine.play({ ...ev, midi: ev.midi + this.tr, ...(this.machine ? { t: Math.round(ev.t / (this.beat / 4)) * (this.beat / 4), vel: 0.34 } : {}) });
    const seed = p.seed ?? 1945;
    this.rng = makeRng(seed);
    this.T0 = p.start ?? 0;
    this.D = p.duration ?? 140;
    this.tonic = p.tonicPc ?? 2; // D
    this.field = pentatonic(p.fieldRootPc ?? 5); // F major pentatonic = D minor pentatonic
    this.mode = diatonicOf(p.fieldRootPc ?? 5); // D Aeolian for the melody
    this.beat = 60 / ((p.tempo ?? 58) * (p.tempoScale ?? 1));
    this.events = []; // precomputed (form-level) events, relative times
    this.plan();
    this.cursorIdx = 0;
    this.loops = this.makeLoops();
    this.nextSparkle = this.sections.A[0] + 2.8 + this.rng.fork('sp').range(4, 10);
    this.arpT = null;
  }

  sec(f) {
    return f * this.D;
  }

  /** Sections as fractions of the duration; chords and melody are planned here. */
  plan() {
    const D = this.D;
    const r = this.rng.fork('plan');
    // intro and coda have fixed lengths; the middle sections share the rest (A 40%, B 40.6%, A2 19.4%)
    const intro = Math.min(0.1 * D, 14);
    const coda = Math.min(0.1 * D, 16);
    const mid = D - intro - coda;
    const a = intro + 0.4 * mid;
    const b = a + 0.406 * mid;
    this.sections = {
      intro: [0, intro],
      A: [intro, a],
      B: [a, b],
      A2: [b, D - coda],
      coda: [D - coda, D],
    };
    const S = this.sections;
    const chords = []; // {t, dur, bass (pc), dyn}
    const push = (t, dur, bassPc, dyn, extra = {}) => chords.push({ t, dur, bassPc, dyn, ...extra });
    // A: i - VI - III - VII (D Bb F C) or i - VII - VI - VII; durations ~ 10-12 s
    const cycA = r.pick([
      [2, 10, 5, 0],
      [2, 0, 10, 0],
      [2, 10, 7, 0],
    ]);
    // chords last about 11 s; a long piece repeats the cycle (the second pass a variant) rather than stretching it
    const t = S.A[0];
    const nA = Math.max(cycA.length, Math.round((S.A[1] - S.A[0]) / 11));
    const lenA = (S.A[1] - S.A[0]) / nA;
    const cycA2nd = r.pick([[2, 10, 5, 0], [2, 7, 10, 0], [10, 0, 2, 2]]);
    for (let i = 0; i < nA; i++) {
      const pc = (i < cycA.length ? cycA : cycA2nd)[i % cycA.length];
      push(t + i * lenA, lenA, pc, 0.28 + 0.05 * (i % 4) + (i >= cycA.length ? 0.03 : 0));
    }
    // B: the melody; harmony alternates i and VI per phrase. B lasts as long as the melody does, and
    // A2 takes the rest, so a long piece never idles after the tune.
    const mel = this.planMelody(S.B[0] + 1.5 * this.beat);
    this.melody = mel;
    const last = mel.phrases[mel.phrases.length - 1].notes;
    const melEnd = last[last.length - 1].t + last[last.length - 1].d + 2.5 * this.beat;
    if (melEnd < S.A2[1] - 15) {
      S.B[1] = melEnd;
      S.A2[0] = melEnd;
    }
    mel.phrases.forEach((ph, k) => {
      const end = k + 1 < mel.phrases.length ? mel.phrases[k + 1].t : S.B[1];
      // under the melody the strings play plain triads (Dm, Bb) below E4, so no passing tone clashes
      const triad = k % 2 === 0 ? [5, 9, 2] : [2, 5, 10];
      push(ph.t - 0.8, end - ph.t + (k === 0 ? 0.8 : 0), k % 2 === 0 ? 2 : 10, 0.22, { upper: triad, low: true });
    });
    // A2: iv - VI - VII, rising to the peak; coda: i
    // A2 ends iv - VI - VII into the coda's i; longer pieces approach it through more of the cycle
    const nA2 = Math.max(3, Math.round((S.A2[1] - S.A2[0]) / 7.5));
    const cycA2 = [...cycA, ...cycA].slice(0, nA2 - 3).concat([7, 10, 0]);
    const lenA2 = (S.A2[1] - S.A2[0]) / cycA2.length;
    cycA2.forEach((pc, i) => push(S.A2[0] + i * lenA2, lenA2, pc, 0.42 + (0.12 * i) / Math.max(1, cycA2.length - 1)));
    push(S.coda[0], S.coda[1] - S.coda[0] - 2.5, 2, 0.3, { upper: [9, 5, 2, 0] }); // Dm7
    // fix overlaps: each chord ends where the next begins
    chords.sort((a, b) => a.t - b.t);
    for (let i = 0; i < chords.length - 1; i++) chords[i].dur = chords[i + 1].t - chords[i].t;
    this.chords = chords;
    this.planStrings(chords, r.fork('voicing'));
    this.planMelodyEvents(mel);
    this.planStatement();
    this.events.sort((a, b) => a.t - b.t);
  }

  melodyNotesDuring(a, b) {
    const out = [];
    for (const ph of this.melody?.phrases ?? []) for (const n of ph.notes) if (n.t < b && n.t + n.d > a) out.push(n.m);
    return out;
  }

  chordAt(t) {
    let c = this.chords[0];
    for (const ch of this.chords) if (ch.t <= t + 1e-6) c = ch;
    return c;
  }

  planStrings(chords, r) {
    let prev = null;
    let prevBass = null;
    // the violins' top line: a slow melody of its own, rising to the climax in A2
    const contour = (t) => {
      const x = t / this.D;
      return x < 0.82 ? 71 + 9 * Math.sin((Math.PI / 2) * (x / 0.82)) ** 2 : 80 - ((x - 0.82) / 0.18) * 8;
    };
    const tops = topLine(
      chords.map((c, i) => ({
        pcs: (c.upper ?? upperFor(c.bassPc, this.field)).slice(0, 4),
        target: c.low ? 63 : contour(c.t),
        reenter: i > 0 && chords[i - 1].low && !c.low,
      })),
      [60, 81],
    );
    const held = new Array(STRING_INST.length).fill(null); // [midi, startRel, vel] per voice
    const bassHeld = { m: null, t: 0, v: 0 };
    const flush = (i, endT) => {
      const h = held[i];
      if (!h) return;
      const stag = r.range(0, 0.12);
      const final = endT >= this.D - 3;
      this.events.push({ t: h[1] + stag, inst: STRING_INST[i], midi: h[0], vel: h[2], dur: endT - h[1] + (final ? 0.6 : 0.3), opts: { attack: h[3], release: final ? 3.2 : 1.5 } });
      held[i] = null;
    };
    const flushBass = (endT) => {
      if (bassHeld.m == null) return;
      this.events.push({ t: bassHeld.t, inst: 'bass', midi: bassHeld.m, vel: bassHeld.v, dur: endT - bassHeld.t + 0.3, opts: { attack: 2.0, release: endT >= this.D - 3 ? 3.2 : 1.6 } });
      bassHeld.m = null;
    };
    chords.forEach((c, ci) => {
      const bass = bassNote(c.bassPc);
      const upper = upperFor(c.bassPc, this.field);
      const upperPcs = c.upper ?? upper;
      const ranges = c.low ? STRING_RANGES_LOW : STRING_RANGES;
      const avoid = this.melodyNotesDuring(c.t, c.t + c.dur);
      const top = c.low ? null : tops[ci];
      const v =
        voiceChord(bass, upperPcs, ranges, prev, r, { need: 3, top, topTarget: c.low ? 62 : undefined, prevBass, avoid, hardAvoid: true }) ??
        voiceChord(bass, upperPcs, ranges, prev, r, { need: 3, topTarget: c.low ? 62 : undefined, prevBass, avoid, hardAvoid: true }) ??
        voiceChord(bass, upperPcs, ranges, prev, r, { need: 2, prevBass, avoid }) ??
        prev;
      prevBass = bass;
      const first = ci === 0;
      for (let i = v.length; i < held.length; i++) flush(i, c.t); // voices that rest in this chord
      v.forEach((m, i) => {
        if (held[i] && held[i][0] === m) return; // a common tone is held, not re-bowed
        flush(i, c.t);
        held[i] = [m, c.t, c.dyn * (i === 3 ? 1.0 : 0.92), first || !held.some(Boolean) ? 4.5 : 2.4];
      });
      if (bassHeld.m !== bass) {
        flushBass(c.t);
        bassHeld.m = bass;
        bassHeld.t = c.t;
        bassHeld.v = c.dyn + 0.08;
      }
      prev = v;
    });
    const end = this.D - 2.5;
    for (let i = 0; i < held.length; i++) flush(i, end);
    flushBass(end);
  }

  /** Exposition: the motif once, whole, before the loops take it apart. */
  planStatement() {
    const b = this.beat;
    const r = this.rng.fork('stmt');
    const motif = [[69, 1.5, 0.4], [74, 0.5, 0.36], [72, 1, 0.38], [69, 1, 0.34], [67, 2.5, 0.3]];
    let t = 1.0;
    for (const [m, d, v] of motif) {
      this.events.push({ t: t + r.gauss() * 0.01, inst: 'piano', midi: m, vel: v, dur: d * b + 1.5, opts: {} });
      t += d * b;
    }
    // a soft open fifth under the last note
    this.events.push({ t: t - 2.5 * b + 0.05, inst: 'piano', midi: 50, vel: 0.26, dur: 4, opts: {} });
    this.events.push({ t: t - 2.5 * b + 0.12, inst: 'piano', midi: 57, vel: 0.24, dur: 4, opts: {} });
  }

  /** Tintinnabuli melody: additive phrases closing on the centre (A4), harp T-voice below. */
  planMelody(start) {
    const centre = 69; // A4
    const nPhrases = Math.max(4, Math.min(7, Math.round((this.sections.B[1] - this.sections.B[0]) / 11.5)));
    // additive growth 2, 3, 4, 5; then 4 (rising to the centre) and 5 (falling to it) alternate, so the
    // tune stays within E4-E5, above the strings
    const lens = Array.from({ length: nPhrases }, (_, k) => (k < 4 ? 2 + k : k % 2 === 0 ? 4 : 5));
    const phrases = towardCentrePhrases(centre, this.mode, nPhrases, 2, lens);
    const b = this.beat;
    let t = start;
    const out = [];
    for (const ph of phrases) {
      const notes = [];
      ph.forEach((m, i) => {
        const last = i === ph.length - 1;
        // passing tones (outside the pentatonic field) take one beat, the others two, the last 3.5
        const passing = !this.field.includes(mod12(m));
        const d = (last ? 3.5 : passing ? 1 : 2) * b;
        notes.push({ t, m, d, last });
        t += d;
      });
      out.push({ t: notes[0].t, notes });
      t += 1.5 * b;
    }
    return { phrases: out, centre };
  }

  planMelodyEvents(mel) {
    const r = this.rng.fork('mel');
    const triad = [2, 5, 9]; // D minor: the tintinnabuli triad
    mel.phrases.forEach((ph, k) => {
      const n = ph.notes.length;
      ph.notes.forEach((nt, i) => {
        // phrase arch: louder toward the middle, the final note softer
        const arch = Math.sin((Math.PI * (i + 0.5)) / n);
        const vel = 0.3 + 0.16 * arch - (nt.last ? 0.06 : 0) + r.range(-0.02, 0.02);
        const inMode = this.field.includes(mod12(nt.m));
        this.events.push({ t: nt.t + r.gauss() * 0.008, inst: 'clarinet', midi: nt.m, vel, dur: nt.d + 0.06, opts: { attack: inMode ? 0.16 : 0.12, release: nt.last ? 1.4 : 0.45 } });
        const tv = tVoice(nt.m, triad, 'inferior', 1);
        this.events.push({ t: nt.t + 0.02, inst: 'harp', midi: tv, vel: 0.36 + 0.06 * arch, dur: nt.d, opts: {} });
        if (nt.last) {
          // a rolled D-minor triad under the phrase end (T-voice, second position)
          [50, 53, 57].forEach((m, j) => this.events.push({ t: nt.t + 0.35 + j * 0.11, inst: 'harp', midi: m, vel: 0.3, dur: nt.d, opts: {} }));
        }
      });
    });
  }

  /** The motif: A4 D5 C5 A4 G4 (degrees 5 1 b7 5 4 of D minor pentatonic). Loops are its fragments. */
  makeLoops() {
    const r = this.rng.fork('loops');
    const L = (period, start, notes, sectionsOff = []) => ({ period, next: start, notes, sectionsOff, cycles: 0, r: r.fork(period) });
    return [
      L(19.7, 11.5, [[0, 69, 0.42], [1.15, 74, 0.36]]),
      L(23.3, 16.5, [[0, 72, 0.38], [0.9, 69, 0.33], [2.0, 67, 0.3]], ['B']),
      L(29.9, 8.5, [[0, 62, 0.33], [0.07, 69, 0.3]]),
      L(34.1, this.sections.A[0] + 0.564 * (this.sections.A[1] - this.sections.A[0]), [[0, 77, 0.3], [1.3, 72, 0.28]], ['B', 'coda']),
      L(41.3, this.sections.A[0] + 9.8, [[0, 50, 0.3], [0.12, 57, 0.26]], ['coda']),
    ];
  }

  sectionAt(t) {
    for (const [k, [a, b]] of Object.entries(this.sections)) if (t >= a && t < b) return k;
    return 'end';
  }

  schedule(t0abs, t1abs) {
    const t0 = t0abs - this.T0;
    const t1 = t1abs - this.T0;
    const e = this.e;
    // form-level events
    while (this.cursorIdx < this.events.length && this.events[this.cursorIdx].t < t1) {
      const ev = this.events[this.cursorIdx++];
      if (ev.t >= t0 - 0.05) this.play({ ...ev, t: this.T0 + Math.max(ev.t, t0) });
    }
    // loops
    for (const lp of this.loops) {
      while (lp.next < t1) {
        const t = lp.next;
        lp.next += lp.period;
        lp.cycles++;
        const sec = this.sectionAt(t);
        if (t > this.D - 7 || lp.sectionsOff.includes(sec)) continue;
        // activity thins the loops a little when the factory is quiet (never below two loops)
        const act = e.state.activity ?? 0.5;
        if (this.loops.indexOf(lp) >= 3 && act < 0.25 && lp.r.chance(0.5)) continue;
        const field = this.field;
        const soft = sec === 'B' ? 0.8 : 1;
        for (const [dt, m, v] of lp.notes) {
          const mm = remap(m, field);
          this.play({ t: this.T0 + t + dt + lp.r.gauss() * 0.012, inst: 'piano', midi: mm, vel: (v + lp.r.range(-0.035, 0.035)) * soft, dur: 8.5, opts: {} });
        }
        // mutation: now and then one note moves one field step (In C-style drift)
        if (lp.cycles % 3 === 0 && lp.r.chance(0.45) && lp.notes.length > 1) {
          const k = lp.r.int(1, lp.notes.length - 1);
          const n = lp.notes[k];
          const nm = stepIn(n[1], field, lp.r.chance(0.5) ? 1 : -1);
          if (nm >= 55 && nm <= 79) n[1] = nm;
        }
      }
    }
    // glockenspiel: rare, high, soft (dust in a sunbeam), only where the texture has room
    while (this.nextSparkle < t1) {
      const t = this.nextSparkle;
      const r = this.rng.fork(`sp${Math.floor(t)}`);
      this.nextSparkle += r.range(9, 17);
      const sec = this.sectionAt(t);
      if (sec === 'A' || sec === 'A2') {
        const pool = notesIn(this.field, 84, 96);
        this.play({ t: this.T0 + t, inst: 'glock', midi: r.pick(pool), vel: r.range(0.14, 0.26), dur: 3, opts: {} });
      }
    }
    // activity layer: a slow harp arpeggio in A2 when the factory is busy
    const [a2s, a2e] = this.sections.A2;
    if ((e.state.activity ?? 0.5) > 0.4) {
      if (this.arpT == null) this.arpT = a2s + 0.5 * this.beat;
      const step = this.beat / 2;
      while (this.arpT < Math.min(t1, a2e - step)) {
        const t = this.arpT;
        this.arpT += step;
        const c = this.chordAt(t);
        const pcs = upperFor(c.bassPc, this.field).slice(0, 3).concat([c.bassPc]);
        const pool = notesIn(pcs, 55, 79);
        const k = Math.round((t - a2s) / step);
        const cyc = pool.length * 2 - 2;
        const pos = k % cyc;
        const idx = pos < pool.length ? pos : cyc - pos;
        const phase = (t - a2s) / (a2e - a2s);
        this.play({ t: this.T0 + t + this.rng.gauss() * 0.006, inst: 'harp', midi: pool[idx], vel: 0.2 + 0.12 * Math.sin(Math.PI * phase), dur: 2, opts: {} });
      }
    }
  }

  done(now) {
    return now - this.T0 > this.D + 8;
  }
}
