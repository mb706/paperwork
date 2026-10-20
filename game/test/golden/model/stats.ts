// Production statistics (10 §5.20, I §4.12): phase 15 flushes the tick's counters into each key's exact
// totals and its display rings. §5.20 says "300 points at 9 precisions, by hierarchical downsampling"; the
// sampling below is the model's decision, written so that every key's rings follow one global time grid.
import type { Stat, StatRing } from '../../../src/shared/gen/state.ts';
import type { Counters } from './rules.ts';
import type { World } from './world.ts';

export const RING_POINTS = 300;
/**
 * Ticks per point of the eight fixed precisions (StatPrecision s5 … h1000): each window is 300 points,
 * so 5 s is one point per tick and 1 h one per 720 ticks.
 */
export const TICKS_PER_POINT = [1, 12, 120, 720, 7_200, 36_000, 180_000, 720_000] as const;
/** The precision `all` (index 8) starts at 60 ticks per point and doubles whenever its 300 points fill. */
export const ALL_PRECISION = 8;
const ALL_START = 60;

/** The span of a point of the `all` ring after tick t: 60 × 2^m, m = the doublings so far. */
export function allSpan(t: number): number {
  let s = ALL_START;
  while (RING_POINTS * s <= t) s *= 2;
  return s;
}

function emptyRing(precision: number, points: number, accCount: number): StatRing {
  return {
    precision,
    points,
    acc_count: accCount,
    acc_produced: 0,
    acc_consumed: 0,
    produced: new Array(RING_POINTS).fill(0),
    consumed: new Array(RING_POINTS).fill(0),
  };
}

/**
 * A key first counted in tick t gets rings aligned to the global grid, as if it had existed with zeros
 * since tick 0: point j of a precision of span T covers ticks j·T + 1 … (j + 1)·T.
 */
function newStat(key: number, t: number): Stat {
  const rings: StatRing[] = TICKS_PER_POINT.map((T, p) => emptyRing(p, Math.floor((t - 1) / T), (t - 1) % T));
  const S = allSpan(t - 1);
  rings.push(emptyRing(ALL_PRECISION, Math.floor((t - 1) / S), (t - 1) % S));
  return { key, produced_total: 0, consumed_total: 0, handcrafted_total: 0, rings };
}

/** Adds one tick's values to a ring of span T; a full point is written as f32 at index (point mod 300). */
function push(r: StatRing, T: number, produced: number, consumed: number): void {
  r.acc_produced += produced;
  r.acc_consumed += consumed;
  r.acc_count += 1;
  if (r.acc_count < T) return;
  const i = r.points % RING_POINTS;
  r.produced[i] = Math.fround(r.acc_produced);
  r.consumed[i] = Math.fround(r.acc_consumed);
  r.points += 1;
  r.acc_produced = 0;
  r.acc_consumed = 0;
  r.acc_count = 0;
}

/** The `all` ring's doubling: pairs of points merge (f32 sums), 300 points become 150 of twice the span. */
function halve(r: StatRing): void {
  for (let i = 0; i < RING_POINTS / 2; i++) {
    r.produced[i] = Math.fround((r.produced[2 * i] as number) + (r.produced[2 * i + 1] as number));
    r.consumed[i] = Math.fround((r.consumed[2 * i] as number) + (r.consumed[2 * i + 1] as number));
  }
  for (let i = RING_POINTS / 2; i < RING_POINTS; i++) {
    r.produced[i] = 0;
    r.consumed[i] = 0;
  }
  r.points = RING_POINTS / 2;
}

/**
 * Phase 15 of tick t (§4.6): every key with a nonzero counter this tick gets a record, and every record (all
 * keys, also those at zero this tick) advances its totals and its nine rings by this tick.
 */
export function flushStats(w: World, t: number, c: Counters): void {
  const touched = new Set<number>([...c.produced.keys(), ...c.consumed.keys(), ...c.handcrafted.keys()]);
  for (const k of touched) if (!w.stats.has(k)) w.stats.set(k, newStat(k, t));
  const S = allSpan(t - 1);
  for (const s of [...w.stats.values()].sort((a, b) => a.key - b.key)) {
    const prod = c.produced.get(s.key) ?? 0;
    const cons = c.consumed.get(s.key) ?? 0;
    s.produced_total += prod;
    s.consumed_total += cons;
    s.handcrafted_total += c.handcrafted.get(s.key) ?? 0;
    TICKS_PER_POINT.forEach((T, p) => {
      push(s.rings[p] as StatRing, T, prod, cons);
    });
    const all = s.rings[ALL_PRECISION] as StatRing;
    push(all, S, prod, cons);
    if (all.points === RING_POINTS) halve(all);
  }
}

/** The ring of a precision's newest `n` points, in stream order (oldest first). */
export function lastPoints(r: StatRing, from: number): { produced: number[]; consumed: number[] } {
  const produced: number[] = [];
  const consumed: number[] = [];
  for (let j = from; j < r.points; j++) {
    produced.push(r.produced[j % RING_POINTS] as number);
    consumed.push(r.consumed[j % RING_POINTS] as number);
  }
  return { produced, consumed };
}
