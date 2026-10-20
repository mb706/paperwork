// The conductor: which piece plays when, with which parameters, from the game state.
// Pure decisions (no audio), so the rules can be tested over a simulated twelve-hour game.
//
// Rules (DIRECTION.md, Adaptivity):
// 1. The first piece of every game is the charter piece: Era I, seed 1945, home key, 150 s.
// 2. Pieces alternate with silences. A piece lasts 3-6 min; a silence 1.5-3.5 min, a little shorter
//    when the factory is busy. Music therefore sounds about two-thirds of the time.
// 3. The era is chosen from the Literature year when a piece starts, never in the middle of one:
//    the instruments are those that existed in the year the factory's research has reached.
// 4. Each piece gets its own seed, a key one step around the circle of fifths from the last, a
//    tempo within +-5% and a form variant. No two pieces of a game are the same, except rule 1.
// 5. Closure (the first System card written by a Research hall) interrupts whatever plays: a 6 s
//    fade, then the convergence canon and the takeoff, which runs without silences and follows the
//    doubling time until victory.
// 6. After victory, one minute of silence, then the charter piece once more: same notes, played
//    by the machine (quantised, FM piano). The game's one musical callback (08-text P6). Then rule 2.

import { makeRng } from './rng.js';

/** Literature year -> era piece. Instruments enter the soundtrack the year they entered music. */
export const ERAS = [
  { from: -Infinity, piece: 'era1', name: 'Relays and tubes' }, // acoustic: piano, strings, clarinet, harp
  { from: 1957, piece: 'era2', name: 'Tape and oscillators' }, // MUSIC I (Mathews, 1957); EMT 140 plate; tape
  { from: 1983, piece: 'era3', name: 'FM and MIDI' }, // Yamaha DX7 and MIDI 1.0 (both 1983); FM (Chowning, 1973)
  { from: 2000, piece: 'era4', name: 'Samples and grains' }, // sampling and granular synthesis in software
  { from: 2017, piece: 'era4', name: 'The corpus' }, // era4's rules fed with the soundtrack's own earlier music
];

export const eraFor = (literatureYear) => {
  let e = ERAS[0];
  for (const x of ERAS) if (literatureYear >= x.from) e = x;
  return e;
};

export class Conductor {
  constructor({ seed = 1, available = ['era1', 'era2', 'takeoff'] } = {}) {
    this.rng = makeRng(seed ^ 0x5eed);
    this.available = new Set(available);
    this.program = []; // [{start, end, kind: 'piece'|'silence'|'fade', piece, params}]
    this.index = 0;
    this.transpose = 0;
    this.phase = 'normal'; // 'normal' | 'takeoff' | 'after'
    this.cursor = 0; // end time of the last programmed segment
  }

  /** Advance the program up to time t (seconds of game time) given the current state. */
  update(t, state) {
    if (state.closure && this.phase === 'normal') {
      // rule 5: cut the current segment short, fade, then the takeoff until victory
      const cur = this.program[this.program.length - 1];
      if (cur && cur.end > t) {
        cur.end = t;
        if (cur.kind === 'piece') this.push({ start: t, end: t + 6, kind: 'fade' });
      }
      const s = Math.max(t, this.cursor);
      this.push({ start: s, end: Infinity, kind: 'piece', piece: 'takeoff', params: { seed: 2024 } });
      this.phase = 'takeoff';
    }
    if (state.victory && this.phase === 'takeoff') {
      const cur = this.program[this.program.length - 1];
      cur.end = t + 15; // the cloud stops, the reverb, the last low D
      this.push({ start: t + 15, end: t + 75, kind: 'silence' });
      this.push({ start: t + 75, end: t + 225, kind: 'piece', piece: 'era1', params: { seed: 1945, transpose: 0, machine: true } });
      this.phase = 'after';
    }
    if (this.phase === 'takeoff') return;
    while (this.cursor <= t) {
      const last = this.program[this.program.length - 1];
      if (!last) {
        this.push({ start: 0, end: 150, kind: 'piece', piece: 'era1', params: { seed: 1945, transpose: 0, duration: 150 } });
        continue;
      }
      if (last.kind === 'piece' || last.kind === 'fade') {
        const act = state.activity ?? 0.5;
        const len = this.rng.range(90, 210) * (1.2 - 0.4 * act);
        this.push({ start: this.cursor, end: this.cursor + len, kind: 'silence' });
        continue;
      }
      const era = eraFor(state.literatureYear ?? 1945);
      const piece = this.available.has(era.piece) ? era.piece : [...this.available].filter((p) => p !== 'takeoff').pop();
      const step = this.rng.weighted([[5, 3], [-5, 3], [7, 2], [-7, 2], [0, 1], [2, 1], [-2, 1]]);
      this.transpose = ((this.transpose + step + 5 + 120) % 12) - 5; // stay within -5..+6 semitones
      const duration = this.rng.range(180, 360);
      this.push({
        start: this.cursor,
        end: this.cursor + duration,
        kind: 'piece',
        piece,
        era: era.name,
        params: { seed: this.rng.int(1, 2 ** 30), transpose: this.transpose, tempoScale: this.rng.range(0.95, 1.05), duration },
      });
    }
  }

  push(seg) {
    this.program.push(seg);
    this.cursor = seg.end;
  }

  /** The segment playing at time t. */
  at(t) {
    for (let i = this.program.length - 1; i >= 0; i--) if (this.program[i].start <= t) return this.program[i];
    return null;
  }
}
