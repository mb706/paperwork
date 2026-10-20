// The reference model's World (10 §4.4–§4.5, §8.1): the authoritative state, saved and hashed exactly as the
// save sections say, plus the derived indexes a load rebuilds. Presentation state (§3.6) lives apart, in
// presentation.ts. Everything here is written for obvious correctness, not speed: linear scans, plain arrays.
import { Writer } from '../../../src/shared/gen/codec.ts';
import { SectionFlags, type SectionFrame } from '../../../src/shared/gen/container.ts';
import {
  type ContainerPoolRow,
  decodeContainerPool,
  decodeEntityTable,
  defaultContainerPoolRow,
  defaultEntityTableRow,
  type EntityTableRow,
  encodeContainerPool,
  encodeEntityTable,
} from '../../../src/shared/gen/pools.ts';
import {
  decodeChunks,
  decodeGenerated,
  decodeGlobals,
  decodePlayers,
  decodeRng,
  decodeSlotHeap,
  decodeStats,
  decodeTimers,
  decodeWorldgenPending,
  encodeChunks,
  encodeGenerated,
  encodeGlobals,
  encodePlayers,
  encodeRng,
  encodeSlotHeap,
  encodeStats,
  encodeTimers,
  encodeWorldgenPending,
  SECTIONS,
} from '../../../src/shared/gen/sections.ts';
import type {
  Chunk,
  GeneratedChunk,
  Globals,
  InvBar,
  Player,
  SlotFilter,
  Stat,
} from '../../../src/shared/gen/state.ts';
import type { Slot } from '../../../src/shared/gen/types.ts';
import type { Protos } from './protos.ts';
import { u64le, xxh64 } from './xxh64.ts';

/** M0 has one surface (§4.4). */
export const SURFACE = 0;
/** `ItemKey`'s none: an empty slot's and an empty hand's key (types.yaml `Slot`). */
export const NO_ITEM = 0xffff;
/** The u16 "none" of slot indexes and ids. */
export const NONE16 = 0xffff;
/** `InvRef`'s none. */
export const NO_INV = 0xffffffff;

export const SECTION_ID = {
  ENTITY_TABLE: 1,
  GLOBALS: 2,
  SLOT_HEAP: 3,
  CHUNKS: 5,
  TIMERS: 9,
  RNG: 10,
  PLAYERS: 11,
  STATS: 13,
  WORLDGEN_PENDING: 16,
  GENERATED: 17,
  POOL_CONTAINER: 32,
} as const;

// ------------------------------------------------------------------------------------------- chunks

/** The chunk key of chunk (cx, cy) (§4.4): (cx + 2¹⁵) × 2¹⁶ + (cy + 2¹⁵). */
export function chunkKey(cx: number, cy: number): number {
  return (cx + 32768) * 65536 + (cy + 32768);
}

/** The chunk (cx, cy) of a key. */
export function chunkXY(key: number): [number, number] {
  return [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];
}

/** The chunk coordinate of a tile coordinate (32 tiles per chunk, flooring toward −∞). */
export const tileToChunk = (t: number): number => Math.floor(t / 32);

/** The index of tile (tx, ty) in its chunk's 1,024 tiles: row-major (packet.yaml `ChunkTiles`). */
export const tileIndex = (tx: number, ty: number): number =>
  (ty - 32 * tileToChunk(ty)) * 32 + (tx - 32 * tileToChunk(tx));

/**
 * A chunk as the World holds it: the saved `chunk` record (CHUNKS, §8.1) and its four view versions, which
 * are derived presentation counters (§4.4, §15.4): never saved, never read by a rule. Model decision: they
 * start at 1 when a world is loaded or created, and each rises by one when its part of the chunk changes.
 */
export interface ChunkState {
  rec: Chunk;
  view: { tiles: number; entities: number; objects: number; resources: number };
}

// ------------------------------------------------------------------------------------------- the slot heap

/**
 * Size classes of the slot heap (§4.5): powers of two up to 128 slots, then multiples of 64. Model decision:
 * the class id stored in `InvRef` (bits 24–31) and in `slot_arena.class` is the index in this sequence, so
 * class 5 holds 32-slot blocks and class 7 128-slot blocks; an inventory owns a block of the smallest class
 * that holds it (the character's 80 slots: class 7, slots 80–127 stay empty).
 */
export function classSlots(cls: number): number {
  return cls <= 7 ? 2 ** cls : 128 + 64 * (cls - 7);
}

export function classFor(slots: number): number {
  let c = 0;
  while (classSlots(c) < slots) c++;
  return c;
}

export const invClass = (ref: number): number => Math.floor(ref / 2 ** 24);
export const invBlock = (ref: number): number => ref % 2 ** 24;
export const invRef = (cls: number, block: number): number => cls * 2 ** 24 + block;

export interface Arena {
  cls: number;
  blockSlots: number;
  /** The high-water mark: blocks ever used (saved). */
  blocks: number;
  /** blocks × blockSlots slots, block-major. */
  slots: Slot[];
}

/**
 * The slot heap (§4.5). A block is free exactly when no live inventory owns it; allocation takes the lowest
 * free block of the class, else a new block at the high-water mark. Model decision on "freed blocks are
 * zeroed": an empty slot is always `{key: none, count: 0}` (types.yaml `Slot`), in live and freed blocks
 * alike, so a freed block holds empty slots.
 */
export class Heap {
  readonly arenas = new Map<number, Arena>();
  /** The limit bars (§4.5's parallel sparse arrays): one entry per limited inventory, ascending by `inv`. */
  bars: InvBar[] = [];
  /** Slot filters (M0 has no action that sets one). */
  filters: SlotFilter[] = [];
  /** Derived: the blocks live inventories own. */
  readonly owned = new Set<number>();

  alloc(slots: number): number {
    const cls = classFor(slots);
    let a = this.arenas.get(cls);
    if (!a) {
      a = { cls, blockSlots: classSlots(cls), blocks: 0, slots: [] };
      this.arenas.set(cls, a);
    }
    let block = 0;
    while (block < a.blocks && this.owned.has(invRef(cls, block))) block++;
    if (block === a.blocks) {
      a.blocks++;
      for (let i = 0; i < a.blockSlots; i++) a.slots.push({ key: NO_ITEM, count: 0 });
    }
    const ref = invRef(cls, block);
    this.owned.add(ref);
    return ref;
  }

  free(ref: number): void {
    const a = this.arena(ref);
    const base = invBlock(ref) * a.blockSlots;
    for (let i = 0; i < a.blockSlots; i++) a.slots[base + i] = { key: NO_ITEM, count: 0 };
    this.owned.delete(ref);
    this.bars = this.bars.filter((b) => b.inv !== ref);
    this.filters = this.filters.filter((f) => f.inv !== ref);
  }

  arena(ref: number): Arena {
    const a = this.arenas.get(invClass(ref));
    if (!a || invBlock(ref) >= a.blocks) throw new Error(`no slot-heap block ${ref}`);
    return a;
  }

  /** The `i`-th slot of the block `ref` (a live object: rules assign its fields). */
  slot(ref: number, i: number): Slot {
    const a = this.arena(ref);
    if (i < 0 || i >= a.blockSlots) throw new Error(`slot ${i} outside block ${ref}`);
    return a.slots[invBlock(ref) * a.blockSlots + i] as Slot;
  }

  /** The limit bar of an inventory of `size` slots: slots from it on are locked; `size` when unlimited. */
  bar(ref: number, size: number): number {
    return this.bars.find((b) => b.inv === ref)?.bar ?? size;
  }

  setBar(ref: number, bar: number, size: number): void {
    this.bars = this.bars.filter((b) => b.inv !== ref);
    // Model decision: an unlimited inventory has no entry (canonical: bar = size is the same as none).
    if (bar < size) {
      this.bars.push({ inv: ref, bar });
      this.bars.sort((a, b) => a.inv - b.inv);
    }
  }
}

// ------------------------------------------------------------------------------------------- the World

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class World {
  readonly protos: Protos;
  globals: Globals;
  /** Modified chunks (CHUNKS), by chunk key; M0 has one surface. */
  readonly chunks = new Map<number, ChunkState>();
  /** Every generated chunk (GENERATED), ascending by (surface, key). */
  generated: GeneratedChunk[] = [];
  /** The entity table (ENTITY_TABLE): rows up to the high-water mark; a row is live when `serial` ≠ 0. */
  entities: EntityTableRow[] = [];
  /** The container pool (POOL_CONTAINER): a row is live when `entity` (a serial when saved) ≠ 0. */
  containers: ContainerPoolRow[] = [];
  readonly heap = new Heap();
  /** PLAYERS, ascending by index. */
  players: Player[] = [];
  /** STATS, by stat key. */
  readonly stats = new Map<number, Stat>();
  /** Derived (§4.3): serial → entity-table row. */
  readonly serialIndex = new Map<number, number>();

  constructor(protos: Protos, globals: Globals) {
    this.protos = protos;
    this.globals = globals;
  }

  get tick(): number {
    return this.globals.tick;
  }

  // --------------------------------------------------------------------------- map, tiles, chunks

  /**
   * The map's tile bounds (§5.18, 07 §17), upper bounds exclusive. Model decision: Factorio's centred
   * map: width W covers x in [−⌊W/2⌋, W − ⌊W/2⌋); 0 = unbounded.
   */
  mapBounds(): Rect {
    const { width, height } = this.globals.map;
    const big = 2 ** 31;
    return {
      x0: width === 0 ? -big : -Math.floor(width / 2),
      x1: width === 0 ? big : width - Math.floor(width / 2),
      y0: height === 0 ? -big : -Math.floor(height / 2),
      y1: height === 0 ? big : height - Math.floor(height / 2),
    };
  }

  inMap(tx: number, ty: number): boolean {
    const b = this.mapBounds();
    return tx >= b.x0 && tx < b.x1 && ty >= b.y0 && ty < b.y1;
  }

  chunkAt(tx: number, ty: number): ChunkState | undefined {
    return this.chunks.get(chunkKey(tileToChunk(tx), tileToChunk(ty)));
  }

  /**
   * The tile id at (tx, ty), or null where nothing is generated. M0's golden map is fully generated and
   * stored as modified chunks, so no pristine chunk is ever regenerated (§4.4).
   */
  tileAt(tx: number, ty: number): number | null {
    const c = this.chunkAt(tx, ty);
    return c ? (c.rec.tiles[tileIndex(tx, ty)] as number) : null;
  }

  /** Walkable (§4.4, §5.18): in the map, generated, and a tile with a walking speed. */
  walkable(tx: number, ty: number): boolean {
    const t = this.tileAt(tx, ty);
    return t !== null && this.inMap(tx, ty) && (this.protos.tile[t]?.walkable ?? false);
  }

  buildable(tx: number, ty: number): boolean {
    const t = this.tileAt(tx, ty);
    return t !== null && this.inMap(tx, ty) && (this.protos.tile[t]?.buildable ?? false);
  }

  // --------------------------------------------------------------------------- entities

  /** The entity-table row of a live entity, by serial (§4.3: never by position, D23). */
  entityBySerial(serial: number): EntityTableRow | undefined {
    const row = this.serialIndex.get(serial);
    return row === undefined ? undefined : this.entities[row];
  }

  liveEntities(): EntityTableRow[] {
    return this.entities.filter((e) => e.serial !== 0).sort((a, b) => a.serial - b.serial);
  }

  /** An entity's collision box in tiles (prototypes.bin `collision_*`, around its centre x2/2, y2/2). */
  collisionBox(e: EntityTableRow): Rect {
    const p = this.protos.entity[e.proto];
    if (!p) throw new Error(`no entity prototype ${e.proto}`);
    return {
      x0: e.x2 / 2 + p.collision_x0,
      y0: e.y2 / 2 + p.collision_y0,
      x1: e.x2 / 2 + p.collision_x1,
      y1: e.y2 / 2 + p.collision_y1,
    };
  }

  /** The container-pool row of a live chest. */
  container(e: EntityTableRow): ContainerPoolRow {
    const c = this.containers[e.pool_slot];
    if (!c || c.entity !== e.serial) throw new Error(`entity ${e.serial} has no container row`);
    return c;
  }

  /**
   * Allocates an entity-table row and a container-pool row, lowest free slot first (§4.5). Model decision on
   * handle generations: a row's `gen` rises when the row is handed out, cycling 1 … 1,023, so a live entity's
   * generation is never 0 and slot 0 of generation 0 (handle 0, "none") is never handed out; a freed row keeps
   * its `gen` (state.yaml `keep`).
   */
  allocEntity(fields: Omit<EntityTableRow, 'gen' | 'pool_slot'>, inventorySlots: number): EntityTableRow {
    let row = this.entities.findIndex((e) => e.serial === 0);
    if (row < 0) {
      row = this.entities.length;
      this.entities.push(defaultEntityTableRow());
    }
    let slot = this.containers.findIndex((c) => c.entity === 0);
    if (slot < 0) {
      slot = this.containers.length;
      this.containers.push(defaultContainerPoolRow());
    }
    const gen = ((this.entities[row] as EntityTableRow).gen % 1023) + 1;
    const e: EntityTableRow = { ...fields, gen, pool_slot: slot };
    this.entities[row] = e;
    this.containers[slot] = { entity: e.serial, inv: this.heap.alloc(inventorySlots) };
    this.serialIndex.set(e.serial, row);
    return e;
  }

  /** Frees an entity's rows and its inventory block (§4.5: freed columns at their defaults, `gen` kept). */
  freeEntity(e: EntityTableRow): void {
    const row = this.serialIndex.get(e.serial);
    if (row === undefined) throw new Error(`entity ${e.serial} is not live`);
    const c = this.container(e);
    this.heap.free(c.inv);
    this.containers[e.pool_slot] = defaultContainerPoolRow();
    this.entities[row] = { ...defaultEntityTableRow(), gen: e.gen };
    this.serialIndex.delete(e.serial);
  }

  nextSerial(): number {
    const s = this.globals.next_serial;
    this.globals.next_serial = s + 1;
    return s;
  }

  // --------------------------------------------------------------------------- players

  player(index: number): Player | undefined {
    return this.players.find((p) => p.index === index);
  }

  /** The main inventory's size: the character prototype's `inventory_slots` (80, I §4.4). */
  mainSize(): number {
    return (this.protos.entity[this.protos.character] as { inventory_slots: number }).inventory_slots;
  }

  // --------------------------------------------------------------------------- save and load (§8.1)

  /**
   * The hashed sections in ascending id, as `sim_save` writes them (codec raw): every hashed section the
   * schema declares, empty ones included (model decision: a save always carries all of them).
   */
  sections(): { id: number; bytes: Uint8Array }[] {
    const g = this.globals;
    const chunks = [...this.chunks.values()]
      .map((c) => c.rec)
      .sort((a, b) => a.surface - b.surface || a.key - b.key);
    const arenas = [...this.heap.arenas.values()]
      .filter((a) => a.blocks > 0)
      .sort((a, b) => a.cls - b.cls)
      .map((a) => ({ class: a.cls, block_slots: a.blockSlots, blocks: a.blocks, slots: a.slots }));
    const out: { id: number; bytes: Uint8Array }[] = [
      { id: SECTION_ID.ENTITY_TABLE, bytes: encodeEntityTable(this.entities) },
      { id: SECTION_ID.GLOBALS, bytes: encodeGlobals(g) },
      {
        id: SECTION_ID.SLOT_HEAP,
        bytes: encodeSlotHeap({ arenas, filters: this.heap.filters, bars: this.heap.bars }),
      },
      { id: SECTION_ID.CHUNKS, bytes: encodeChunks(chunks) },
      { id: SECTION_ID.TIMERS, bytes: encodeTimers([]) },
      { id: SECTION_ID.RNG, bytes: encodeRng([]) },
      { id: SECTION_ID.PLAYERS, bytes: encodePlayers(this.players) },
      { id: SECTION_ID.STATS, bytes: encodeStats([...this.stats.values()].sort((a, b) => a.key - b.key)) },
      { id: SECTION_ID.WORLDGEN_PENDING, bytes: encodeWorldgenPending([]) },
      { id: SECTION_ID.GENERATED, bytes: encodeGenerated(this.generated) },
      { id: SECTION_ID.POOL_CONTAINER, bytes: encodeContainerPool(this.containers) },
    ];
    return out;
  }

  /** The sections as container frames (codec raw, the HASHED flag on hashed sections). */
  frames(): SectionFrame[] {
    return this.sections().map(({ id, bytes }) => {
      const info = SECTIONS.find((s) => s.id === id);
      if (!info) throw new Error(`unknown section ${id}`);
      return {
        id,
        version: info.version,
        codec: 0,
        flags: info.hashed ? SectionFlags.hashed : 0,
        raw_length: bytes.length,
        data: bytes,
      };
    });
  }

  /**
   * The full state hash (§4.8): XXH64 (seed 0) over every hashed section in ascending id, each prefixed by
   * its id and raw length (u32 each). Model decision: a section's own hash (`sim_state_hash`'s list) is the
   * XXH64 of its bytes alone.
   */
  stateHash(): { hash: bigint; sections: { id: number; hash: bigint }[] } {
    const w = new Writer();
    const sections: { id: number; hash: bigint }[] = [];
    for (const { id, bytes } of this.sections()) {
      w.u32(id, 'StateHash.id');
      w.u32(bytes.length, 'StateHash.length');
      w.bytes(bytes);
      sections.push({ id, hash: xxh64(bytes) });
    }
    return { hash: xxh64(w.finish()), sections };
  }

  /**
   * `sim_load`'s refusals before reading state (§8.1, §8.3, §4.4), as `SimStatus` names: a section newer than
   * this build's (`err_load_format`); a section the schema cannot read (`err_load_schema`, from the decoders);
   * another worldgen version or worldgen data hash while some generated chunk is pristine
   * (`err_worldgen`). Model decision: a save whose every generated chunk is stored (baked, §4.4) loads under
   * another worldgen pair.
   */
  static check(
    frames: readonly { id: number; version: number; data: Uint8Array }[],
    build: { worldgenVersion: number; worldgenDataHash: Uint8Array },
  ): 'ok' | 'err_load_format' | 'err_worldgen' {
    for (const f of frames) {
      const info = SECTIONS.find((s) => s.id === f.id);
      if (info && f.version > info.version) return 'err_load_format';
    }
    const g = frames.find((f) => f.id === SECTION_ID.GLOBALS);
    const gen = frames.find((f) => f.id === SECTION_ID.GENERATED);
    const chunks = frames.find((f) => f.id === SECTION_ID.CHUNKS);
    if (!g || !gen || !chunks) return 'err_load_format';
    const globals = decodeGlobals(g.data);
    const same =
      globals.worldgen_version === build.worldgenVersion &&
      globals.worldgen_data_hash.bytes.every((b, i) => b === build.worldgenDataHash[i]);
    if (same) return 'ok';
    const stored = new Set(decodeChunks(chunks.data).map((c) => `${c.surface}:${c.key}`));
    const pristine = decodeGenerated(gen.data).some((c) => !stored.has(`${c.surface}:${c.key}`));
    return pristine ? 'err_worldgen' : 'ok';
  }

  /** Loads the sections of a save (§8.1, §8.3: lenient reads), then rebuilds what is derived. */
  static load(protos: Protos, frames: readonly { id: number; data: Uint8Array }[]): World {
    const get = (id: number): Uint8Array => {
      const f = frames.find((x) => x.id === id);
      if (!f) throw new Error(`the save lacks section ${id}`);
      return f.data;
    };
    const w = new World(protos, decodeGlobals(get(SECTION_ID.GLOBALS)));
    w.entities = decodeEntityTable(get(SECTION_ID.ENTITY_TABLE));
    w.containers = decodeContainerPool(get(SECTION_ID.POOL_CONTAINER));
    const heap = decodeSlotHeap(get(SECTION_ID.SLOT_HEAP));
    for (const a of heap.arenas)
      w.heap.arenas.set(a.class, {
        cls: a.class,
        blockSlots: a.block_slots,
        blocks: a.blocks,
        slots: a.slots,
      });
    w.heap.bars = heap.bars;
    w.heap.filters = heap.filters;
    for (const c of decodeChunks(get(SECTION_ID.CHUNKS)))
      w.chunks.set(c.key, { rec: c, view: { tiles: 1, entities: 1, objects: 1, resources: 1 } });
    if (decodeTimers(get(SECTION_ID.TIMERS)).length > 0) throw new Error('M0 has no timers');
    if (decodeRng(get(SECTION_ID.RNG)).length > 0) throw new Error('M0 has no RNG streams');
    w.players = decodePlayers(get(SECTION_ID.PLAYERS));
    for (const s of decodeStats(get(SECTION_ID.STATS))) w.stats.set(s.key, s);
    if (decodeWorldgenPending(get(SECTION_ID.WORLDGEN_PENDING)).length > 0)
      throw new Error('the golden map is fully generated: no pending worldgen request');
    w.generated = decodeGenerated(get(SECTION_ID.GENERATED));
    w.rebuild();
    return w;
  }

  /** Rebuilds the derived state (§8.1 "derived, rebuilt on load"): the serial index and block ownership. */
  rebuild(): void {
    this.serialIndex.clear();
    this.entities.forEach((e, row) => {
      if (e.serial !== 0) this.serialIndex.set(e.serial, row);
    });
    this.heap.owned.clear();
    for (const c of this.containers) if (c.entity !== 0) this.heap.owned.add(c.inv);
    for (const p of this.players) if (p.main !== NO_INV) this.heap.owned.add(p.main);
  }
}

/** The bytes of a u64 digest or hash, little-endian (§4.8: XXH64 values are u64). */
export const le64 = u64le;
