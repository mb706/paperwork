// Decoding projection records into UI state (10 §7.3, §15.5), as plain data: the reactive stores (store/game.ts)
// only copy what these functions return into Solid stores. Kept free of Solid so Vitest can run them in Node on
// the golden set's records (test/golden/m0/projections/).
//
// Rules carried from §15.5 and the golden README:
//   - a record arrives only when its body changed; `version` counts records per sub_id across replacements;
//   - status 1 (gone): the target no longer exists and the subscription is dropped: its window closes;
//   - status 2 (invalid): a developer reason (unsupported, bad parameters, over a limit); logged, not shown;
//   - STATS series arrive whole after subscribing, a parameter change or a ring change, and otherwise as the
//     points appended since the previous record: `from` continuing the held series appends, anything else
//     replaces (rule 26).
import {
  decodeProjection,
  type Projection,
  type StatSeries,
  type UiRecord,
} from '../../shared/gen/projections.ts';
import type { SlotView } from '../../shared/gen/types.ts';

export const SERIES_POINTS = 300;

export type RecordOutcome =
  | { status: 'ok'; projection: Projection }
  | { status: 'gone' }
  | { status: 'invalid'; reason: number };

/** One UI record's outcome: its decoded projection, or why there is none. */
export function readRecord(r: UiRecord): RecordOutcome {
  if (r.status === 1) return { status: 'gone' };
  if (r.status === 2) {
    const v = new DataView(r.body.buffer, r.body.byteOffset, r.body.byteLength);
    return { status: 'invalid', reason: r.body.byteLength >= 2 ? v.getUint16(0, true) : 0 };
  }
  return { status: 'ok', projection: decodeProjection(r.kind, r.body) };
}

/** A key's held series: points from `from` (mod 65,536), oldest first. */
export interface HeldSeries {
  from: number;
  produced: number[];
  consumed: number[];
}

/** Merges a record's series into what the UI holds (rule 26): a continuation appends, anything else replaces. */
export function mergeSeries(held: HeldSeries | undefined, s: StatSeries): HeldSeries {
  if (held && ((held.from + held.produced.length) & 0xffff) === s.from && s.produced.length > 0) {
    const produced = [...held.produced, ...s.produced];
    const consumed = [...held.consumed, ...s.consumed];
    const drop = produced.length > SERIES_POINTS ? produced.length - SERIES_POINTS : 0;
    return {
      from: (held.from + drop) & 0xffff,
      produced: drop > 0 ? produced.slice(drop) : produced,
      consumed: drop > 0 ? consumed.slice(drop) : consumed,
    };
  }
  if (held && s.produced.length === 0 && ((held.from + held.produced.length) & 0xffff) === s.from)
    return held;
  return { from: s.from, produced: Array.from(s.produced), consumed: Array.from(s.consumed) };
}

export interface StatsView {
  precision: number;
  tab: number;
  /** Totals over the precision's window, by StatKey. */
  totals: Map<number, { produced: number; consumed: number }>;
  series: Map<number, HeldSeries>;
}

/** Applies a STATS record to the held statistics of one subscription. */
export function applyStats(prev: StatsView | null, p: Projection & { kind: 'STATS' }): StatsView {
  const same = prev !== null && prev.precision === p.precision && prev.tab === p.tab;
  const totals = new Map<number, { produced: number; consumed: number }>();
  for (const e of p.entries) totals.set(e.key, { produced: e.produced, consumed: e.consumed });
  const series = new Map<number, HeldSeries>(same ? prev.series : []);
  for (const s of p.series) series.set(s.key, mergeSeries(series.get(s.key), s));
  return { precision: p.precision, tab: p.tab, totals, series };
}

/** StatKey (§5.20): (StatKind << 24) | id. */
export const statKind = (key: number): number => key >>> 24;
export const statId = (key: number): number => key & 0xffffff;

/** The window of a statistics precision in seconds (I §4.12: 5 s … 1000 h; All: null). */
export const PRECISION_SECONDS: readonly (number | null)[] = [
  5,
  60,
  600,
  3600,
  36000,
  180000,
  900000,
  3600000,
  null,
];

/** The hand as the UI shows it (I §3.2). */
export interface HandView {
  key: number;
  count: number;
  /** The origin slot in the main inventory (the hand marker), or −1. */
  origin: number;
  ghost: boolean;
}

export const CHAR_FLAG = { online: 1, handGhost: 2, mining: 4, autoSort: 8, pickGhost: 16 } as const;

export function handOf(c: Projection & { kind: 'CHARACTER' }): HandView {
  const ghost = (c.flags & CHAR_FLAG.handGhost) !== 0;
  return {
    key: c.hand_key,
    count: c.hand_count,
    origin: c.hand_origin === 0xffff ? -1 : c.hand_origin,
    ghost,
  };
}

export const EMPTY_HAND: HandView = { key: 0xffff, count: 0, origin: -1, ghost: false };

/** Total count of an item key in slots (the quickbar's count includes the hand, I §4.2). */
export function countOf(slots: readonly SlotView[], key: number): number {
  let n = 0;
  for (const s of slots) if (s.key === key) n += s.count;
  return n;
}

/**
 * How many crafts of a recipe the main inventory affords now from its direct ingredients. A UI hint only (the
 * sim clamps a request to what it can craft, I §3.9); chained intermediates join with M1's chain crafting, whose
 * count belongs in a projection (pm/reports/C5.md, open issue).
 */
export function craftableNow(
  ingredients: readonly { kind: string; id: number; amount: number }[],
  slots: readonly SlotView[],
): number {
  let can = Number.POSITIVE_INFINITY;
  for (const ing of ingredients) {
    if (ing.kind !== 'item') return 0;
    const k = Math.floor(countOf(slots, ing.id * 8) / ing.amount);
    if (k < can) can = k;
  }
  return can === Number.POSITIVE_INFINITY ? 0 : can;
}
