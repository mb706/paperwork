// Pitch and harmony for the rule sets (A4 `engine/theory.js`, ported exactly; DIRECTION §4.1). Pitches are
// MIDI numbers (fractional allowed); pitch classes are 0..11. The operation order follows the prototype,
// so that a port renders the same notes from the same seed.
import type { Rng } from './rng.ts';

export const mod12 = (x: number): number => ((x % 12) + 12) % 12;
export const pcOf = (m: number): number => mod12(Math.round(m));

/** Major pentatonic on a root pitch class: 0 2 4 7 9. No semitones, no tritone. */
export const pentatonic = (rootPc: number): number[] => [0, 2, 4, 7, 9].map((i) => mod12(rootPc + i));
/** The diatonic (major) collection that contains pentatonic(rootPc): adds the 4th and 7th. */
export const diatonicOf = (rootPc: number): number[] => [0, 2, 4, 5, 7, 9, 11].map((i) => mod12(rootPc + i));

/** All MIDI notes in [lo, hi] whose pitch class is in pcs, ascending. */
export function notesIn(pcs: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(lo); m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
  return out;
}

/** The nearest note to m with its pitch class in pcs. dir: 0 nearest (ties up), −1 at or below, +1 at or above. */
export function nearestIn(m: number, pcs: readonly number[], dir = 0): number {
  for (let d = 0; d < 12; d++) {
    const up = m + d;
    const dn = m - d;
    if (dir >= 0 && pcs.includes(mod12(up))) return up; // a tie goes up
    if (dir <= 0 && pcs.includes(mod12(dn))) return dn;
  }
  return m;
}

/** Step n scale degrees from m within the scale pcs. */
export function stepIn(m: number, pcs: readonly number[], n: number): number {
  let x = Math.round(m);
  const s = Math.sign(n);
  for (let k = 0; k < Math.abs(n); k++) {
    x += s;
    while (!pcs.includes(mod12(x))) x += s;
  }
  return x;
}

/** Remap a note into a new pitch-class set by the smallest move (ties up): what a field change does. */
export const remap = (m: number, pcs: readonly number[]): number =>
  pcs.includes(mod12(m)) ? m : nearestIn(m, pcs, 0);

/**
 * Tintinnabuli (Pärt, 1976): the T-voice sounds the nearest tone of a triad on one side of the M-voice.
 * rank 1 is the nearest, 2 the second nearest; never the unison.
 */
export function tVoice(
  m: number,
  triadPcs: readonly number[],
  position: 'inferior' | 'superior' = 'inferior',
  rank = 1,
): number {
  let x = Math.round(m);
  const s = position === 'superior' ? 1 : -1;
  let found = 0;
  for (let k = 1; k <= 24; k++) {
    x += s;
    if (triadPcs.includes(mod12(x))) {
      found++;
      if (found === rank) return x;
    }
  }
  return m;
}

/**
 * Additive phrases toward a centre (the scheme of Pärt's *Spiegel im Spiegel*, on our own modes and
 * rhythms): phrase k has `lens[k]` notes; even phrases climb to the centre from below, odd ones descend
 * to it from above.
 */
export function towardCentrePhrases(
  centre: number,
  scalePcs: readonly number[],
  count: number,
  firstLen = 2,
  lens: readonly number[] | null = null,
): number[][] {
  const phrases: number[][] = [];
  for (let k = 0; k < count; k++) {
    const len = lens ? (lens[k % lens.length] as number) : firstLen + k;
    const fromBelow = k % 2 === 0;
    const start = stepIn(centre, scalePcs, fromBelow ? -(len - 1) : len - 1);
    const ph: number[] = [];
    for (let i = 0; i < len; i++) ph.push(stepIn(start, scalePcs, fromBelow ? i : -i));
    phrases.push(ph);
  }
  return phrases;
}

export interface VoiceOpts {
  /** How many of `upper`'s first pitch classes must sound (default: one per range). */
  need?: number | undefined;
  /** A composed top line: the highest voice is fixed to this note. */
  top?: number | null | undefined;
  /** Pull the top voice toward this register. */
  topTarget?: number | undefined;
  /** The previous chord's bass, for the frozen-structure and parallel rules. */
  prevBass?: number | null | undefined;
  /** Melody notes sounding with the chord: never a minor second or ninth against them. */
  avoid?: readonly number[] | undefined;
  /** Make `avoid` a hard constraint instead of a cost. */
  hardAvoid?: boolean | undefined;
  /** false allows adjacent upper voices a semitone apart. */
  noMinorSeconds?: boolean | undefined;
}

/**
 * Voice a chord for an ensemble (DIRECTION §4.1, "Voicing"): an exhaustive search over the voices' ranges
 * for the smallest total motion, top voice weighted most. bass: the lowest voice (fixed). upper: candidate
 * pitch classes for the other voices, by preference. ranges: one [lo, hi] per upper voice, lowest first.
 * prev: the previous upper voicing, or null. Hard rules: no crossing, adjacent upper voices within an
 * octave, no unisons, the low-interval limits (nothing within a fifth of a bass below C3, nothing within
 * an octave of a bass below E2, no third or smaller below E3).
 */
export function voiceChord(
  bass: number,
  upper: readonly number[],
  ranges: readonly (readonly [number, number])[],
  prev: readonly number[] | null,
  rng: Rng | null,
  opts: VoiceOpts = {},
): number[] | null {
  const need = Math.min(opts.need ?? ranges.length, upper.length);
  const required = upper.slice(0, need);
  const cands = ranges.map(([lo, hi]) => notesIn(upper, lo, hi));
  if (opts.top != null) cands[cands.length - 1] = [opts.top];
  let best: number[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const pick: number[] = new Array<number>(ranges.length);
  const rec = (i: number): void => {
    if (i === ranges.length) {
      const pcs = pick.map(mod12);
      for (const r of required) if (!pcs.includes(r)) return;
      // hard avoidance: no minor second or ninth against a melody note sounding with this chord
      if (opts.hardAvoid)
        for (const n of opts.avoid ?? []) for (const m of pick) if (Math.abs(n - m) % 12 === 1) return;
      const cost = voicingCost(bass, pick, prev, opts) + (rng ? rng.next() * 0.3 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = pick.slice();
      }
      return;
    }
    for (const m of cands[i] as number[]) {
      if (i === 0) {
        const iv = m - bass;
        if (iv <= 0) continue;
        if (bass < 48 && iv < 7) continue; // low-interval limit
        if (bass < 40 && iv < 12) continue;
      } else {
        const below = pick[i - 1] as number;
        const iv = m - below;
        if (iv <= 0 || iv > 12) continue;
        if (below < 52 && iv < 5) continue; // no thirds (or seconds) below E3
        if (iv === 1 && opts.noMinorSeconds !== false) continue;
      }
      pick[i] = m;
      rec(i + 1);
    }
  };
  rec(0);
  return best;
}

function voicingCost(
  bass: number,
  v: readonly number[],
  prev: readonly number[] | null,
  opts: VoiceOpts,
): number {
  let c = 0;
  // movement from the previous voicing; when the number of voices changes, align the tops
  if (prev) {
    const off = prev.length - v.length;
    for (let i = 0; i < v.length; i++) {
      const pi = i + off;
      const p = prev[Math.max(0, Math.min(prev.length - 1, pi))] as number;
      c += Math.abs((v[i] as number) - p) * (i === v.length - 1 ? 1.4 : 1);
    }
  }
  // the lowest upper voice should define the chord: root, third or fifth above the bass
  if (![0, 3, 4, 7].includes(mod12((v[0] as number) - bass))) c += 3;
  if (prev && opts.prevBass != null && opts.prevBass !== bass) {
    // a frozen upper structure over a moving bass sounds like a pedal, not a progression
    if (prev.length === v.length && v.every((m, i) => m === prev[i])) c += 3;
    // no parallel fifths or octaves against the bass
    const db = bass - opts.prevBass;
    for (let i = 0; i < Math.min(v.length, prev.length); i++) {
      const dv = (v[i] as number) - (prev[i] as number);
      const a = mod12((prev[i] as number) - opts.prevBass);
      const b = mod12((v[i] as number) - bass);
      if (dv !== 0 && Math.sign(dv) === Math.sign(db) && a === b && (a === 0 || a === 7)) c += 5;
    }
  }
  // prefer open, even spacing in the middle; penalise crowding in the low-mid register
  for (let i = 1; i < v.length; i++) {
    const iv = (v[i] as number) - (v[i - 1] as number);
    if (iv < 3) c += 2.5;
    if ((v[i - 1] as number) < 55 && iv < 7) c += 1.5;
  }
  // keep the top voice near a target register if given
  if (opts.topTarget != null) c += Math.abs((v[v.length - 1] as number) - opts.topTarget) * 0.35;
  // never a minor second or minor ninth against a melody note
  for (const n of opts.avoid ?? [])
    for (const m of v) {
      const iv = Math.abs(n - m);
      if (iv % 12 === 1 && (n > m ? n - m : m - n) > 0 && mod12(Math.max(n, m) - Math.min(n, m)) === 1)
        c += 9;
    }
  // avoid a minor ninth between any voice and a lower one
  for (let i = 0; i < v.length; i++) {
    for (let j = 0; j < i; j++) if (mod12((v[i] as number) - (v[j] as number)) === 1) c += 6;
    if (mod12((v[i] as number) - bass) === 1) c += 6;
  }
  return c;
}

export interface TopLineChord {
  pcs: readonly number[];
  target: number;
  /** The voice rested before this chord: it may come back anywhere. */
  reenter?: boolean | undefined;
}

/**
 * A composed top line through a chord sequence (DIRECTION §4.1): for each chord the allowed note nearest a
 * contour target, preferring steps to leaps and moving rather than repeating.
 */
export function topLine(
  chords: readonly TopLineChord[],
  range: readonly [number, number],
  start: number | null = null,
): number[] {
  const out: number[] = [];
  let prev = start;
  for (const c of chords) {
    if (c.reenter) prev = null;
    const cands = notesIn(c.pcs, range[0], range[1]);
    let best = cands[0] as number;
    let bc = Number.POSITIVE_INFINITY;
    for (const m of cands) {
      let cost = Math.abs(m - c.target) * 0.8;
      if (prev != null) {
        const d = Math.abs(m - prev);
        cost += d > 5 ? 3 + d : d * 0.4;
        if (d === 0) cost += 1.2;
      }
      if (cost < bc) {
        bc = cost;
        best = m;
      }
    }
    out.push(best);
    prev = best;
  }
  return out;
}

/**
 * The consonant set over a drone (DIRECTION §4.1 and §4.2, the user's round-1 fix): pitch classes from
 * the field, plus the drone's root and fifth, that form no second and no tritone with the root, the fifth
 * or each other, and no semitone or tritone with a persistent layer (a loop). Sustained voices over a
 * drone (organ, pads) use only this set, because an echo or a held pad stacks every note it plays into one
 * chord. Over A with the C pentatonic field: A C E; over F: A C; over G: G D.
 */
export function consonantSet(
  rootPc: number,
  field: readonly number[],
  persistent: readonly number[] = [],
): number[] {
  const ic = (a: number, b: number) => Math.min(mod12(a - b), mod12(b - a));
  const harsh = (a: number, b: number) => [1, 2, 6].includes(ic(a, b));
  const fifth = mod12(rootPc + 7);
  const prefer = [0, 7, 3, 4, 9, 8, 5].map((iv) => mod12(rootPc + iv)); // root, fifth, thirds, sixths, fourth
  const cands = [...new Set([rootPc, fifth, ...field])].filter(
    (pc) => !harsh(pc, rootPc) && !harsh(pc, fifth) && persistent.every((q) => ![1, 6].includes(ic(pc, q))),
  );
  const out: number[] = [];
  for (const pc of prefer) if (cands.includes(pc) && out.every((q) => !harsh(pc, q))) out.push(pc);
  return out;
}

/** The equal-tempered MIDI value of a just interval above a note (drones, spectral chords). */
export const justAbove = (m: number, ratio: number): number => m + 12 * Math.log2(ratio);
