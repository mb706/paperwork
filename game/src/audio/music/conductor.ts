// The conductor: which piece plays when, with which parameters, from the game state (A4 `conductor.js`,
// ported exactly; DIRECTION §5). Pure decisions without audio, so the rules are tested over a simulated
// twelve-hour game.
//
// Rules (DIRECTION §5.1):
// 1. The first piece of every game is the charter piece: Era I, seed 1945, home key, 150 s.
// 2. Pieces alternate with silences. A piece lasts 3–6 min; a silence 1.5–3.5 min, a little shorter when the
//    factory is busy. Music therefore sounds about two-thirds of the time.
// 3. The era is chosen from the Literature year when a piece starts, never in the middle of one: the
//    instruments are those that existed in the year the factory's research has reached.
// 4. Each piece gets its own seed, a key one step around the circle of fifths from the last, a tempo within
//    ±5 % and a form variant. No two pieces of a game are the same, except rule 1's callback.
// 5. Closure interrupts whatever plays: a 6 s fade, then the convergence canon and the takeoff, which runs
//    without silences and follows the doubling time until victory (M4).
// 6. After victory, one minute of silence, then the charter piece once more: the same notes, played by the
//    machine (quantised, even touch). The game's one musical callback (08 P6). Then rule 2.
// The player's music keys (I §2: play-next-track, play-previous-track) step through this program.
import { makeRng, type Rng } from '../core/rng.ts';
import type { MusicState, PieceParams } from './types.ts';

export interface Era {
  /** The first Literature year of the era. */
  from: number;
  /** The rule set that plays it. */
  piece: string;
  name: string;
  /** The era's typical electric consumption (W), against which activity is normalised (10 §15.6). */
  typicalWatts: number;
}

/** Literature year → era. Instruments enter the soundtrack the year they entered music (DIRECTION §4). */
export const DEFAULT_ERAS: readonly Era[] = [
  // acoustic: piano, strings, clarinet, harp
  { from: Number.NEGATIVE_INFINITY, piece: 'era1', name: 'Relays and tubes', typicalWatts: 1e6 },
  // MUSIC I (Mathews, 1957); EMT 140 plate; tape
  { from: 1957, piece: 'era2', name: 'Tape and oscillators', typicalWatts: 1e7 },
  // Yamaha DX7 and MIDI 1.0 (both 1983); FM (Chowning, 1973)
  { from: 1983, piece: 'era3', name: 'FM and MIDI', typicalWatts: 1e8 },
  // sampling and granular synthesis in software
  { from: 2000, piece: 'era4', name: 'Samples and grains', typicalWatts: 1e9 },
  // era4's rules fed with the soundtrack's own earlier music
  { from: 2017, piece: 'era4', name: 'The corpus', typicalWatts: 1e9 },
];

export function eraFor(literatureYear: number, eras: readonly Era[] = DEFAULT_ERAS): Era {
  let e = eras[0] as Era;
  for (const x of eras) if (literatureYear >= x.from) e = x;
  return e;
}

export type SegmentKind = 'piece' | 'silence' | 'fade';

export interface Segment {
  start: number;
  end: number;
  kind: SegmentKind;
  piece?: string;
  era?: string;
  params?: PieceParams;
}

export type ConductorPhase = 'normal' | 'takeoff' | 'after';

export interface ConductorOptions {
  seed?: number;
  /** The rule sets that exist; an era whose piece is missing plays the latest one that exists. */
  available?: readonly string[];
  eras?: readonly Era[];
}

const CHARTER: PieceParams = { seed: 1945, transpose: 0, duration: 150 };

export class Conductor {
  readonly program: Segment[] = [];
  phase: ConductorPhase = 'normal';
  /** The end time of the last programmed segment. */
  cursor = 0;
  private readonly rng: Rng;
  private readonly available: Set<string>;
  private readonly eras: readonly Era[];
  private transpose = 0;

  constructor({
    seed = 1,
    available = ['era1', 'era2', 'takeoff'],
    eras = DEFAULT_ERAS,
  }: ConductorOptions = {}) {
    this.rng = makeRng(seed ^ 0x5eed);
    this.available = new Set(available);
    this.eras = eras;
  }

  /** Advance the program up to time t (seconds of the game's music clock) given the current state. */
  update(t: number, state: Partial<MusicState>): void {
    if (state.closure && this.phase === 'normal') {
      // rule 5: cut the current segment short, fade, then the takeoff until victory
      const cur = this.program[this.program.length - 1];
      if (cur && cur.end > t) {
        cur.end = t;
        if (cur.kind === 'piece') this.push({ start: t, end: t + 6, kind: 'fade' });
      }
      const s = Math.max(t, this.cursor);
      this.push({
        start: s,
        end: Number.POSITIVE_INFINITY,
        kind: 'piece',
        piece: 'takeoff',
        params: { seed: 2024 },
      });
      this.phase = 'takeoff';
    }
    if (state.victory && this.phase === 'takeoff') {
      const cur = this.program[this.program.length - 1] as Segment;
      cur.end = t + 15; // the cloud stops, the reverb, the last low D
      this.push({ start: t + 15, end: t + 75, kind: 'silence' });
      this.push({
        start: t + 75,
        end: t + 225,
        kind: 'piece',
        piece: 'era1',
        params: { seed: 1945, transpose: 0, machine: true },
      });
      this.phase = 'after';
    }
    if (this.phase === 'takeoff') return;
    while (this.cursor <= t) {
      const last = this.program[this.program.length - 1];
      if (!last) {
        this.push({ start: 0, end: 150, kind: 'piece', piece: 'era1', params: { ...CHARTER } });
        continue;
      }
      if (last.kind === 'piece' || last.kind === 'fade') {
        const act = state.activity ?? 0.5;
        const len = this.rng.range(90, 210) * (1.2 - 0.4 * act);
        this.push({ start: this.cursor, end: this.cursor + len, kind: 'silence' });
        continue;
      }
      this.push(this.nextPiece(this.cursor, state));
    }
  }

  /** Rules 3 and 4: the next piece, starting at `start`. */
  private nextPiece(start: number, state: Partial<MusicState>): Segment {
    const era = eraFor(state.literatureYear ?? 1945, this.eras);
    const piece = this.available.has(era.piece)
      ? era.piece
      : ([...this.available].filter((p) => p !== 'takeoff').pop() as string);
    const step = this.rng.weighted<number>([
      [5, 3],
      [-5, 3],
      [7, 2],
      [-7, 2],
      [0, 1],
      [2, 1],
      [-2, 1],
    ]);
    this.transpose = ((this.transpose + step + 5 + 120) % 12) - 5; // stay within -5..+6 semitones
    const duration = this.rng.range(180, 360);
    const seed = this.rng.int(1, 2 ** 30);
    const tempoScale = this.rng.range(0.95, 1.05);
    return {
      start,
      end: start + duration,
      kind: 'piece',
      piece,
      era: era.name,
      params: { seed, transpose: this.transpose, tempoScale, duration },
    };
  }

  private push(seg: Segment): void {
    this.program.push(seg);
    this.cursor = seg.end;
  }

  /** The segment playing at time t. */
  at(t: number): Segment | null {
    for (let i = this.program.length - 1; i >= 0; i--)
      if ((this.program[i] as Segment).start <= t) return this.program[i] as Segment;
    return null;
  }

  /**
   * A piece that cannot start yet (its samples are still decoding) waits: the silence is extended
   * (10 §9.4, "Late audio"). Only the last segment, the one being entered, can be postponed.
   */
  postpone(seg: Segment, start: number): void {
    if (seg !== this.program[this.program.length - 1] || start <= seg.start) return;
    const len = seg.end - seg.start;
    const prev = this.program[this.program.length - 2];
    if (prev && prev.end === seg.start) prev.end = start;
    seg.start = start;
    seg.end = start + len;
    this.cursor = seg.end;
  }

  /**
   * play-next-track (I §2): the current segment ends at t and the next piece starts at once, skipping the
   * silence. Outside the normal rotation (the takeoff, the callback's silence) it does nothing.
   */
  skip(t: number, state: Partial<MusicState>): Segment | null {
    if (this.phase === 'takeoff') return null;
    this.cutAt(t);
    const seg = this.nextPiece(t, state);
    this.push(seg);
    return seg;
  }

  /** play-previous-track (I §2): the given earlier piece once more, from its beginning, at t. */
  replay(t: number, previous: Segment): Segment | null {
    if (this.phase === 'takeoff' || previous.kind !== 'piece') return null;
    this.cutAt(t);
    const len = previous.params?.duration ?? previous.end - previous.start;
    const seg: Segment = { ...previous, start: t, end: t + len, params: { ...previous.params } };
    this.push(seg);
    return seg;
  }

  private cutAt(t: number): void {
    // segments programmed after t are dropped; the one playing ends now
    while (this.program.length > 0 && (this.program[this.program.length - 1] as Segment).start > t)
      this.program.pop();
    const cur = this.program[this.program.length - 1];
    if (cur && cur.end > t) cur.end = t;
    this.cursor = t;
  }
}
