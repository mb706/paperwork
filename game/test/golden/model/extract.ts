// Extraction (10 §15.4–§15.6, §3.4): `sim_extract` reads `&World` and the presentation state and writes one
// complete packet, header included, with `state_gen` and `view_seq` left zero for the shell to fill. What the
// main thread holds (the held set, each held chunk's sent versions, the subscriptions' last records) advances
// only when a packet is written.
import { Writer } from '../../../src/shared/gen/codec.ts';
import {
  ChunkEntitiesCodec,
  ChunkObjectsCodec,
  ChunkResourcesCodec,
  ChunkTilesCodec,
  type EntityView,
  heldChunks,
  MoverCodec,
  PacketFlags,
  PacketSection,
  PacketWriter,
  type ViewRequest,
} from '../../../src/shared/gen/packet.ts';
import {
  ProjectionKind,
  type SubRequest,
  UiRecordCodec,
  UiStatus,
} from '../../../src/shared/gen/projections.ts';
import { MiningMode } from '../../../src/shared/gen/state.ts';
import { MoverKind } from '../../../src/shared/gen/types.ts';
import { buildRecord, EVERY_PACKET, kindSupported, type SeriesState } from './projections.ts';
import { fine, resourceBand } from './rules.ts';
import type { Sim } from './sim.ts';
import { chunkKey, chunkXY, SURFACE, tileToChunk } from './world.ts';
import { xxh64 } from './xxh64.ts';

const LIMITS = { subscriptions: 32, stats: 4, uiSectionMax: 262144, slowCadence: 60 } as const;

/** M0 has no day cycle (§5.7 arrives in M1). Model decision: full daylight, 65,535, in every packet. */
export const M0_DAYLIGHT = 65535;

interface Sub {
  req: SubRequest;
  lastHash: bigint | null;
  lastEval: number | null;
  series: SeriesState | null;
  /** A refusal to send once, then the subscription is dropped (§15.5: limits, unsupported kinds). */
  refusal: number | null;
}

interface Held {
  tiles: number;
  entities: number;
  objects: number;
  resources: number;
}

export class Extractor {
  /** The latest view request, applied by the next extraction (§3.4). */
  view: ViewRequest | null = null;
  private readonly held = new Map<number, Held>();
  private readonly subs = new Map<number, Sub>();
  /** Per sub_id: the records sent, over replacements too (§15.5 `version`). */
  private readonly versions = new Map<number, number>();
  /** The hover projection, sub_id 0, driven by the view request's `hovered_serial` (§15.5). */
  private hover: { serial: number; lastHash: bigint | null; done: boolean } | null = null;
  private firstSent = false;
  private lastTick: number | null = null;
  private uiCursor = 0;

  /**
   * `sim_subscribe` (§15.5, §15.8). Sending an existing sub_id replaces it. Model decisions: sub_id 0 belongs to
   * the hover projection, so a request for it is malformed (ERR_INPUT, nothing changes); a request beyond a
   * limit, or for a kind outside the capability manifest, becomes a subscription that sends one status-2
   * record and is dropped.
   */
  subscribe(reqs: readonly SubRequest[]): boolean {
    if (reqs.some((r) => r.sub_id === 0)) return false;
    for (const req of reqs) {
      const replacing = this.subs.has(req.sub_id);
      let refusal: number | null = null;
      if (!kindSupported(req.kind)) refusal = 1;
      else if (!replacing) {
        const live = [...this.subs.values()].filter((s) => s.refusal === null);
        if (live.length >= LIMITS.subscriptions) refusal = 3;
        else if (
          req.kind === ProjectionKind.stats &&
          live.filter((s) => s.req.kind === ProjectionKind.stats).length >= LIMITS.stats
        )
          refusal = 3;
      }
      this.subs.set(req.sub_id, {
        req,
        lastHash: null,
        lastEval: null,
        series: { whole: true, next: new Map() },
        refusal,
      });
    }
    return true;
  }

  unsubscribe(ids: readonly number[]): void {
    for (const id of ids) this.subs.delete(id);
  }

  /** `sim_extract`: the next packet. */
  extract(sim: Sim): Uint8Array {
    const w = sim.w;
    const tick = w.tick;
    let flags = 0;
    if (!this.firstSent) flags |= PacketFlags.full;
    if (this.lastTick !== null && tick - this.lastTick > 1) flags |= PacketFlags.coalesced;
    const sections: { type: number; count: number; bytes: Uint8Array }[] = [];
    const rect = this.firstSent && this.view ? heldChunks(this.view) : null;

    // Per-chunk deltas (§15.4): the held set's existing chunks, ascending key. A chunk that leaves the held
    // set is forgotten on both sides; one that enters is sent afresh, all four parts.
    const inHeld = (key: number): boolean => {
      if (!rect) return false;
      const [cx, cy] = chunkXY(key);
      return cx >= rect.cx0 && cx <= rect.cx1 && cy >= rect.cy0 && cy <= rect.cy1;
    };
    for (const key of [...this.held.keys()]) if (!inHeld(key)) this.held.delete(key);
    const chunkKeys = [...w.chunks.keys()].filter(inHeld).sort((a, b) => a - b);
    const tiles = new Writer();
    const ents = new Writer();
    const objs = new Writer();
    const ress = new Writer();
    let nt = 0;
    let ne = 0;
    let no = 0;
    let nr = 0;
    for (const key of chunkKeys) {
      const c = w.chunks.get(key);
      if (!c) continue;
      const sent = this.held.get(key);
      if (!sent || sent.tiles !== c.view.tiles) {
        ChunkTilesCodec.write(tiles, {
          chunk_key: key,
          surface: SURFACE,
          flags: 0,
          version: c.view.tiles,
          tiles: c.rec.tiles,
        });
        nt++;
      }
      if (!sent || sent.entities !== c.view.entities) {
        const entities: EntityView[] = w
          .liveEntities()
          .filter((e) => chunkKey(tileToChunk(e.x2 >> 1), tileToChunk(e.y2 >> 1)) === key)
          .map((e) => ({
            serial: e.serial,
            x2: e.x2,
            y2: e.y2,
            proto: e.proto,
            alt_icon: 0xffff,
            dir: e.dir,
            flip: e.flip,
            quality: e.quality,
            variant: 0,
            status: 0, // chests report no status (types.yaml Status)
            flags: 0,
          }));
        ChunkEntitiesCodec.write(ents, {
          chunk_key: key,
          surface: SURFACE,
          version: c.view.entities,
          entities,
        });
        ne++;
      }
      if (!sent || sent.objects !== c.view.objects) {
        // M0 has no world objects in its manifest and nothing drops on the ground: always empty.
        ChunkObjectsCodec.write(objs, {
          chunk_key: key,
          surface: SURFACE,
          version: c.view.objects,
          objects: [],
        });
        no++;
      }
      if (!sent || sent.resources !== c.view.resources) {
        const resources = [...c.rec.resources]
          .sort((a, b) => a.tile - b.tile)
          .map((r) => ({ tile: r.tile, resource: r.resource, band: resourceBand(r.amount) }));
        ChunkResourcesCodec.write(ress, {
          chunk_key: key,
          surface: SURFACE,
          version: c.view.resources,
          resources,
        });
        nr++;
      }
      this.held.set(key, { ...c.view });
    }
    if (nt > 0) sections.push({ type: PacketSection.chunk_tiles, count: nt, bytes: tiles.finish() });
    if (ne > 0) sections.push({ type: PacketSection.chunk_entities, count: ne, bytes: ents.finish() });

    // MOVERS (§15.4, a snapshot): every character whose position lies in a held chunk, ascending serial.
    const movers = new Writer();
    let nm = 0;
    for (const p of [...w.players]
      .filter((q) => q.character !== 0)
      .sort((a, b) => a.character - b.character)) {
      if (!inHeld(chunkKey(tileToChunk(Math.floor(p.x)), tileToChunk(Math.floor(p.y))))) continue;
      const v = sim.pres.lastMove.get(p.index) ?? { dx: 0, dy: 0 };
      MoverCodec.write(movers, {
        serial: p.character,
        proto: w.protos.character,
        kind: MoverKind.character,
        flags: p.mining.mode !== MiningMode.none ? 1 : 0,
        x: fine(p.x),
        y: fine(p.y),
        vx: fine(v.dx),
        vy: fine(v.dy),
        base_tick: tick,
        orientation: p.walking_dir * 4096,
        aux: p.index,
      });
      nm++;
    }
    if (nm > 0) sections.push({ type: PacketSection.movers, count: nm, bytes: movers.finish() });

    // EVENTS (§15.6): everything queued since the last packet.
    const drained = sim.pres.events.drain();
    if (drained.dropped) flags |= PacketFlags.events_dropped;
    if (drained.events.length > 0) {
      const ev = new Writer();
      for (const e of drained.events) ev.bytes(e.bytes);
      sections.push({ type: PacketSection.events, count: drained.events.length, bytes: ev.finish() });
    }

    // UI (§15.5): the subscriptions due, in sub_id order (the hover projection first).
    const ui = this.firstSent ? this.uiRecords(sim, tick) : { count: 0, bytes: new Uint8Array() };
    if (ui.count > 0) sections.push({ type: PacketSection.ui, count: ui.count, bytes: ui.bytes });

    // AUDIO_WORKING (§15.6): nothing works in M0, so the snapshot is always empty and absent.
    if (no > 0) sections.push({ type: PacketSection.chunk_objects, count: no, bytes: objs.finish() });
    if (nr > 0) sections.push({ type: PacketSection.chunk_resources, count: nr, bytes: ress.finish() });

    const out = new Writer();
    const pw = new PacketWriter(out, sections.length, tick, flags, M0_DAYLIGHT);
    for (const s of sections) {
      pw.section(s.type);
      out.bytes(s.bytes);
      pw.end(s.count);
    }
    pw.finish();
    this.firstSent = true;
    this.lastTick = tick;
    return out.finish();
  }

  private uiRecords(sim: Sim, tick: number): { count: number; bytes: Uint8Array } {
    const w = new Writer();
    let count = 0;
    const version = (id: number): number => {
      const v = (this.versions.get(id) ?? 0) + 1;
      this.versions.set(id, v);
      return v;
    };
    const write = (subId: number, kind: number, status: number, body: Uint8Array): boolean => {
      const rec = UiRecordCodec.encode({ sub_id: subId, kind, status, version: 0, body });
      if (w.pos + rec.length > LIMITS.uiSectionMax) return false;
      UiRecordCodec.write(w, { sub_id: subId, kind, status, version: version(subId), body });
      count++;
      return true;
    };
    const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, v >> 8]);

    // The hover projection (sub_id 0): the view request's hovered serial, 0 for none.
    const hovered = this.view?.hovered_serial ?? 0;
    if (hovered === 0) this.hover = null;
    else if (!this.hover || this.hover.serial !== hovered)
      this.hover = { serial: hovered, lastHash: null, done: false };
    const order: number[] = [...this.subs.keys()].sort((a, b) => a - b);
    if (this.hover) order.unshift(0);
    const start = order.findIndex((id) => id >= this.uiCursor);
    const cyclic = start <= 0 ? order : [...order.slice(start), ...order.slice(0, start)];
    this.uiCursor = 0;
    for (const id of cyclic) {
      if (id === 0) {
        const h = this.hover;
        if (!h || h.done) continue;
        const req: SubRequest = {
          sub_id: 0,
          kind: ProjectionKind.hover,
          flags: 0,
          target: h.serial,
          p0: 0,
          p1: 0,
          p2: 0,
          p3: 0,
        };
        const { built } = buildRecord(sim, req, null);
        if (built.status === 1) {
          if (!write(0, ProjectionKind.hover, UiStatus.gone, new Uint8Array()))
            return this.capped(id, count, w);
          h.done = true;
        } else if (built.status === 0) {
          const hash = xxh64(built.body);
          if (hash === h.lastHash) continue;
          if (!write(0, ProjectionKind.hover, UiStatus.ok, built.body)) return this.capped(id, count, w);
          h.lastHash = hash;
        }
        continue;
      }
      const s = this.subs.get(id) as Sub;
      if (s.refusal !== null) {
        if (!write(id, s.req.kind, UiStatus.invalid, u16(s.refusal))) return this.capped(id, count, w);
        this.subs.delete(id);
        continue;
      }
      const due =
        EVERY_PACKET.has(s.req.kind) || s.lastEval === null || tick >= s.lastEval + LIMITS.slowCadence;
      if (!due) continue;
      const { built, nextSeries } = buildRecord(sim, s.req, s.series);
      if (built.status === 1) {
        if (!write(id, s.req.kind, UiStatus.gone, new Uint8Array())) return this.capped(id, count, w);
        this.subs.delete(id);
        continue;
      }
      if (built.status === 2) {
        if (!write(id, s.req.kind, UiStatus.invalid, u16(built.reason))) return this.capped(id, count, w);
        this.subs.delete(id);
        continue;
      }
      s.lastEval = tick;
      const hash = xxh64(built.body);
      if (hash === s.lastHash) continue;
      if (!write(id, s.req.kind, UiStatus.ok, built.body)) {
        s.lastEval = null;
        return this.capped(id, count, w);
      }
      s.lastHash = hash;
      if (nextSeries) s.series = nextSeries;
    }
    return { count, bytes: w.finish() };
  }

  /** The UI section is full (256 KiB): the rest wait for the next extraction, starting here (§15.5). */
  private capped(id: number, count: number, w: Writer): { count: number; bytes: Uint8Array } {
    this.uiCursor = id;
    return { count, bytes: w.finish() };
  }
}
