// The input layer's slice of the view model (10 §3.4): the held chunks' tiles, entity records and resource
// tiles, and the movers, rebuilt from packets, for hover selection, reach hints and the M0 stand-in plate. The
// renderer (C4) keeps the full mirror; when it is wired, this one can read from it instead. Rules: a FULL packet
// drops everything; a chunk's records are replaced whenever it is re-sent; snapshot sections (MOVERS) list
// everything there is, and an absent one means none; chunks that leave the held set are dropped when the
// packet answering the view that dropped them arrives (§15.4).
import { Reader } from '../../shared/gen/codec.ts';
import {
  ChunkEntitiesCodec,
  type ChunkRect,
  ChunkResourcesCodec,
  ChunkTilesCodec,
  chunkKey,
  chunkXY,
  type EntityView,
  heldChunks,
  type Mover,
  MoverCodec,
  type Packet,
  PacketFlags,
  type ResourceView,
  type ViewRequest,
} from '../../shared/gen/packet.ts';

export interface MirrorChunk {
  key: number;
  cx: number;
  cy: number;
  tiles: Uint8Array | null;
  entities: EntityView[];
  resources: ResourceView[];
}

export class Mirror {
  readonly chunks = new Map<number, MirrorChunk>();
  movers: Mover[] = [];
  tick = 0;
  /** Bumped whenever anything the plate draws changes. */
  version = 0;
  private views = new Map<number, ChunkRect | null>();

  /** Remembers a view request so the packet answering it can evict what left the held set. */
  sentView(v: ViewRequest): void {
    this.views.set(v.view_seq, heldChunks(v));
    if (this.views.size > 64) {
      const first = this.views.keys().next().value as number;
      this.views.delete(first);
    }
  }

  clear(): void {
    this.chunks.clear();
    this.movers = [];
    this.version++;
  }

  private chunk(key: number): MirrorChunk {
    let c = this.chunks.get(key);
    if (!c) {
      const [cx, cy] = chunkXY(key);
      c = { key, cx, cy, tiles: null, entities: [], resources: [] };
      this.chunks.set(key, c);
    }
    return c;
  }

  apply(p: Packet): void {
    this.tick = p.header.tick;
    if ((p.header.flags & PacketFlags.full) !== 0) this.clear();
    let movers: Mover[] = [];
    for (const s of p.sections) {
      if (s.name === 'CHUNK_TILES') {
        const r = new Reader(s.bytes);
        for (let i = 0; i < s.count; i++) {
          const t = ChunkTilesCodec.read(r);
          this.chunk(t.chunk_key).tiles = Uint8Array.from(t.tiles);
        }
      } else if (s.name === 'CHUNK_ENTITIES') {
        const r = new Reader(s.bytes);
        for (let i = 0; i < s.count; i++) {
          const c = ChunkEntitiesCodec.read(r);
          this.chunk(c.chunk_key).entities = c.entities;
        }
      } else if (s.name === 'CHUNK_RESOURCES') {
        const r = new Reader(s.bytes);
        for (let i = 0; i < s.count; i++) {
          const c = ChunkResourcesCodec.read(r);
          this.chunk(c.chunk_key).resources = c.resources;
        }
      } else if (s.name === 'MOVERS') {
        const r = new Reader(s.bytes);
        movers = [];
        for (let i = 0; i < s.count; i++) movers.push(MoverCodec.read(r));
      }
    }
    this.movers = movers;
    const held = this.views.get(p.header.view_seq);
    if (held !== undefined) {
      for (const [key, c] of this.chunks)
        if (held === null || c.cx < held.cx0 || c.cx > held.cx1 || c.cy < held.cy0 || c.cy > held.cy1)
          this.chunks.delete(key);
      for (const k of [...this.views.keys()]) if (k < p.header.view_seq) this.views.delete(k);
    }
    this.version++;
  }

  /** A mover by its serial (the character's position, I §3.1 reach). */
  mover(serial: number): Mover | undefined {
    return this.movers.find((m) => m.serial === serial);
  }

  /** The tile id at a tile, if its chunk is held. */
  tileAt(tx: number, ty: number): number | null {
    const c = this.chunks.get(chunkKey(tx >> 5, ty >> 5));
    if (!c?.tiles) return null;
    return c.tiles[(ty & 31) * 32 + (tx & 31)] ?? null;
  }

  /** The resource on a tile, if any. */
  resourceAt(tx: number, ty: number): ResourceView | null {
    const c = this.chunks.get(chunkKey(tx >> 5, ty >> 5));
    if (!c) return null;
    const idx = (ty & 31) * 32 + (tx & 31);
    return c.resources.find((r) => r.tile === idx) ?? null;
  }

  /** Every held entity (callers filter by box; M0's views hold a few hundred). */
  *entities(): Generator<EntityView> {
    for (const c of this.chunks.values()) yield* c.entities;
  }

  entity(serial: number): EntityView | undefined {
    for (const e of this.entities()) if (e.serial === serial) return e;
    return undefined;
  }
}
