// The M0 projections and queries (10 §15.5; projections.yaml): each kind's record as the sim's writer must
// produce it, from `&World` only (D1, D9). A record that cannot be built is `gone` (its target does not
// exist) or `invalid` with a developer reason.

import { SUPPORTED_PROJECTIONS, SUPPORTED_QUERIES } from '../../../src/shared/gen/capabilities.ts';
import { Writer } from '../../../src/shared/gen/codec.ts';
import {
  CONTAINERPOOL_COLUMNS,
  ENTITYTABLE_COLUMNS,
  type EntityTableRow,
} from '../../../src/shared/gen/pools.ts';
import type {
  InspectField,
  InventoryView,
  StatEntry,
  StatSeries,
  SubRequest,
} from '../../../src/shared/gen/projections.ts';
import {
  CharacterCodec,
  DebugCodec,
  DigestResultCodec,
  EntityPanelCodec,
  HoverCodec,
  HudCodec,
  InspectResultCodec,
  InventoryCodec,
  ProjectionKind,
  QueryKind,
  StateHashCodec,
  StatsCodec,
  UiInvalidReason,
} from '../../../src/shared/gen/projections.ts';
import { MiningMode, type StatRing } from '../../../src/shared/gen/state.ts';
import { InventoryType, StatKind } from '../../../src/shared/gen/types.ts';
import { chestInv, handOrigin, mainInv, slots } from './inventory.ts';
import type { Sim } from './sim.ts';
import { ALL_PRECISION, allSpan, lastPoints, RING_POINTS, TICKS_PER_POINT } from './stats.ts';
import { NONE16, SECTION_ID, type World } from './world.ts';

export type Built = { status: 0; body: Uint8Array } | { status: 1 } | { status: 2; reason: number };

const KIND_NAME = new Map<number, string>(Object.entries(ProjectionKind).map(([k, v]) => [v as number, k]));
const QUERY_NAME = new Map<number, string>(Object.entries(QueryKind).map(([k, v]) => [v as number, k]));

/** Whether a kind is in the current capability manifest (§2.4). */
export const kindSupported = (kind: number): boolean =>
  SUPPORTED_PROJECTIONS.has((KIND_NAME.get(kind) ?? '').toUpperCase());
export const querySupported = (kind: number): boolean => SUPPORTED_QUERIES.has(QUERY_NAME.get(kind) ?? '');

/** Kinds evaluated at every packet; the others are `slow` (projections.yaml `cadence`). */
export const EVERY_PACKET = new Set<number>([
  ProjectionKind.character,
  ProjectionKind.inventory,
  ProjectionKind.entity_panel,
  ProjectionKind.hover,
  ProjectionKind.debug,
]);

const invalid = (reason: number): Built => ({ status: 2, reason });
const ok = (body: Uint8Array): Built => ({ status: 0, body });

function chestView(w: World, e: EntityTableRow): InventoryView {
  const inv = chestInv(w, e);
  return {
    inv: InventoryType.chest,
    bar: inv.bar,
    slots: slots(w, inv).map((s) => ({ key: s.key, filter: 0xffff, count: s.count })),
  };
}

/**
 * The STATS state a subscription keeps between records (§15.5: whole first, then only new points): per key, the
 * next point to send and the span its ring had when it was sent. A ring whose span changed since (the `all`
 * ring's doubling merged its points) is sent whole again (GATE-r1 finding 14; rule 26).
 */
export interface SeriesState {
  whole: boolean;
  next: Map<number, number>;
  span?: Map<number, number>;
}

/** The keys a STATS subscription reports: its tail's, or every key of its tab (model decision). */
function statsKeys(w: World, tab: number, tail: Uint8Array | undefined): number[] | null {
  if (tail && tail.length > 0) {
    if (tail.length % 4 !== 0 || tail.length / 4 > 256) return null;
    const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const ks = new Set<number>();
    for (let i = 0; i < tail.length; i += 4) ks.add(v.getUint32(i, true));
    return [...ks].sort((a, b) => a - b);
  }
  const kind = [StatKind.item, StatKind.fluid, StatKind.entity, StatKind.heat][tab] as number;
  return [...w.stats.keys()].filter((k) => Math.floor(k / 2 ** 24) === kind).sort((a, b) => a - b);
}

/**
 * A precision's window total (§15.5 STATS: "totals over the precision's window"). Model decision: the sum of
 * the window's 300 points (oldest first, as f64) plus the open accumulator; `all` is the exact all-time total.
 */
function windowTotal(r: StatRing, which: 'produced' | 'consumed', exact: number): number {
  if (r.precision === ALL_PRECISION) return exact;
  let s = 0;
  const from = r.points > RING_POINTS ? r.points - RING_POINTS : 0;
  for (let j = from; j < r.points; j++) s += r[which][j % RING_POINTS] as number;
  return s + (which === 'produced' ? r.acc_produced : r.acc_consumed);
}

/** Builds one subscription's record (`series` is read, and advanced by the caller only when it is sent). */
export function buildRecord(
  sim: Sim,
  req: SubRequest,
  series: SeriesState | null,
): { built: Built; nextSeries?: SeriesState } {
  const w = sim.w;
  if (!kindSupported(req.kind)) return { built: invalid(UiInvalidReason.unsupported) };
  switch (req.kind) {
    case ProjectionKind.hud:
      // M0: the tick only (§15.5); every other value is zero until its system exists.
      return {
        built: ok(
          HudCodec.encode({
            tick: w.tick,
            research_tech: NONE16,
            research_level: 0,
            research_progress: 0,
            takeoff_level: 0,
            flags: 0,
            field: 0,
            literature: 0,
            your_year: 0,
            years_ahead: 0,
            activity_w: 0,
            doubling_time_s: 0,
            alerts: [],
          }),
        ),
      };
    case ProjectionKind.character: {
      const p = w.player(req.target);
      // A watermark record (rule 12) has no character: the window has nothing to show.
      if (!p || p.character === 0) return { built: { status: 1 } };
      const main = mainInv(w, p);
      const origin = handOrigin(p);
      const flags =
        (p.online ? 1 : 0) |
        (p.hand.ghost ? 2 : 0) |
        (p.mining.mode !== MiningMode.none ? 4 : 0) |
        (p.auto_sort ? 8 : 0) |
        (p.pick_ghost_cursor ? 16 : 0);
      return {
        built: ok(
          CharacterCodec.encode({
            player: p.index,
            flags,
            quickbar_page: 0,
            serial: p.character,
            input_gen: p.input_gen,
            hand_origin: origin >= 0 ? origin : NONE16,
            hand_key: p.hand.key,
            hand_count: p.hand.count,
            mining_progress: p.mining.mode !== MiningMode.none ? Math.fround(p.mining.progress) : 0,
            main: slots(w, main).map((s) => ({ key: s.key, filter: 0xffff, count: s.count })),
            quickbar: [], // M0 keeps no quickbar (its actions are outside the capability manifest)
            queue: p.crafting_queue.map((e, i) => ({
              recipe: e.recipe,
              count: e.count,
              progress: i === 0 ? Math.fround(e.progress) : 0,
              flags: e.flags,
            })),
          }),
        ),
      };
    }
    case ProjectionKind.inventory: {
      const e = w.entityBySerial(req.target);
      if (!e) return { built: { status: 1 } };
      if (req.p0 !== InventoryType.chest) return { built: invalid(UiInvalidReason.bad_parameters) };
      return { built: ok(InventoryCodec.encode({ serial: e.serial, view: chestView(w, e) })) };
    }
    case ProjectionKind.entity_panel: {
      const e = w.entityBySerial(req.target);
      if (!e) return { built: { status: 1 } };
      // M0 fills a chest's fields (projections.yaml): no status, recipe, progress or energy.
      return {
        built: ok(
          EntityPanelCodec.encode({
            serial: e.serial,
            proto: e.proto,
            status: 0,
            flags: 0,
            recipe: NONE16,
            progress: 0,
            crafts_per_s: 0,
            productivity_bar: 0,
            energy_satisfaction: 0,
            energy_buffer_j: 0,
            energy_draw_w: 0,
            inventories: [chestView(w, e)],
          }),
        ),
      };
    }
    case ProjectionKind.hover: {
      const e = w.entityBySerial(req.target);
      if (!e) return { built: { status: 1 } };
      const totals = new Map<number, number>();
      for (const s of slots(w, chestInv(w, e)))
        if (s.count > 0) totals.set(s.key, (totals.get(s.key) ?? 0) + s.count);
      const contents = [...totals.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, count]) => ({ key, count }));
      return { built: ok(HoverCodec.encode({ serial: e.serial, proto: e.proto, status: 0, contents })) };
    }
    case ProjectionKind.stats: {
      if (req.p0 > 8 || req.p1 > 3 || (req.p2 & ~1) !== 0)
        return { built: invalid(UiInvalidReason.bad_parameters) };
      const ks = statsKeys(w, req.p1, req.tail);
      if (!ks) return { built: invalid(UiInvalidReason.bad_parameters) };
      const entries: StatEntry[] = ks.map((key) => {
        const s = w.stats.get(key);
        const r = s?.rings[req.p0];
        return s && r
          ? {
              key,
              produced: windowTotal(r, 'produced', s.produced_total),
              consumed: windowTotal(r, 'consumed', s.consumed_total),
            }
          : { key, produced: 0, consumed: 0 };
      });
      const out: StatSeries[] = [];
      const next = new Map(series?.next ?? []);
      const spans = new Map(series?.span ?? []);
      // The span of a point now: fixed per precision; the `all` ring's doubles (stats.ts allSpan).
      const span = req.p0 === ALL_PRECISION ? allSpan(w.tick) : (TICKS_PER_POINT[req.p0] as number);
      if ((req.p2 & 1) !== 0)
        for (const key of ks.slice(0, 24)) {
          const r = w.stats.get(key)?.rings[req.p0];
          const points = r?.points ?? 0;
          const oldest = points > RING_POINTS ? points - RING_POINTS : 0;
          const same = series && !series.whole && spans.get(key) === span;
          const want = same ? (series.next.get(key) ?? 0) : 0;
          const from = want > oldest ? want : oldest;
          const pts = r ? lastPoints(r, from) : { produced: [], consumed: [] };
          out.push({ key, from: from % 65536, produced: pts.produced, consumed: pts.consumed });
          next.set(key, points);
          spans.set(key, span);
        }
      const body = StatsCodec.encode({ precision: req.p0, tab: req.p1, flags: req.p2, entries, series: out });
      return { built: ok(body), nextSeries: { whole: false, next, span: spans } };
    }
    case ProjectionKind.debug:
      return { built: ok(debugRecord(sim)) };
    default:
      return { built: invalid(UiInvalidReason.unsupported) };
  }
}

/**
 * DEBUG (§15.5). Implementation-defined fields, which the golden set masks (README.md): `memory_bytes`, the
 * pools' `capacity` and `phase_us`; the model writes 0, the row count and nothing. The digests d and r are
 * pinned (GATE-r1 finding 6: r's slice serialization is rules 37–41).
 */
export function debugRecord(sim: Sim): Uint8Array {
  const w = sim.w;
  return DebugCodec.encode({
    tick: w.tick,
    entity_count: w.liveEntities().length,
    memory_bytes: 0,
    d: sim.lastDigest,
    r: sim.r,
    pools: [{ pool: 1, rows: w.containers.length, capacity: w.containers.length, active: 0 }],
    phase_us: [],
  });
}

// ------------------------------------------------------------------------------------------- queries

export type QueryAnswer = { ok: true; body: Uint8Array } | { ok: false; reason: number };

/** Runs a query to completion (§15.5; the model has no continuations: M0's queries are small). */
export function runQuery(sim: Sim, kind: number, flags: number, params: Uint8Array): QueryAnswer {
  if (!querySupported(kind)) return { ok: false, reason: UiInvalidReason.unsupported };
  if (flags !== 0) return { ok: false, reason: UiInvalidReason.bad_parameters };
  const w = sim.w;
  switch (kind) {
    case QueryKind.hash: {
      if (params.length !== 0) return { ok: false, reason: UiInvalidReason.bad_parameters };
      const h = w.stateHash();
      return {
        ok: true,
        body: StateHashCodec.encode({
          hash: h.hash,
          sections: h.sections.map((s) => ({ section: s.id, hash: s.hash })),
        }),
      };
    }
    case QueryKind.digest:
      if (params.length !== 0) return { ok: false, reason: UiInvalidReason.bad_parameters };
      // d is the last tick's digest (0 before any tick of this module instance); r the current lineage.
      return { ok: true, body: DigestResultCodec.encode({ tick: w.tick, d: sim.lastDigest, r: sim.r }) };
    case QueryKind.inspect: {
      if (params.length !== 4) return { ok: false, reason: UiInvalidReason.bad_parameters };
      const serial = new DataView(params.buffer, params.byteOffset, 4).getUint32(0, true);
      return { ok: true, body: InspectResultCodec.encode(inspect(w, serial)) };
    }
    default:
      return { ok: false, reason: UiInvalidReason.unsupported };
  }
}

/**
 * `inspect` (§3.5, §15.5): every saved field of one entity, decoded by the generated views. Model decision:
 * its entity-table row's saved columns, then its pool row's, in section and declaration order, each as the
 * column's type code and its value's little-endian bytes (a handle as the serial).
 */
export function inspect(
  w: World,
  serial: number,
): { serial: number; found: boolean; fields: InspectField[] } {
  const e = w.entityBySerial(serial);
  if (!e) return { serial, found: false, fields: [] };
  const fields: InspectField[] = [];
  const value = (width: number, signed: boolean, v: number): Uint8Array => {
    const out = new Writer();
    if (width === 1) out.u8(v, 'inspect');
    else if (width === 2) out.u16(v, 'inspect');
    else if (signed) out.i32(v, 'inspect');
    else out.u32(v, 'inspect');
    return out.finish();
  };
  for (const c of ENTITYTABLE_COLUMNS)
    fields.push({
      section: SECTION_ID.ENTITY_TABLE,
      type: c.code,
      name: c.name,
      value: value(c.width, c.code === 7, e[c.name as keyof EntityTableRow]),
    });
  const row = w.container(e);
  for (const c of CONTAINERPOOL_COLUMNS)
    fields.push({
      section: SECTION_ID.POOL_CONTAINER,
      type: c.code,
      name: c.name,
      value: value(c.width, false, row[c.name as 'entity' | 'inv']),
    });
  return { serial, found: true, fields };
}
