// The fake sim's extraction (10 §15.4–§15.6): packets with every section a renderer, UI or audio package
// consumes in M0, written with the generated writers, and the M0 projections and queries. What the main thread
// holds (the held set and its chunks' versions, the belt geometry it was sent, the subscriptions' last records)
// advances only when a packet is written, as §15.4 requires of the real sim.

import { SUPPORTED_PROJECTIONS, SUPPORTED_QUERIES } from '../../shared/gen/capabilities.ts';
import { Writer } from '../../shared/gen/codec.ts';
import {
  AudioWorkingCodec,
  BeltGeomCodec,
  BeltItemsCodec,
  BeltRetireCodec,
  ChunkEntitiesCodec,
  ChunkObjectsCodec,
  ChunkResourcesCodec,
  ChunkTilesCodec,
  DynCodec,
  heldChunks,
  InserterHandCodec,
  MoverCodec,
  PacketFlags,
  PacketSection,
  PacketWriter,
  type ViewRequest,
} from '../../shared/gen/packet.ts';
import {
  CharacterCodec,
  CharacterFlags,
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
  type SubRequest,
  UiInvalidReason,
  UiRecordCodec,
  UiStatus,
} from '../../shared/gen/projections.ts';
import { InventoryType } from '../../shared/gen/types.ts';
import { fmix32 } from './noise.ts';
import { handOrigin } from './rules.ts';
import { type SeriesState, statsRecord } from './stats.ts';
import { type Char, chunkKeyOf, daylight, type Ent, type FakeWorld, type Line, toChunk } from './world.ts';

const EMPTY = 0xffff;
const SLOW = new Set<number>([
  ProjectionKind.hud,
  ProjectionKind.research,
  ProjectionKind.stats,
  ProjectionKind.electric,
  ProjectionKind.world,
]);
const KIND_NAMES = new Map<number, string>(
  Object.entries(ProjectionKind).map(([k, v]) => [v as number, k.toUpperCase()]),
);
const QUERY_NAMES = new Map<number, string>(Object.entries(QueryKind).map(([k, v]) => [v as number, k]));
const STATUS = {
  none: 0,
  working: 1,
  no_power: 3,
  item_ingredient_shortage: 8,
  marked_for_deconstruction: 16,
};

/** A cheap content hash of a record (change detection only; the real sim uses XXH64, §15.5). */
function digest32(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ (b[i] as number), 0x01000193);
  return fmix32(h ^ b.length);
}

interface Sub {
  req: SubRequest;
  last: number | null;
  lastEval: number | null;
  /** STATS: per key, the next stream point to send (the series go whole first, then incremental). */
  next: SeriesState | null;
  refusal: number | null;
}

export class FakeExtractor {
  view: ViewRequest | null = null;
  private readonly held = new Map<
    number,
    { tiles: number; entities: number; objects: number; resources: number }
  >();
  private readonly geomSent = new Map<number, number>();
  private readonly subs = new Map<number, Sub>();
  private readonly versions = new Map<number, number>();
  private hover: { serial: number; last: number | null; done: boolean } | null = null;
  private first = true;
  private lastTick: number | null = null;

  /**
   * `sim_subscribe`: false (ERR_INPUT) for sub_id 0, which belongs to the hover projection. Each request adds
   * or replaces its sub_id; the limits (§15.5: 32 besides sub_id 0, at most 4 of them STATS) hold for the set
   * the request leaves, replacements included, and a request beyond them gets status 2, reason 3, and is
   * dropped (the subscription it replaced is gone too).
   */
  subscribe(reqs: readonly SubRequest[]): boolean {
    if (reqs.some((r) => r.sub_id === 0)) return false;
    for (const req of reqs) {
      const supported = SUPPORTED_PROJECTIONS.has(KIND_NAMES.get(req.kind) ?? '');
      const others = [...this.subs.entries()]
        .filter(([id, s]) => id !== req.sub_id && s.refusal === null)
        .map(([, s]) => s);
      let refusal: number | null = supported ? null : UiInvalidReason.unsupported;
      if (refusal === null) {
        if (others.length + 1 > 32) refusal = UiInvalidReason.over_limit;
        else if (
          req.kind === ProjectionKind.stats &&
          others.filter((s) => s.req.kind === ProjectionKind.stats).length + 1 > 4
        )
          refusal = UiInvalidReason.over_limit;
      }
      this.subs.set(req.sub_id, { req, last: null, lastEval: null, next: null, refusal });
    }
    return true;
  }

  unsubscribe(ids: readonly number[]): void {
    for (const id of ids) this.subs.delete(id);
  }

  /** A world replacement drops everything the main thread held (§3.4): the next packet is FULL. */
  reset(): void {
    this.held.clear();
    this.geomSent.clear();
    this.subs.clear();
    this.versions.clear();
    this.hover = null;
    this.first = true;
    this.lastTick = null;
    this.view = null;
  }

  /** One packet (§15.4), header included, with state_gen and view_seq zero for the shell to fill. */
  extract(w: FakeWorld): Uint8Array {
    const sections: { type: number; count: number; bytes: Uint8Array }[] = [];
    let flags = 0;
    if (this.first) flags |= PacketFlags.full;
    if (this.lastTick !== null && w.tick - this.lastTick > 1) flags |= PacketFlags.coalesced;
    if (w.eventsDropped) flags |= PacketFlags.events_dropped;
    const v = this.first ? null : this.view;
    const rect = v ? heldChunks(v) : null;
    const inHeld = (key: number): boolean => {
      if (!rect) return false;
      const cx = (key >>> 16) - 32768;
      const cy = (key & 0xffff) - 32768;
      return cx >= rect.cx0 && cx <= rect.cx1 && cy >= rect.cy0 && cy <= rect.cy1;
    };
    for (const k of [...this.held.keys()]) if (!inHeld(k)) this.held.delete(k);

    const tiles = new Writer();
    const ents = new Writer();
    const objs = new Writer();
    const ress = new Writer();
    const n = { t: 0, e: 0, o: 0, r: 0 };
    if (rect)
      for (let cx = rect.cx0; cx <= rect.cx1; cx++)
        for (let cy = rect.cy0; cy <= rect.cy1; cy++) {
          const c = w.chunk(cx, cy);
          const sent = this.held.get(c.key);
          if (!sent || sent.tiles !== c.version.tiles) {
            ChunkTilesCodec.write(tiles, {
              chunk_key: c.key,
              surface: 0,
              flags: 0,
              version: c.version.tiles,
              tiles: c.tiles,
            });
            n.t++;
          }
          if (!sent || sent.entities !== c.version.entities) {
            const list = w.entities
              .filter((e) => chunkKeyOf(toChunk(e.x2 >> 1), toChunk(e.y2 >> 1)) === c.key)
              .map((e) => ({
                serial: e.serial,
                x2: e.x2,
                y2: e.y2,
                proto: e.proto,
                alt_icon: e.altIcon,
                dir: e.dir,
                flip: 0,
                quality: 0,
                variant: 0,
                status: statusOf(e),
                flags: e.flags,
              }));
            ChunkEntitiesCodec.write(ents, {
              chunk_key: c.key,
              surface: 0,
              version: c.version.entities,
              entities: list,
            });
            n.e++;
          }
          if (!sent || sent.objects !== c.version.objects) {
            ChunkObjectsCodec.write(objs, {
              chunk_key: c.key,
              surface: 0,
              version: c.version.objects,
              objects: c.objects,
            });
            n.o++;
          }
          if (!sent || sent.resources !== c.version.resources) {
            const resources = c.resources.map((r) => ({
              tile: r.tile,
              resource: r.resource,
              band: band(r.amount),
            }));
            ChunkResourcesCodec.write(ress, {
              chunk_key: c.key,
              surface: 0,
              version: c.version.resources,
              resources,
            });
            n.r++;
          }
          this.held.set(c.key, { ...c.version });
        }
    if (n.t) sections.push({ type: PacketSection.chunk_tiles, count: n.t, bytes: tiles.finish() });
    if (n.e) sections.push({ type: PacketSection.chunk_entities, count: n.e, bytes: ents.finish() });

    // Snapshots of what is visible: DYN, HANDS, BELT_ITEMS, MOVERS (§15.4).
    const visible = (x2: number, y2: number) =>
      v !== null && x2 >= 2 * v.x0 - 8 && x2 < 2 * v.x1 + 8 && y2 >= 2 * v.y0 - 8 && y2 < 2 * v.y1 + 8;
    const light = daylight(w.tick, w.dayTicks);
    const dyn = new Writer();
    let nd = 0;
    for (const e of w.entities) {
      if (!visible(e.x2, e.y2) || e.role === 'chest' || e.role === 'static' || e.role === 'inserter')
        continue;
      const lit =
        e.role === 'lamp'
          ? e.working
            ? Math.round((1 - light) * 255)
            : 0
          : e.working && e.name.includes('furnace')
            ? 180
            : 0;
      DynCodec.write(dyn, {
        x2: e.x2,
        y2: e.y2,
        serial: e.serial,
        proto: e.proto,
        phase: e.phase,
        dir: e.dir,
        state: e.unpowered ? 2 : e.working ? 1 : 0,
        light: lit,
        quality: 0,
      });
      nd++;
    }
    if (nd) sections.push({ type: PacketSection.dyn, count: nd, bytes: dyn.finish() });
    const hands = new Writer();
    let nh = 0;
    for (const i of w.inserters) {
      if (!visible(i.x2, i.y2)) continue;
      // Out from the pickup side (behind the inserter) to the drop side (in front) and back: θ in turns from north.
      const facing = (i.dir / 16) % 1;
      const half = i.cycle < 0.5;
      const swing = half ? i.cycle * 2 : (1 - i.cycle) * 2; // 0 at pickup, 1 at drop
      const theta = (facing + 0.5 + swing * 0.5) % 1;
      const ext = i.pickExt + (i.dropExt - i.pickExt) * swing;
      InserterHandCodec.write(hands, {
        x2: i.x2,
        y2: i.y2,
        serial: i.serial,
        proto: i.proto,
        held: half ? i.item : EMPTY,
        theta: Math.floor(theta * 65536) & 0xffff,
        ext: Math.round(ext * 4096),
        dir: i.dir,
        held_count: half && i.item !== EMPTY ? 1 : 0,
      });
      nh++;
    }
    if (nh) sections.push({ type: PacketSection.hands, count: nh, bytes: hands.finish() });

    // Belt geometry is a delta (new or reshaped lines touching a held chunk), retired when it changes (§15.4).
    const geom = new Writer();
    const retire = new Writer();
    let ng = 0;
    let nr = 0;
    for (const l of w.lines) {
      const touches = l.chunks.some(inHeld);
      const sent = this.geomSent.get(l.id);
      if (sent !== undefined && (!touches || sent !== l.geomGen || l.removed)) {
        // A line leaving the held set is dropped on both sides without a message; a reshaped or removed one
        // (a belt of it was mined) is retired.
        if (touches) {
          BeltRetireCodec.write(retire, { line_id: l.id, geom_gen: sent });
          nr++;
        }
        this.geomSent.delete(l.id);
      }
      if (touches && !l.removed && this.geomSent.get(l.id) === undefined) {
        BeltGeomCodec.write(geom, {
          line_id: l.id,
          geom_gen: l.geomGen,
          lane: l.lane,
          speed: l.speed,
          length: l.length,
          segments: l.segments,
        });
        this.geomSent.set(l.id, l.geomGen);
        ng++;
      }
    }
    if (ng) sections.push({ type: PacketSection.belt_geom, count: ng, bytes: geom.finish() });
    const items = new Writer();
    let ni = 0;
    for (const l of w.lines) {
      if (!this.geomSent.has(l.id) || l.items.length === 0) continue;
      BeltItemsCodec.write(items, beltItems(l));
      ni++;
    }
    if (ni) sections.push({ type: PacketSection.belt_items, count: ni, bytes: items.finish() });

    const movers = new Writer();
    let nm = 0;
    for (const c of w.chars) {
      if (!inHeld(chunkKeyOf(toChunk(Math.floor(c.x)), toChunk(Math.floor(c.y))))) continue;
      MoverCodec.write(movers, {
        serial: c.serial,
        proto: w.p.character(),
        kind: 0,
        flags: c.mining ? 1 : 0,
        x: Math.floor(c.x * 256 + 0.5),
        y: Math.floor(c.y * 256 + 0.5),
        vx: Math.floor(c.vx * 256 + 0.5),
        vy: Math.floor(c.vy * 256 + 0.5),
        base_tick: w.tick,
        orientation: c.dir * 4096,
        aux: c.player,
      });
      nm++;
    }
    if (nm) sections.push({ type: PacketSection.movers, count: nm, bytes: movers.finish() });

    if (w.events.length > 0) {
      const ev = new Writer();
      for (const e of w.events) ev.bytes(e);
      sections.push({ type: PacketSection.events, count: w.events.length, bytes: ev.finish() });
    }
    w.events = [];
    w.eventsDropped = false;

    if (!this.first) {
      const ui = this.ui(w);
      if (ui.count) sections.push({ type: PacketSection.ui, count: ui.count, bytes: ui.bytes });
    }

    // AUDIO_WORKING (§15.6): per working sound, the count, the centroid from the view centre, Σ 1/(1 + (d/R)²).
    // Sound ids are the build's (prototypes.bin `working_sound`); without the table the section is never sent.
    if (v && (v.flags & (1 << 3)) !== 0) {
      const R = v.audio_half_range > 0 ? v.audio_half_range : 16;
      const cxv = (v.x0 + v.x1) / 2;
      const cyv = (v.y0 + v.y1) / 2;
      const groups = new Map<number, { n: number; sx: number; sy: number; w: number }>();
      for (const e of w.entities) {
        // Belts always run; machines and radars sound while they work and have power; ghosts never.
        if (e.flags & 1) continue;
        const sounding =
          e.role === 'belt' || ((e.role === 'machine' || e.role === 'radar') && e.working && !e.unpowered);
        if (!sounding) continue;
        const sound = w.p.sound(e.proto);
        if (sound === null) continue;
        const ex = e.x2 / 2;
        const ey = e.y2 / 2;
        if (ex < v.x0 - R / 2 || ex >= v.x1 + R / 2 || ey < v.y0 - R / 2 || ey >= v.y1 + R / 2) continue;
        const d2 = ((ex - cxv) * (ex - cxv) + (ey - cyv) * (ey - cyv)) / (R * R);
        const g = groups.get(sound) ?? { n: 0, sx: 0, sy: 0, w: 0 };
        g.n++;
        g.sx += ex - cxv;
        g.sy += ey - cyv;
        g.w += 1 / (1 + d2);
        groups.set(sound, g);
      }
      const aw = new Writer();
      const ids = [...groups.keys()].sort((a, b) => a - b);
      for (const id of ids) {
        const g = groups.get(id) as { n: number; sx: number; sy: number; w: number };
        AudioWorkingCodec.write(aw, { sound: id, n: g.n, cx: g.sx / g.n, cy: g.sy / g.n, wsum: g.w });
      }
      if (ids.length)
        sections.push({ type: PacketSection.audio_working, count: ids.length, bytes: aw.finish() });
    }

    if (n.o) sections.push({ type: PacketSection.chunk_objects, count: n.o, bytes: objs.finish() });
    if (n.r) sections.push({ type: PacketSection.chunk_resources, count: n.r, bytes: ress.finish() });
    if (nr) sections.push({ type: PacketSection.belt_retire, count: nr, bytes: retire.finish() });

    sections.sort((a, b) => a.type - b.type);
    const out = new Writer(65536);
    const pw = new PacketWriter(out, sections.length, w.tick, flags, Math.round(light * 65535));
    for (const s of sections) {
      pw.section(s.type);
      out.bytes(s.bytes);
      pw.end(s.count);
    }
    pw.finish();
    this.first = false;
    this.lastTick = w.tick;
    return out.finish();
  }

  private ui(w: FakeWorld): { count: number; bytes: Uint8Array } {
    const out = new Writer();
    let count = 0;
    const write = (sub: number, kind: number, status: number, body: Uint8Array) => {
      const version = (this.versions.get(sub) ?? 0) + 1;
      this.versions.set(sub, version);
      UiRecordCodec.write(out, { sub_id: sub, kind, status, version, body });
      count++;
    };
    const reason = (r: number) => new Uint8Array([r & 0xff, r >> 8]);
    const hovered = this.view?.hovered_serial ?? 0;
    if (hovered === 0) this.hover = null;
    else if (!this.hover || this.hover.serial !== hovered)
      this.hover = { serial: hovered, last: null, done: false };
    if (this.hover && !this.hover.done) {
      const r = record(
        w,
        {
          sub_id: 0,
          kind: ProjectionKind.hover,
          flags: 0,
          target: this.hover.serial,
          p0: 0,
          p1: 0,
          p2: 0,
          p3: 0,
        },
        null,
      );
      if (r.status === 1) {
        write(0, ProjectionKind.hover, UiStatus.gone, new Uint8Array());
        this.hover.done = true;
      } else if (r.status === 0) {
        const h = digest32(r.body);
        if (h !== this.hover.last) {
          write(0, ProjectionKind.hover, UiStatus.ok, r.body);
          this.hover.last = h;
        }
      }
    }
    for (const id of [...this.subs.keys()].sort((a, b) => a - b)) {
      const s = this.subs.get(id) as Sub;
      if (s.refusal !== null) {
        write(id, s.req.kind, UiStatus.invalid, reason(s.refusal));
        this.subs.delete(id);
        continue;
      }
      if (SLOW.has(s.req.kind) && s.lastEval !== null && w.tick < s.lastEval + 60) continue;
      s.lastEval = w.tick;
      const r = record(w, s.req, s.next);
      if (r.status === 1) {
        write(id, s.req.kind, UiStatus.gone, new Uint8Array());
        this.subs.delete(id);
      } else if (r.status === 2) {
        write(id, s.req.kind, UiStatus.invalid, reason(r.reason));
        this.subs.delete(id);
      } else {
        const h = digest32(r.body);
        if (h === s.last) continue;
        write(id, s.req.kind, UiStatus.ok, r.body);
        s.last = h;
        if (r.next) s.next = r.next;
      }
    }
    return { count, bytes: out.finish() };
  }

  /** A query (§15.5): M0's three, the rest unsupported (status 2 reason 1, as the capability manifest says). */
  query(w: FakeWorld, q: Uint8Array): { ok: boolean; value: Uint8Array } {
    const v = new DataView(q.buffer, q.byteOffset, q.byteLength);
    const fail = (r: number) => ({ ok: false, value: new Uint8Array([r & 0xff, r >> 8]) });
    if (q.length < 4) return fail(UiInvalidReason.bad_parameters);
    const kind = v.getUint16(0, true);
    if (!SUPPORTED_QUERIES.has(QUERY_NAMES.get(kind) ?? '')) return fail(UiInvalidReason.unsupported);
    if (kind === QueryKind.inspect) {
      const serial = q.length >= 8 ? v.getUint32(4, true) : 0;
      const e = w.entities.find((x) => x.serial === serial);
      // A field's value as its little-endian bytes (u16 or i32/u32).
      const le = (n: number, bytes: number) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, n, true);
        return b.slice(0, bytes);
      };
      const fields = e
        ? [
            { section: 1, type: 2, name: 'proto', value: le(e.proto, 2) },
            { section: 1, type: 7, name: 'x2', value: le(e.x2, 4) },
            { section: 1, type: 7, name: 'y2', value: le(e.y2, 4) },
            { section: 1, type: 3, name: 'serial', value: le(e.serial, 4) },
          ]
        : [];
      return { ok: true, value: InspectResultCodec.encode({ serial, found: e !== undefined, fields }) };
    }
    if (kind === QueryKind.hash)
      return { ok: true, value: StateHashCodec.encode({ hash: BigInt(fmix32(w.tick)), sections: [] }) };
    return {
      ok: true,
      value: DigestResultCodec.encode({
        tick: w.tick,
        d: BigInt(fmix32(w.tick ^ 0xd1)),
        r: BigInt(fmix32(w.tick ^ 0x52)),
      }),
    };
  }
}

function statusOf(e: Ent): number {
  if (e.flags & 2) return STATUS.marked_for_deconstruction;
  if (e.role === 'chest' || e.role === 'static' || e.role === 'belt' || e.role === 'inserter')
    return STATUS.none;
  if (e.unpowered) return STATUS.no_power;
  return e.working ? STATUS.working : STATUS.item_ingredient_shortage;
}

/** The richness band (§15.4; the golden model's Factorio stage counts). */
function band(amount: number): number {
  const stages = [15000, 9500, 5500, 2900, 1300, 400, 150];
  for (let i = 0; i < stages.length; i++) if (amount >= (stages[i] as number)) return i;
  return 7;
}

/** A line's items as §15.4's gap array: front_gap, keys, and the slack beyond 64 positions between items. */
function beltItems(l: Line) {
  const keys = l.items.map((i) => i.key);
  const gaps: number[] = [];
  for (let i = 1; i < l.items.length; i++)
    gaps.push((l.items[i] as { d: number }).d - (l.items[i - 1] as { d: number }).d - 64);
  return { line_id: l.id, geom_gen: l.geomGen, front_gap: (l.items[0] as { d: number }).d, keys, gaps };
}

type Built =
  | { status: 0; body: Uint8Array; next?: SeriesState }
  | { status: 1 }
  | { status: 2; reason: number };

function slotsOf(inv: { key: number; count: number }[]) {
  return inv.map((s) => ({ key: s.count > 0 ? s.key : EMPTY, filter: EMPTY, count: s.count }));
}

/** A projection's record (§15.5) for the fake world. */
function record(w: FakeWorld, req: SubRequest, next: SeriesState | null): Built {
  switch (req.kind) {
    case ProjectionKind.hud:
      return {
        status: 0,
        body: HudCodec.encode({
          tick: w.tick,
          research_tech: EMPTY,
          research_level: 0,
          research_progress: 0,
          takeoff_level: 0,
          flags: 0,
          field: 10 + w.tick / 3600,
          literature: w.literature,
          your_year: w.literature - 3,
          years_ahead: 0,
          activity_w: w.activityW(),
          doubling_time_s: 0,
          alerts: [],
        }),
      };
    case ProjectionKind.character: {
      const c: Char | undefined = w.chars.find((x) => x.player === req.target);
      if (!c) return { status: 1 };
      const origin = handOrigin(c);
      return {
        status: 0,
        body: CharacterCodec.encode({
          player: c.player,
          flags:
            (c.online ? CharacterFlags.online : 0) |
            (c.hand.ghost ? CharacterFlags.hand_ghost : 0) |
            (c.mining ? CharacterFlags.mining : 0) |
            (c.autoSort ? CharacterFlags.auto_sort : 0) |
            (c.pickGhost ? CharacterFlags.pick_ghost_cursor : 0),
          quickbar_page: 0,
          serial: c.serial,
          input_gen: c.inputGen,
          hand_origin: origin >= 0 ? origin : EMPTY,
          hand_key: c.hand.count > 0 || c.hand.ghost ? c.hand.key : EMPTY,
          hand_count: c.hand.count,
          mining_progress: c.mining ? Math.fround(c.miningProgress) : 0,
          main: slotsOf(c.main),
          quickbar: [],
          queue: c.queue.map((q, i) => ({
            recipe: q.recipe,
            count: q.count,
            progress: i === 0 ? Math.fround(q.progress) : 0,
            flags: 0,
          })),
        }),
      };
    }
    case ProjectionKind.inventory:
    case ProjectionKind.entity_panel:
    case ProjectionKind.hover: {
      const e = w.entities.find((x) => x.serial === req.target);
      if (!e) return { status: 1 };
      const view = { inv: InventoryType.chest, bar: e.bar, slots: slotsOf(e.inv) };
      if (req.kind === ProjectionKind.inventory) {
        if (req.p0 !== InventoryType.chest || e.role !== 'chest')
          return { status: 2, reason: UiInvalidReason.bad_parameters };
        return { status: 0, body: InventoryCodec.encode({ serial: e.serial, view }) };
      }
      if (req.kind === ProjectionKind.hover) {
        const totals = new Map<number, number>();
        for (const s of e.inv) if (s.count > 0) totals.set(s.key, (totals.get(s.key) ?? 0) + s.count);
        const contents = [...totals.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([key, count]) => ({ key, count }));
        return {
          status: 0,
          body: HoverCodec.encode({ serial: e.serial, proto: e.proto, status: statusOf(e), contents }),
        };
      }
      const machine = e.role === 'machine';
      return {
        status: 0,
        body: EntityPanelCodec.encode({
          serial: e.serial,
          proto: e.proto,
          status: statusOf(e),
          flags: machine ? (e.recipe !== EMPTY ? 1 : 0) | 2 | 4 : 0,
          recipe: e.recipe,
          progress: e.craftTicks > 0 ? e.progress / e.craftTicks : 0,
          crafts_per_s: machine && e.working && !e.unpowered && e.craftTicks > 0 ? 60 / e.craftTicks : 0,
          productivity_bar: 0,
          energy_satisfaction: machine ? (e.unpowered ? 0 : 1) : 0,
          energy_buffer_j: 0,
          energy_draw_w: machine && e.working && !e.unpowered ? e.energyW : 0,
          inventories: e.role === 'chest' ? [view] : [],
        }),
      };
    }
    case ProjectionKind.stats: {
      const r = statsRecord(w.stats, req, next);
      return 'reason' in r ? { status: 2, reason: r.reason } : { status: 0, body: r.body, next: r.next };
    }
    case ProjectionKind.debug:
      return {
        status: 0,
        body: DebugCodec.encode({
          tick: w.tick,
          entity_count: w.entities.length,
          memory_bytes: 0,
          d: BigInt(fmix32(w.tick ^ 0xd1)),
          r: BigInt(fmix32(w.tick ^ 0x52)),
          pools: [
            { pool: 1, rows: w.entities.filter((e) => e.role === 'chest').length, capacity: 64, active: 0 },
          ],
          phase_us: [],
        }),
      };
    default:
      return { status: 2, reason: UiInvalidReason.unsupported };
  }
}
