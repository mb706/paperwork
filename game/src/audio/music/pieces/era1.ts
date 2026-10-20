// Era I, "Relays and tubes" (the Start and Memo tiers; Literature to 1956). A4 `pieces/era1.js`, ported
// note for note (DIRECTION §4). Acoustic instruments only: piano, string sections, clarinet, harp,
// glockenspiel.
//
// Process (rules, no fixed score):
// - Piano loops of incommensurate lengths, as on Eno's Music for Airports (1978): each loop is a fragment of
//   one motif; their alignments never repeat. Loops mutate by one field step now and then, so a long piece
//   drifts (Riley's In C idea of moving modules).
// - A pentatonic field over a moving bass: every loop note is consonant with every chord, and the bass alone
//   turns the field into Dm7, B♭maj9, F6/9, Csus, G9sus.
// - Strings voice-lead the chords (voiceChord: smallest motion, low-interval limits).
// - A tintinnabuli melody (Pärt's M-voice and T-voice, 1976) on clarinet and harp, in additive phrases that
//   close on a centre pitch.
// - Activity (factory busyness, 0..1) gates an optional harp arpeggio layer and loop density.
import { makeRng, type Rng } from '../../core/rng.ts';
import {
  diatonicOf,
  mod12,
  notesIn,
  pentatonic,
  remap,
  stepIn,
  topLine,
  towardCentrePhrases,
  tVoice,
  voiceChord,
} from '../../core/theory.ts';
import type { EraLayout, NoteEvent, Piece, PieceHost, PieceParams, PieceSpec } from '../types.ts';

/** Channel trims (dB), calibrated by A4 from stem loudness (`analysis/calibrate.py`). */
export const ERA1_TRIMS = {
  piano: 1.0,
  violins: -12.6,
  violas: -11.7,
  celli: -10.1,
  bass: -16.6,
  clarinet: -4.4,
  harp: -7.2,
  glock: -6.8,
} as const;

const sampler = (pack: string, xfade = true) => ({ kind: 'sampler' as const, pack, xfade });

/**
 * A4's `setupEra1`: relative to the mix, piano −6 LU, clarinet melody −7, each string section −13..−14,
 * bass −16, harp −12, glock −18, the reverb return about −9.
 */
export const ERA1_LAYOUT: EraLayout = {
  id: 'era1',
  reverb: { preset: 'hall', wetDb: 5 },
  airDb: 4,
  channels: [
    // a close-miked piano has a 1.2-4 kHz shelf of its own; for hours of listening it is voiced darker
    {
      name: 'piano',
      sendDb: -8,
      trimDb: ERA1_TRIMS.piano,
      pan: 0,
      eq: [{ type: 'peaking', f: 2800, q: 0.8, gain: -3 }],
    },
    {
      name: 'violins',
      sendDb: -4,
      trimDb: ERA1_TRIMS.violins,
      pan: -0.22,
      eq: [{ type: 'peaking', f: 3200, q: 0.9, gain: -2 }],
    },
    { name: 'violas', sendDb: -4, trimDb: ERA1_TRIMS.violas, pan: 0.18 },
    { name: 'celli', sendDb: -5, trimDb: ERA1_TRIMS.celli, pan: 0.3 },
    { name: 'bass', sendDb: -8, trimDb: ERA1_TRIMS.bass, pan: 0.12 },
    { name: 'clarinet', sendDb: -7, trimDb: ERA1_TRIMS.clarinet, pan: -0.08 },
    { name: 'harp', sendDb: -6, trimDb: ERA1_TRIMS.harp, pan: 0.25 },
    { name: 'glock', sendDb: -3, trimDb: ERA1_TRIMS.glock, pan: -0.3 },
  ],
  instruments: ['piano', 'violins', 'violas', 'celli', 'bass', 'clarinet', 'harp', 'glock'].map((n) => ({
    name: n,
    channel: n,
    source: sampler(n),
  })),
};

// Upper-voice preference for a bass pitch class within a field: thirds, fifth, sevenths, ninth, sixth, fourth.
const PREF = [3, 4, 7, 10, 11, 2, 9, 5, 0];
function upperFor(bassPc: number, field: readonly number[]): number[] {
  const ivs = field.map((pc) => mod12(pc - bassPc)).filter((iv) => iv !== 1 && iv !== 6);
  return PREF.filter((iv) => ivs.includes(iv)).map((iv) => mod12(bassPc + iv));
}

const BASS_RANGE: readonly [number, number] = [33, 45];
const bassNote = (pc: number): number => notesIn([pc], BASS_RANGE[0], BASS_RANGE[1])[0] as number;
const STRING_RANGES: readonly (readonly [number, number])[] = [
  [45, 62], // celli
  [53, 69], // violas
  [60, 76], // violins II
  [65, 81], // violins I
];
// under the clarinet solo: three voices (violins I rest), kept below the melody where possible
const STRING_RANGES_LOW: readonly (readonly [number, number])[] = [
  [45, 57],
  [50, 62],
  [55, 66],
];
const STRING_INST = ['celli', 'violas', 'violins', 'violins'] as const;

interface Chord {
  t: number;
  dur: number;
  bassPc: number;
  dyn: number;
  upper?: number[];
  low?: boolean;
}
interface MelNote {
  t: number;
  m: number;
  d: number;
  last: boolean;
}
interface Phrase {
  t: number;
  notes: MelNote[];
}
interface Loop {
  period: number;
  next: number;
  notes: [number, number, number][];
  sectionsOff: string[];
  cycles: number;
  r: Rng;
}
type SectionName = 'intro' | 'A' | 'B' | 'A2' | 'coda';
type Sections = Record<SectionName, [number, number]>;

export class Era1Piece implements Piece {
  readonly T0: number;
  readonly D: number;
  private readonly host: PieceHost;
  private readonly tr: number;
  private readonly machine: boolean;
  private readonly rng: Rng;
  private readonly field: number[];
  private readonly mode: number[];
  private readonly beat: number;
  private readonly events: NoteEvent[] = [];
  private sections!: Sections;
  private chords: Chord[] = [];
  private melody: { phrases: Phrase[]; centre: number } | null = null;
  private cursorIdx = 0;
  private readonly loops: Loop[];
  private nextSparkle: number;
  private arpT: number | null = null;

  constructor(host: PieceHost, p: PieceParams = {}) {
    this.host = host;
    // a piece is composed in its home key and transposed as a whole (the conductor walks the circle of fifths)
    this.tr = p.transpose ?? 0;
    // machine: the same notes without human variation (exact time, even touch): the post-victory callback
    this.machine = !!p.machine;
    const seed = p.seed ?? 1945;
    this.rng = makeRng(seed);
    this.T0 = p.start ?? 0;
    this.D = p.duration ?? 140;
    this.field = pentatonic(5); // F major pentatonic = D minor pentatonic
    this.mode = diatonicOf(5); // D Aeolian for the melody
    this.beat = 60 / (58 * (p.tempoScale ?? 1));
    this.plan();
    this.loops = this.makeLoops();
    this.nextSparkle = this.sections.A[0] + 2.8 + this.rng.fork('sp').range(4, 10);
  }

  private play(ev: NoteEvent): void {
    const q = this.beat / 4;
    this.host.play(
      this.machine
        ? { ...ev, midi: ev.midi + this.tr, t: Math.round(ev.t / q) * q, vel: 0.34 }
        : { ...ev, midi: ev.midi + this.tr },
    );
  }

  /** Sections as fractions of the duration; chords and melody are planned here. */
  private plan(): void {
    const D = this.D;
    const r = this.rng.fork('plan');
    // intro and coda have fixed lengths; the middle sections share the rest (A 40%, B 40.6%, A2 19.4%)
    const intro = Math.min(0.1 * D, 14);
    const coda = Math.min(0.1 * D, 16);
    const mid = D - intro - coda;
    const a = intro + 0.4 * mid;
    const b = a + 0.406 * mid;
    this.sections = { intro: [0, intro], A: [intro, a], B: [a, b], A2: [b, D - coda], coda: [D - coda, D] };
    const S = this.sections;
    const chords: Chord[] = [];
    const push = (t: number, dur: number, bassPc: number, dyn: number, extra: Partial<Chord> = {}) =>
      chords.push({ t, dur, bassPc, dyn, ...extra });
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
    const cycA2nd = r.pick([
      [2, 10, 5, 0],
      [2, 7, 10, 0],
      [10, 0, 2, 2],
    ]);
    for (let i = 0; i < nA; i++) {
      const pc = (i < cycA.length ? cycA : cycA2nd)[i % cycA.length] as number;
      push(t + i * lenA, lenA, pc, 0.28 + 0.05 * (i % 4) + (i >= cycA.length ? 0.03 : 0));
    }
    // B: the melody; harmony alternates i and VI per phrase. B lasts as long as the melody does, and A2
    // takes the rest, so a long piece never idles after the tune.
    const mel = this.planMelody(S.B[0] + 1.5 * this.beat);
    this.melody = mel;
    const last = (mel.phrases[mel.phrases.length - 1] as Phrase).notes;
    const lastNote = last[last.length - 1] as MelNote;
    const melEnd = lastNote.t + lastNote.d + 2.5 * this.beat;
    if (melEnd < S.A2[1] - 15) {
      S.B[1] = melEnd;
      S.A2[0] = melEnd;
    }
    mel.phrases.forEach((ph, k) => {
      const end = k + 1 < mel.phrases.length ? (mel.phrases[k + 1] as Phrase).t : S.B[1];
      // under the melody the strings play plain triads (Dm, Bb) below E4, so no passing tone clashes
      const triad = k % 2 === 0 ? [5, 9, 2] : [2, 5, 10];
      push(ph.t - 0.8, end - ph.t + (k === 0 ? 0.8 : 0), k % 2 === 0 ? 2 : 10, 0.22, {
        upper: triad,
        low: true,
      });
    });
    // A2 ends iv - VI - VII into the coda's i; longer pieces approach it through more of the cycle
    const nA2 = Math.max(3, Math.round((S.A2[1] - S.A2[0]) / 7.5));
    const cycA2 = [...cycA, ...cycA].slice(0, nA2 - 3).concat([7, 10, 0]);
    const lenA2 = (S.A2[1] - S.A2[0]) / cycA2.length;
    cycA2.forEach((pc, i) => {
      push(S.A2[0] + i * lenA2, lenA2, pc, 0.42 + (0.12 * i) / Math.max(1, cycA2.length - 1));
    });
    push(S.coda[0], S.coda[1] - S.coda[0] - 2.5, 2, 0.3, { upper: [9, 5, 2, 0] }); // Dm7
    // fix overlaps: each chord ends where the next begins
    chords.sort((x, y) => x.t - y.t);
    for (let i = 0; i < chords.length - 1; i++)
      (chords[i] as Chord).dur = (chords[i + 1] as Chord).t - (chords[i] as Chord).t;
    this.chords = chords;
    this.planStrings(chords, r.fork('voicing'));
    this.planMelodyEvents(mel);
    this.planStatement();
    this.events.sort((x, y) => x.t - y.t);
  }

  private melodyNotesDuring(a: number, b: number): number[] {
    const out: number[] = [];
    for (const ph of this.melody?.phrases ?? [])
      for (const n of ph.notes) if (n.t < b && n.t + n.d > a) out.push(n.m);
    return out;
  }

  private chordAt(t: number): Chord {
    let c = this.chords[0] as Chord;
    for (const ch of this.chords) if (ch.t <= t + 1e-6) c = ch;
    return c;
  }

  private planStrings(chords: Chord[], r: Rng): void {
    let prev: number[] | null = null;
    let prevBass: number | null = null;
    // the violins' top line: a slow melody of its own, rising to the climax in A2
    const contour = (t: number) => {
      const x = t / this.D;
      return x < 0.82 ? 71 + 9 * Math.sin((Math.PI / 2) * (x / 0.82)) ** 2 : 80 - ((x - 0.82) / 0.18) * 8;
    };
    const tops = topLine(
      chords.map((c, i) => ({
        pcs: (c.upper ?? upperFor(c.bassPc, this.field)).slice(0, 4),
        target: c.low ? 63 : contour(c.t),
        reenter: i > 0 && !!(chords[i - 1] as Chord).low && !c.low,
      })),
      [60, 81],
    );
    // per voice: [midi, start, velocity, attack]
    const held: ([number, number, number, number] | null)[] = new Array(STRING_INST.length).fill(null);
    const bassHeld: { m: number | null; t: number; v: number } = { m: null, t: 0, v: 0 };
    const flush = (i: number, endT: number) => {
      const h = held[i];
      if (!h) return;
      const stag = r.range(0, 0.12);
      const final = endT >= this.D - 3;
      this.events.push({
        t: h[1] + stag,
        inst: STRING_INST[i] as string,
        midi: h[0],
        vel: h[2],
        dur: endT - h[1] + (final ? 0.6 : 0.3),
        opts: { attack: h[3], release: final ? 3.2 : 1.5 },
      });
      held[i] = null;
    };
    const flushBass = (endT: number) => {
      if (bassHeld.m == null) return;
      this.events.push({
        t: bassHeld.t,
        inst: 'bass',
        midi: bassHeld.m,
        vel: bassHeld.v,
        dur: endT - bassHeld.t + 0.3,
        opts: { attack: 2.0, release: endT >= this.D - 3 ? 3.2 : 1.6 },
      });
      bassHeld.m = null;
    };
    chords.forEach((c, ci) => {
      const bass = bassNote(c.bassPc);
      const upper = upperFor(c.bassPc, this.field);
      const upperPcs = c.upper ?? upper;
      const ranges = c.low ? STRING_RANGES_LOW : STRING_RANGES;
      const avoid = this.melodyNotesDuring(c.t, c.t + c.dur);
      const top = c.low ? null : (tops[ci] as number);
      const topTarget = c.low ? 62 : undefined;
      const v = (voiceChord(bass, upperPcs, ranges, prev, r, {
        need: 3,
        top,
        topTarget,
        prevBass,
        avoid,
        hardAvoid: true,
      }) ??
        voiceChord(bass, upperPcs, ranges, prev, r, {
          need: 3,
          topTarget,
          prevBass,
          avoid,
          hardAvoid: true,
        }) ??
        voiceChord(bass, upperPcs, ranges, prev, r, { need: 2, prevBass, avoid }) ??
        prev) as number[];
      prevBass = bass;
      const first = ci === 0;
      for (let i = v.length; i < held.length; i++) flush(i, c.t); // voices that rest in this chord
      v.forEach((m, i) => {
        const h = held[i];
        if (h && h[0] === m) return; // a common tone is held, not re-bowed
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
  private planStatement(): void {
    const b = this.beat;
    const r = this.rng.fork('stmt');
    const motif: [number, number, number][] = [
      [69, 1.5, 0.4],
      [74, 0.5, 0.36],
      [72, 1, 0.38],
      [69, 1, 0.34],
      [67, 2.5, 0.3],
    ];
    let t = 1.0;
    for (const [m, d, v] of motif) {
      this.events.push({
        t: t + r.gauss() * 0.01,
        inst: 'piano',
        midi: m,
        vel: v,
        dur: d * b + 1.5,
        opts: {},
      });
      t += d * b;
    }
    // a soft open fifth under the last note
    this.events.push({ t: t - 2.5 * b + 0.05, inst: 'piano', midi: 50, vel: 0.26, dur: 4, opts: {} });
    this.events.push({ t: t - 2.5 * b + 0.12, inst: 'piano', midi: 57, vel: 0.24, dur: 4, opts: {} });
  }

  /** Tintinnabuli melody: additive phrases closing on the centre (A4), the harp's T-voice below. */
  private planMelody(start: number): { phrases: Phrase[]; centre: number } {
    const centre = 69; // A4
    const B = this.sections.B;
    const nPhrases = Math.max(4, Math.min(7, Math.round((B[1] - B[0]) / 11.5)));
    // additive growth 2, 3, 4, 5; then 4 (rising to the centre) and 5 (falling to it) alternate, so the
    // tune stays within E4-E5, above the strings
    const lens = Array.from({ length: nPhrases }, (_, k) => (k < 4 ? 2 + k : k % 2 === 0 ? 4 : 5));
    const phrases = towardCentrePhrases(centre, this.mode, nPhrases, 2, lens);
    const b = this.beat;
    let t = start;
    const out: Phrase[] = [];
    for (const ph of phrases) {
      const notes: MelNote[] = [];
      ph.forEach((m, i) => {
        const last = i === ph.length - 1;
        // passing tones (outside the pentatonic field) take one beat, the others two, the last 3.5
        const passing = !this.field.includes(mod12(m));
        const d = (last ? 3.5 : passing ? 1 : 2) * b;
        notes.push({ t, m, d, last });
        t += d;
      });
      out.push({ t: (notes[0] as MelNote).t, notes });
      t += 1.5 * b;
    }
    return { phrases: out, centre };
  }

  private planMelodyEvents(mel: { phrases: Phrase[] }): void {
    const r = this.rng.fork('mel');
    const triad = [2, 5, 9]; // D minor: the tintinnabuli triad
    mel.phrases.forEach((ph) => {
      const n = ph.notes.length;
      ph.notes.forEach((nt, i) => {
        // phrase arch: louder toward the middle, the final note softer
        const arch = Math.sin((Math.PI * (i + 0.5)) / n);
        const vel = 0.3 + 0.16 * arch - (nt.last ? 0.06 : 0) + r.range(-0.02, 0.02);
        const inMode = this.field.includes(mod12(nt.m));
        const t = nt.t + r.gauss() * 0.008;
        this.events.push({
          t,
          inst: 'clarinet',
          midi: nt.m,
          vel,
          dur: nt.d + 0.06,
          opts: { attack: inMode ? 0.16 : 0.12, release: nt.last ? 1.4 : 0.45 },
        });
        const tv = tVoice(nt.m, triad, 'inferior', 1);
        this.events.push({
          t: nt.t + 0.02,
          inst: 'harp',
          midi: tv,
          vel: 0.36 + 0.06 * arch,
          dur: nt.d,
          opts: {},
        });
        if (nt.last) {
          // a rolled D-minor triad under the phrase end (T-voice, second position)
          [50, 53, 57].forEach((m, j) => {
            this.events.push({
              t: nt.t + 0.35 + j * 0.11,
              inst: 'harp',
              midi: m,
              vel: 0.3,
              dur: nt.d,
              opts: {},
            });
          });
        }
      });
    });
  }

  /** The motif: A4 D5 C5 A4 G4 (degrees 5 1 b7 5 4 of D minor pentatonic). Loops are its fragments. */
  private makeLoops(): Loop[] {
    const r = this.rng.fork('loops');
    const L = (
      period: number,
      start: number,
      notes: [number, number, number][],
      sectionsOff: string[] = [],
    ) => ({
      period,
      next: start,
      notes,
      sectionsOff,
      cycles: 0,
      r: r.fork(period),
    });
    const A = this.sections.A;
    return [
      L(19.7, 11.5, [
        [0, 69, 0.42],
        [1.15, 74, 0.36],
      ]),
      L(
        23.3,
        16.5,
        [
          [0, 72, 0.38],
          [0.9, 69, 0.33],
          [2.0, 67, 0.3],
        ],
        ['B'],
      ),
      L(29.9, 8.5, [
        [0, 62, 0.33],
        [0.07, 69, 0.3],
      ]),
      L(
        34.1,
        A[0] + 0.564 * (A[1] - A[0]),
        [
          [0, 77, 0.3],
          [1.3, 72, 0.28],
        ],
        ['B', 'coda'],
      ),
      L(
        41.3,
        A[0] + 9.8,
        [
          [0, 50, 0.3],
          [0.12, 57, 0.26],
        ],
        ['coda'],
      ),
    ];
  }

  private sectionAt(t: number): SectionName | 'end' {
    for (const k of ['intro', 'A', 'B', 'A2', 'coda'] as const) {
      const [a, b] = this.sections[k];
      if (t >= a && t < b) return k;
    }
    return 'end';
  }

  schedule(t0abs: number, t1abs: number): void {
    const t0 = t0abs - this.T0;
    const t1 = t1abs - this.T0;
    const activity = this.host.state.activity;
    // form-level events
    while (this.cursorIdx < this.events.length && (this.events[this.cursorIdx] as NoteEvent).t < t1) {
      const ev = this.events[this.cursorIdx++] as NoteEvent;
      if (ev.t >= t0 - 0.05) this.play({ ...ev, t: this.T0 + Math.max(ev.t, t0) });
    }
    // loops
    for (let li = 0; li < this.loops.length; li++) {
      const lp = this.loops[li] as Loop;
      while (lp.next < t1) {
        const t = lp.next;
        lp.next += lp.period;
        lp.cycles++;
        const sec = this.sectionAt(t);
        if (t > this.D - 7 || lp.sectionsOff.includes(sec)) continue;
        // activity thins the loops a little when the factory is quiet (never below two loops)
        if (li >= 3 && activity < 0.25 && lp.r.chance(0.5)) continue;
        const field = this.field;
        const soft = sec === 'B' ? 0.8 : 1;
        for (const [dt, m, v] of lp.notes) {
          const mm = remap(m, field);
          const tt = this.T0 + t + dt + lp.r.gauss() * 0.012;
          const vel = (v + lp.r.range(-0.035, 0.035)) * soft;
          this.play({ t: tt, inst: 'piano', midi: mm, vel, dur: 8.5, opts: {} });
        }
        // mutation: now and then one note moves one field step (In C-style drift)
        if (lp.cycles % 3 === 0 && lp.r.chance(0.45) && lp.notes.length > 1) {
          const k = lp.r.int(1, lp.notes.length - 1);
          const n = lp.notes[k] as [number, number, number];
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
        const midi = r.pick(pool);
        const vel = r.range(0.14, 0.26);
        this.play({ t: this.T0 + t, inst: 'glock', midi, vel, dur: 3, opts: {} });
      }
    }
    // activity layer: a slow harp arpeggio in A2 when the factory is busy
    const [a2s, a2e] = this.sections.A2;
    if (activity > 0.4) {
      const step = this.beat / 2;
      if (this.arpT == null) this.arpT = a2s + 0.5 * this.beat;
      // Deviation from the prototype: when activity rises after A2 has begun, the arpeggio joins at the
      // present instead of replaying (and dropping) the notes it missed. The pattern's phase is unchanged.
      if (this.arpT < t0) this.arpT += Math.ceil((t0 - this.arpT) / step) * step;
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
        this.play({
          t: this.T0 + t + this.rng.gauss() * 0.006,
          inst: 'harp',
          midi: pool[idx] as number,
          vel: 0.2 + 0.12 * Math.sin(Math.PI * phase),
          dur: 2,
          opts: {},
        });
      }
    }
  }

  done(now: number): boolean {
    return now - this.T0 > this.D + 8;
  }
}

export const ERA1: PieceSpec = {
  id: 'era1',
  layout: ERA1_LAYOUT,
  create: (host, params) => new Era1Piece(host, params),
};
