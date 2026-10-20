// The fake sim's production statistics (10 §5.20, §15.5 STATS; the golden set's README rule 26): the same
// rings as the reference model (test/golden/model/stats.ts), restated over the fake's own data, so the UI
// sees the real semantics: exact all-time totals, eight fixed precisions of 300 points, and the `all` ring,
// which starts at 60 ticks a point and doubles (merging pairs of points as f32 sums) whenever it fills.
import {
  type StatEntry,
  type StatSeries,
  StatsCodec,
  type SubRequest,
  UiInvalidReason,
} from '../../shared/gen/projections.ts';
import { StatKind } from '../../shared/gen/types.ts';

export const RING_POINTS = 300;
/** Ticks per point of precisions 0–7 (5 s … 1,000 h): each window is 300 points. */
export const TICKS_PER_POINT = [1, 12, 120, 720, 7200, 36000, 180000, 720000] as const;
/** Precision 8, `all`: 60 ticks a point at first, doubling whenever its 300 points fill. */
export const ALL_PRECISION = 8;
const ALL_START = 60;

export interface Ring {
  precision: number;
  /** Points written so far (the stream index of the next one). */
  points: number;
  accCount: number;
  accProduced: number;
  accConsumed: number;
  produced: number[];
  consumed: number[];
  /** `all` only: how many times the ring has doubled (its points were merged); series restart after one. */
  doublings: number;
}

export interface StatRecord {
  key: number;
  producedTotal: number;
  consumedTotal: number;
  rings: Ring[];
}

/** The span of a point of the `all` ring after tick t: 60 × 2^m. */
export function allSpan(t: number): number {
  let s = ALL_START;
  while (RING_POINTS * s <= t) s *= 2;
  return s;
}

function emptyRing(precision: number, points: number, accCount: number): Ring {
  return {
    precision,
    points,
    accCount,
    accProduced: 0,
    accConsumed: 0,
    produced: new Array(RING_POINTS).fill(0),
    consumed: new Array(RING_POINTS).fill(0),
    doublings: 0,
  };
}

/** A key first counted in tick t: rings aligned to the global grid, as if it had existed since tick 0. */
function newRecord(key: number, t: number): StatRecord {
  const rings = TICKS_PER_POINT.map((T, p) => emptyRing(p, Math.floor((t - 1) / T), (t - 1) % T));
  const S = allSpan(t - 1);
  const all = emptyRing(ALL_PRECISION, Math.floor((t - 1) / S), (t - 1) % S);
  // The doublings a ring born now has missed: so a series of it restarts no more often than others'.
  for (let s = ALL_START; s < S; s *= 2) all.doublings++;
  rings.push(all);
  return { key, producedTotal: 0, consumedTotal: 0, rings };
}

function push(r: Ring, T: number, produced: number, consumed: number): void {
  r.accProduced += produced;
  r.accConsumed += consumed;
  r.accCount += 1;
  if (r.accCount < T) return;
  const i = r.points % RING_POINTS;
  r.produced[i] = Math.fround(r.accProduced);
  r.consumed[i] = Math.fround(r.accConsumed);
  r.points += 1;
  r.accProduced = 0;
  r.accConsumed = 0;
  r.accCount = 0;
}

/** The `all` ring's doubling: pairs of points merge (f32 sums); 300 points become 150 of twice the span. */
function halve(r: Ring): void {
  for (let i = 0; i < RING_POINTS / 2; i++) {
    r.produced[i] = Math.fround((r.produced[2 * i] as number) + (r.produced[2 * i + 1] as number));
    r.consumed[i] = Math.fround((r.consumed[2 * i] as number) + (r.consumed[2 * i + 1] as number));
  }
  for (let i = RING_POINTS / 2; i < RING_POINTS; i++) {
    r.produced[i] = 0;
    r.consumed[i] = 0;
  }
  r.points = RING_POINTS / 2;
  r.doublings += 1;
}

/** Every key's totals and rings (phase 15 of the real sim). */
export class Stats {
  readonly records = new Map<number, StatRecord>();

  /** Tick t: every key counted this tick gets a record; every record advances by the tick. */
  flush(t: number, produced: ReadonlyMap<number, number>, consumed: ReadonlyMap<number, number>): void {
    for (const k of [...produced.keys(), ...consumed.keys()])
      if (!this.records.has(k)) this.records.set(k, newRecord(k, t));
    const S = allSpan(t - 1);
    for (const s of [...this.records.values()].sort((a, b) => a.key - b.key)) {
      const p = produced.get(s.key) ?? 0;
      const q = consumed.get(s.key) ?? 0;
      s.producedTotal += p;
      s.consumedTotal += q;
      TICKS_PER_POINT.forEach((T, i) => {
        push(s.rings[i] as Ring, T, p, q);
      });
      const all = s.rings[ALL_PRECISION] as Ring;
      push(all, S, p, q);
      if (all.points === RING_POINTS) halve(all);
    }
  }
}

/** A precision's window total: its 300 points plus the open accumulator; `all` is the exact total. */
function windowTotal(r: Ring, which: 'produced' | 'consumed', exact: number): number {
  if (r.precision === ALL_PRECISION) return exact;
  let s = 0;
  const from = r.points > RING_POINTS ? r.points - RING_POINTS : 0;
  for (let j = from; j < r.points; j++) s += r[which][j % RING_POINTS] as number;
  return s + (which === 'produced' ? r.accProduced : r.accConsumed);
}

/** What a STATS subscription keeps between records: per key, the next point to send and the ring's doublings. */
export type SeriesState = Map<number, { next: number; doublings: number }>;

/** The keys a STATS request reports: its tail's (u32 StatKeys, at most 256), else every key of its tab. */
export function statsKeys(stats: Stats, req: SubRequest): number[] | null {
  const tail = (req.flags & 1) !== 0 ? req.tail : undefined;
  if (tail && tail.length > 0) {
    if (tail.length % 4 !== 0 || tail.length / 4 > 256) return null;
    const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const ks = new Set<number>();
    for (let i = 0; i < tail.length; i += 4) ks.add(v.getUint32(i, true));
    return [...ks].sort((a, b) => a - b);
  }
  const kind = [StatKind.item, StatKind.fluid, StatKind.entity, StatKind.heat][req.p1] as number;
  return [...stats.records.keys()].filter((k) => Math.floor(k / 0x1000000) === kind).sort((a, b) => a - b);
}

/**
 * A STATS record (§15.5): per key the totals over the precision's window and, with p2 bit 0, for the first 24
 * keys the 300-point series, whole first, then only the points appended since the previous record. After an
 * `all` ring doubles, its series is whole again (its old points were merged).
 */
export function statsRecord(
  stats: Stats,
  req: SubRequest,
  series: SeriesState | null,
): { body: Uint8Array; next: SeriesState } | { reason: number } {
  if (req.p0 > 8 || req.p1 > 3 || (req.p2 & ~1) !== 0) return { reason: UiInvalidReason.bad_parameters };
  const ks = statsKeys(stats, req);
  if (!ks) return { reason: UiInvalidReason.bad_parameters };
  const entries: StatEntry[] = ks.map((key) => {
    const s = stats.records.get(key);
    const r = s?.rings[req.p0];
    return s && r
      ? {
          key,
          produced: windowTotal(r, 'produced', s.producedTotal),
          consumed: windowTotal(r, 'consumed', s.consumedTotal),
        }
      : { key, produced: 0, consumed: 0 };
  });
  const out: StatSeries[] = [];
  const next: SeriesState = new Map(series ?? []);
  if ((req.p2 & 1) !== 0)
    for (const key of ks.slice(0, 24)) {
      const r = stats.records.get(key)?.rings[req.p0];
      const points = r?.points ?? 0;
      const doublings = r?.doublings ?? 0;
      const oldest = points > RING_POINTS ? points - RING_POINTS : 0;
      const sent = series?.get(key);
      const want = sent && sent.doublings === doublings ? sent.next : 0;
      const from = want > oldest ? want : oldest;
      const produced: number[] = [];
      const consumed: number[] = [];
      for (let j = from; j < points && r; j++) {
        produced.push(r.produced[j % RING_POINTS] as number);
        consumed.push(r.consumed[j % RING_POINTS] as number);
      }
      out.push({ key, from: from % 65536, produced, consumed });
      next.set(key, { next: points, doublings });
    }
  return {
    body: StatsCodec.encode({ precision: req.p0, tab: req.p1, flags: req.p2, entries, series: out }),
    next,
  };
}
