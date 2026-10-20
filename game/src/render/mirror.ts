// The view model (10 §3.4): the main thread's mirror of what the sim says is on screen, built from render packets
// (10 §15.4). Deltas (chunk tiles, entities, objects, resources, belt geometry) stay until replaced or retired;
// snapshots (DYN, HANDS, BELT_ITEMS, MOVERS) are replaced by every packet and an absent one means none. A packet's
// held set (the view request it answers, grown by a chunk) evicts the chunks that leave it, on both sides, so the
// worker always knows what the main thread holds. A FULL packet drops everything first.
//
// The walker below checks a packet as the generated `decodePacket` does (magic, version, length, a sorted directory
// of known types with their record versions, 8-aligned sections, fixed records exactly `count` long) without
// allocating. Steady-state packets (snapshots only) copy into buffers that grow and are kept; only deltas allocate.

import {
  BeltGeomCodec,
  BeltItemsCodec,
  BeltRetireCodec,
  BeltSegmentCodec,
  type ChunkRect,
  ChunkTilesCodec,
  chunkXY,
  DynCodec,
  EntityViewCodec,
  heldChunks,
  InserterHandCodec,
  MoverCodec,
  ObjectViewCodec,
  PACKET_DIRECTORY_ENTRY_SIZE,
  PACKET_HEADER_SIZE,
  PACKET_MAGIC,
  PACKET_SECTIONS,
  PACKET_VERSION,
  PacketFlags,
  PacketSection,
  ResourceViewCodec,
  type ViewRequest,
} from '../shared/gen/packet.ts';

/** A refused packet: the same kinds as the generated decoder's DecodeError. */
export class PacketError extends Error {
  override name = 'PacketError';
}

const ENTITY_SIZE = EntityViewCodec.SIZE;
const OBJECT_SIZE = ObjectViewCodec.SIZE;
const RESOURCE_SIZE = ResourceViewCodec.SIZE;
const CHUNK_HEADER = 16;
const TILE_RECORD = ChunkTilesCodec.SIZE;
const SECTION_TYPES = 18;

/** One held chunk's retained records. */
export interface ChunkView {
  key: number;
  cx: number;
  cy: number;
  /** 1,024 tile ids, row-major (index = y × 32 + x), or null until CHUNK_TILES arrives. */
  tiles: Uint8Array | null;
  /** EntityView records (24 bytes each), and a view of them. */
  entities: Uint8Array;
  entityView: DataView;
  entityCount: number;
  /** ObjectView records (16 bytes each). */
  objects: Uint8Array;
  objectView: DataView;
  objectCount: number;
  /** Resource records (8 bytes each). */
  resources: Uint8Array;
  resourceView: DataView;
  resourceCount: number;
  /** Bumped whenever tiles, objects or resources change (the terrain data rebuilds). */
  terrainRev: number;
  /** The sim's per-part versions as last received. */
  versions: Int32Array;
}

/** One transport line's geometry (BELT_GEOM), keyed by line_id, valid for its geom_gen. */
export interface BeltLine {
  lineId: number;
  geomGen: number;
  lane: number;
  speed: number;
  length: number;
  /** Per segment: x, y (1/256 tile, downstream end), len (positions), dir, turn, radius (1/256 tile). */
  segs: Int32Array;
  segCount: number;
  /** The chunks the line's segments span (inclusive), for dropping it with the held set. */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/** A growable byte buffer for one snapshot section. */
class Snapshot {
  bytes = new Uint8Array(1024);
  view = new DataView(this.bytes.buffer);
  count = 0;
  length = 0;
  set(src: Uint8Array, offset: number, length: number, count: number): void {
    if (length > this.bytes.length) {
      let n = this.bytes.length;
      while (n < length) n *= 2;
      this.bytes = new Uint8Array(n);
      this.view = new DataView(this.bytes.buffer);
    }
    this.bytes.set(src.subarray(offset, offset + length), 0);
    this.count = count;
    this.length = length;
  }
  clear(): void {
    this.count = 0;
    this.length = 0;
  }
}

/** serial → record index, open addressing; rebuilt per packet, reallocated only when it must grow. */
class SerialIndex {
  keys = new Int32Array(64);
  vals = new Int32Array(64);
  mask = 63;
  build(view: DataView, count: number, stride: number, serialOffset: number): void {
    let cap = this.keys.length;
    while (cap < count * 2) cap *= 2;
    if (cap !== this.keys.length) {
      this.keys = new Int32Array(cap);
      this.vals = new Int32Array(cap);
      this.mask = cap - 1;
    }
    this.keys.fill(0);
    for (let i = 0; i < count; i++) {
      const s = view.getUint32(i * stride + serialOffset, true) | 0;
      let h = Math.imul(s, 0x9e3779b1) & this.mask;
      while (this.keys[h] !== 0) h = (h + 1) & this.mask;
      this.keys[h] = s;
      this.vals[h] = i;
    }
  }
  clear(): void {
    this.keys.fill(0);
  }
  /** The record index of `serial`, or −1. Serials are never 0. */
  get(serial: number): number {
    const s = serial | 0;
    let h = Math.imul(s, 0x9e3779b1) & this.mask;
    for (;;) {
      const k = this.keys[h] as number;
      if (k === 0) return -1;
      if (k === s) return this.vals[h] as number;
      h = (h + 1) & this.mask;
    }
  }
}

export class Mirror {
  readonly chunks = new Map<number, ChunkView>();
  readonly lines = new Map<number, BeltLine>();
  readonly dyn = new Snapshot();
  readonly hands = new Snapshot();
  readonly movers = new Snapshot();
  readonly beltItems = new Snapshot();
  /** Byte offset of each BELT_ITEMS record in `beltItems.bytes`. */
  beltItemOffsets = new Int32Array(64);
  readonly dynIndex = new SerialIndex();
  readonly handsIndex = new SerialIndex();
  /** The held set the last applied view request implies (null: none yet). */
  held: ChunkRect | null = null;
  /** The view request the mirror's held set comes from. */
  view: ViewRequest | null = null;
  tick = 0;
  /** The sim's daylight factor, 0–1 (§15.4's u16 / 65,535). */
  daylight = 1;
  stateGen = 0;
  /** Packets applied, and a revision bumped by every change of the chunk set or a chunk's terrain. */
  packets = 0;
  terrainRev = 0;
  /** Problems a dev build logs once (records naming chunks outside the held set …). */
  readonly warnings: string[] = [];

  // the directory of the packet being applied, by section type
  private readonly secOff = new Int32Array(SECTION_TYPES);
  private readonly secLen = new Int32Array(SECTION_TYPES);
  private readonly secCount = new Int32Array(SECTION_TYPES);

  /** Drops everything (a FULL packet, a new state generation). */
  reset(): void {
    this.chunks.clear();
    this.lines.clear();
    this.dyn.clear();
    this.hands.clear();
    this.movers.clear();
    this.beltItems.clear();
    this.dynIndex.clear();
    this.handsIndex.clear();
    this.held = null;
    this.view = null;
    this.terrainRev++;
  }

  /**
   * Applies one packet (§15.4). `view` is the view request the packet answers (the main thread maps view_seq to the
   * request it sent; the golden tests pass the trace's), or undefined to keep the current one.
   */
  apply(bytes: Uint8Array, view?: ViewRequest | null): void {
    // One view per packet: a transferred buffer arrives as a new object, like the message that carries it.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < PACKET_HEADER_SIZE) throw new PacketError('truncated packet header');
    if (dv.getUint32(0, true) !== PACKET_MAGIC) throw new PacketError('bad_magic');
    if (dv.getUint16(4, true) !== PACKET_VERSION) throw new PacketError('bad_version');
    const flags = dv.getUint16(6, true);
    if ((flags & ~7) !== 0) throw new PacketError('bad_flags');
    const len = dv.getUint32(24, true);
    if (len !== bytes.byteLength) throw new PacketError('bad_length');
    const n = dv.getUint16(22, true);
    this.secOff.fill(-1);
    let last = 0;
    let end = PACKET_HEADER_SIZE + n * PACKET_DIRECTORY_ENTRY_SIZE;
    if (end > len) throw new PacketError('truncated directory');
    for (let i = 0; i < n; i++) {
      const at = PACKET_HEADER_SIZE + i * PACKET_DIRECTORY_ENTRY_SIZE;
      const type = dv.getUint16(at, true);
      const facts = PACKET_SECTIONS.get(type);
      if (facts === undefined) throw new PacketError(`unknown section type ${type}`);
      if (type <= last) throw new PacketError('unsorted directory');
      last = type;
      if (dv.getUint16(at + 2, true) !== facts.recordVersion)
        throw new PacketError(`bad_version of ${facts.name}`);
      const off = dv.getUint32(at + 4, true);
      const bl = dv.getUint32(at + 8, true);
      const count = dv.getUint32(at + 12, true);
      if (off % 8 !== 0 || off < end || off + bl > len) throw new PacketError(`bad_length of ${facts.name}`);
      if (facts.recordSize !== null && bl !== count * facts.recordSize)
        throw new PacketError(`bad_count of ${facts.name}`);
      end = off + bl;
      this.secOff[type] = off;
      this.secLen[type] = bl;
      this.secCount[type] = count;
    }
    this.packets++;
    this.stateGen = dv.getUint32(8, true);
    this.tick = dv.getUint32(12, true);
    this.daylight = dv.getUint16(20, true) / 65535;
    if ((flags & PacketFlags.full) !== 0) this.reset();
    if (view !== undefined) this.setView(view);

    const S = PacketSection;
    if ((this.secOff[S.chunk_tiles] as number) >= 0) this.applyTiles(bytes, dv, S.chunk_tiles);
    if ((this.secOff[S.chunk_entities] as number) >= 0)
      this.applyRecords(bytes, dv, S.chunk_entities, ENTITY_SIZE);
    if ((this.secOff[S.chunk_objects] as number) >= 0)
      this.applyRecords(bytes, dv, S.chunk_objects, OBJECT_SIZE);
    if ((this.secOff[S.chunk_resources] as number) >= 0)
      this.applyRecords(bytes, dv, S.chunk_resources, RESOURCE_SIZE);
    if ((this.secOff[S.belt_geom] as number) >= 0) this.applyGeom(dv, S.belt_geom);
    if ((this.secOff[S.belt_retire] as number) >= 0) this.applyRetire(dv, S.belt_retire);
    this.snapshot(bytes, S.dyn, this.dyn);
    this.snapshot(bytes, S.hands, this.hands);
    this.snapshot(bytes, S.movers, this.movers);
    this.snapshot(bytes, S.belt_items, this.beltItems);
    this.dynIndex.build(this.dyn.view, this.dyn.count, DynCodec.SIZE, DynCodec.OFFSET.serial);
    this.handsIndex.build(
      this.hands.view,
      this.hands.count,
      InserterHandCodec.SIZE,
      InserterHandCodec.OFFSET.serial,
    );
    this.indexBeltItems();
  }

  /** Applies a view request's held set: chunks and lines that leave it are dropped (§15.4's retirement rules). */
  setView(view: ViewRequest | null): void {
    this.view = view;
    const held = view === null ? null : heldChunks(view);
    this.held = held;
    for (const [key, c] of this.chunks)
      if (!inRect(held, c.cx, c.cy)) {
        this.chunks.delete(key);
        this.terrainRev++;
      }
    for (const [id, l] of this.lines)
      if (held === null || l.cx1 < held.cx0 || l.cx0 > held.cx1 || l.cy1 < held.cy0 || l.cy0 > held.cy1)
        this.lines.delete(id);
  }

  private chunk(key: number): ChunkView | null {
    let c = this.chunks.get(key);
    if (c) return c;
    const [cx, cy] = chunkXY(key);
    if (this.view !== null && !inRect(this.held, cx, cy)) {
      if (this.warnings.length < 16)
        this.warnings.push(`a record names chunk ${cx},${cy} outside the held set`);
      return null;
    }
    c = {
      key,
      cx,
      cy,
      tiles: null,
      entities: EMPTY,
      entityView: EMPTY_VIEW,
      entityCount: 0,
      objects: EMPTY,
      objectView: EMPTY_VIEW,
      objectCount: 0,
      resources: EMPTY,
      resourceView: EMPTY_VIEW,
      resourceCount: 0,
      terrainRev: 0,
      versions: new Int32Array(4),
    };
    this.chunks.set(key, c);
    this.terrainRev++;
    return c;
  }

  private applyTiles(bytes: Uint8Array, dv: DataView, type: number): void {
    const off = this.secOff[type] as number;
    const count = this.secCount[type] as number;
    for (let i = 0; i < count; i++) {
      const o = off + i * TILE_RECORD;
      const c = this.chunk(dv.getUint32(o, true));
      if (c === null) continue;
      c.tiles ??= new Uint8Array(1024);
      c.tiles.set(bytes.subarray(o + 12, o + 12 + 1024));
      c.versions[0] = dv.getUint32(o + 8, true);
      c.terrainRev++;
      this.terrainRev++;
    }
  }

  private applyRecords(bytes: Uint8Array, dv: DataView, type: number, size: number): void {
    const S = PacketSection;
    const off = this.secOff[type] as number;
    const end = off + (this.secLen[type] as number);
    const count = this.secCount[type] as number;
    let o = off;
    for (let i = 0; i < count; i++) {
      if (o + CHUNK_HEADER > end) throw new PacketError('truncated chunk record');
      const key = dv.getUint32(o, true);
      const n = dv.getUint16(o + 6, true);
      const version = dv.getUint32(o + 8, true);
      const body = o + CHUNK_HEADER;
      const next = body + n * size;
      if (next > end) throw new PacketError('truncated chunk record');
      const c = this.chunk(key);
      if (c !== null) {
        const copy = n === 0 ? EMPTY : bytes.slice(body, next);
        const view = n === 0 ? EMPTY_VIEW : new DataView(copy.buffer);
        if (type === S.chunk_entities) {
          c.entities = copy;
          c.entityView = view;
          c.entityCount = n;
          c.versions[1] = version;
        } else if (type === S.chunk_objects) {
          c.objects = copy;
          c.objectView = view;
          c.objectCount = n;
          c.versions[2] = version;
          c.terrainRev++;
          this.terrainRev++;
        } else {
          c.resources = copy;
          c.resourceView = view;
          c.resourceCount = n;
          c.versions[3] = version;
        }
      }
      o = next;
    }
    if (o !== end) throw new PacketError('trailing bytes in a chunk section');
  }

  private applyGeom(dv: DataView, type: number): void {
    let o = this.secOff[type] as number;
    const end = o + (this.secLen[type] as number);
    const count = this.secCount[type] as number;
    const G = BeltGeomCodec.OFFSET;
    const SG = BeltSegmentCodec.OFFSET;
    for (let i = 0; i < count; i++) {
      const segCount = dv.getUint16(o + G.seg_count, true);
      const segAt = o + BeltGeomCodec.PREFIX;
      if (segAt + segCount * BeltSegmentCodec.SIZE > end) throw new PacketError('truncated BELT_GEOM');
      const segs = new Int32Array(segCount * 6);
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (let s = 0; s < segCount; s++) {
        const so = segAt + s * BeltSegmentCodec.SIZE;
        const x = dv.getInt32(so + SG.x, true);
        const y = dv.getInt32(so + SG.y, true);
        const len = dv.getInt32(so + SG.len, true);
        const dir = dv.getUint8(so + SG.dir);
        segs[s * 6] = x;
        segs[s * 6 + 1] = y;
        segs[s * 6 + 2] = len;
        segs[s * 6 + 3] = dir;
        segs[s * 6 + 4] = dv.getInt8(so + SG.turn);
        segs[s * 6 + 5] = dv.getInt32(so + SG.radius, true);
        // the segment's extent: its end and (at most) len positions upstream in any direction
        const reach = len + 256;
        x0 = Math.min(x0, x - reach);
        y0 = Math.min(y0, y - reach);
        x1 = Math.max(x1, x + reach);
        y1 = Math.max(y1, y + reach);
      }
      const line: BeltLine = {
        lineId: dv.getUint32(o + G.line_id, true),
        geomGen: dv.getUint32(o + G.geom_gen, true),
        lane: dv.getUint8(o + G.lane),
        speed: dv.getUint8(o + G.speed),
        length: dv.getUint32(o + G.length, true),
        segs,
        segCount,
        cx0: Math.floor(x0 / 256 / 32),
        cy0: Math.floor(y0 / 256 / 32),
        cx1: Math.floor(x1 / 256 / 32),
        cy1: Math.floor(y1 / 256 / 32),
      };
      this.lines.set(line.lineId, line);
      o = segAt + segCount * BeltSegmentCodec.SIZE;
    }
    if (o !== end) throw new PacketError('trailing bytes in BELT_GEOM');
  }

  private applyRetire(dv: DataView, type: number): void {
    const off = this.secOff[type] as number;
    const count = this.secCount[type] as number;
    for (let i = 0; i < count; i++) {
      const o = off + i * BeltRetireCodec.SIZE;
      const id = dv.getUint32(o, true);
      const gen = dv.getUint32(o + 4, true);
      const l = this.lines.get(id);
      if (l !== undefined && l.geomGen === gen) this.lines.delete(id);
    }
  }

  private snapshot(bytes: Uint8Array, type: number, snap: Snapshot): void {
    const off = this.secOff[type] as number;
    if (off < 0) snap.clear();
    else snap.set(bytes, off, this.secLen[type] as number, this.secCount[type] as number);
  }

  private indexBeltItems(): void {
    const b = this.beltItems;
    if (this.beltItemOffsets.length < b.count) this.beltItemOffsets = new Int32Array(b.count * 2);
    let o = 0;
    for (let i = 0; i < b.count; i++) {
      if (o + BeltItemsCodec.PREFIX > b.length) throw new PacketError('truncated BELT_ITEMS');
      this.beltItemOffsets[i] = o;
      const n = b.view.getUint16(o + BeltItemsCodec.OFFSET.count, true);
      let next = o + BeltItemsCodec.PREFIX + n * 2 + Math.max(0, n - 1) * 2;
      next += (4 - (next % 4)) % 4;
      o = next;
    }
    if (o !== b.length) throw new PacketError('trailing bytes in BELT_ITEMS');
  }
}

const EMPTY = new Uint8Array(0);
const EMPTY_VIEW = new DataView(new ArrayBuffer(0));

function inRect(r: ChunkRect | null, cx: number, cy: number): boolean {
  return r !== null && cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
}

/** Field offsets of the records the renderer reads in place (the generated layouts, §15.4). */
export const EV = EntityViewCodec.OFFSET;
export const OV = ObjectViewCodec.OFFSET;
export const DY = DynCodec.OFFSET;
export const HA = InserterHandCodec.OFFSET;
export const MO = MoverCodec.OFFSET;
export const RV = ResourceViewCodec.OFFSET;
