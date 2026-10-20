// The digest's slice hash (10 §4.8 item 2) and its canonical serialization, which §4.8 leaves to the sim and the
// gate settles here (GATE-r1 finding 6; README rules 37–41). Every byte of every hashed section belongs to
// exactly one member, every member to exactly one of 3,600 shards, and slice t hashes shard t mod 3,600.
import { Writer } from '../../../src/shared/gen/codec.ts';
import {
  CONTAINERPOOL_COLUMNS,
  type ContainerPoolRow,
  ENTITYTABLE_COLUMNS,
  type EntityTableRow,
} from '../../../src/shared/gen/pools.ts';
import {
  encodeGlobals,
  encodeRng,
  SECTIONS,
  SHARD_PIECE_BYTES,
  SHARDS,
} from '../../../src/shared/gen/sections.ts';
import {
  ChunkCodec,
  GeneratedChunkCodec,
  InvBarCodec,
  PlayerCodec,
  SlotFilterCodec,
  StatCodec,
} from '../../../src/shared/gen/state.ts';
import { SlotCodec } from '../../../src/shared/gen/types.ts';
import { NO_INV, SECTION_ID, type World } from './world.ts';
import { xxh64 } from './xxh64.ts';

/**
 * One member of the canonical state: its section, its order key within the section, its shard and its bytes
 * (computed only when its shard is hashed).
 */
export interface Member {
  section: number;
  key: bigint;
  shard: number;
  bytes: () => Uint8Array;
}

const mod = (n: number): number => ((n % SHARDS) + SHARDS) % SHARDS;
const TWO32 = 2n ** 32n;

/** The shard of an entity's records (§4.8): its serial mod 3,600. */
export const serialShard = (serial: number): number => mod(serial);
/** The shard of a player's records (§4.8): (1,800 + 97 × index) mod 3,600. */
export const playerShard = (index: number): number => mod(1800 + 97 * index);
/** Model decision (rule 38): a `records` section's leading u32 count is a member at (3,000 + section id). */
export const countShard = (section: number): number => mod(3000 + section);
/** Model decision (rule 39): a slot-heap arena's header (class, block size, high-water mark) at (3,100 + class). */
export const arenaShard = (cls: number): number => mod(3100 + cls);

/** A table row's canonical bytes: each column's value, in column order, at its width (little-endian). */
function rowBytes(
  cols: readonly { name: string; code: number; width: number }[],
  row: Record<string, unknown>,
): Uint8Array {
  const w = new Writer();
  for (const c of cols) {
    const v = row[c.name] as number | boolean | bigint;
    switch (c.code) {
      case 1:
        w.u8(v as number, c.name);
        break;
      case 2:
        w.u16(v as number, c.name);
        break;
      case 3:
        w.u32(v as number, c.name);
        break;
      case 5:
        w.i8(v as number, c.name);
        break;
      case 6:
        w.i16(v as number, c.name);
        break;
      case 7:
        w.i32(v as number, c.name);
        break;
      case 9:
        w.f32(v as number, c.name);
        break;
      case 10:
        w.f64(v as number, c.name);
        break;
      case 11:
        w.bool(v as boolean, c.name);
        break;
      default:
        throw new Error(`column ${c.name}: type code ${c.code} has no M0 member encoding yet`);
    }
  }
  return w.finish();
}

const u32 = (n: number): Uint8Array => {
  const w = new Writer();
  w.u32(n, 'count');
  return w.finish();
};

/** A record's stored bytes (u32 length, then its field-id triples), as the `records` encoding holds it. */
function recordBytes<T>(codec: { write(w: Writer, v: T): void }, v: T): () => Uint8Array {
  return () => {
    const w = new Writer();
    codec.write(w, v);
    return w.finish();
  };
}

/** A section's raw bytes in 4-KiB pieces, piece i at (base + i × step) mod 3,600 (sections.yaml `pieces`). */
function pieces(section: number, bytes: Uint8Array, base: number, step: number): Member[] {
  const out: Member[] = [];
  for (let i = 0; i * SHARD_PIECE_BYTES < bytes.length || (i === 0 && bytes.length === 0); i++) {
    const piece = bytes.subarray(i * SHARD_PIECE_BYTES, (i + 1) * SHARD_PIECE_BYTES);
    out.push({ section, key: BigInt(i), shard: mod(base + i * step), bytes: () => piece });
  }
  return out;
}

/**
 * A table's members (rule 37): its header (the row count) at `header_shard`, then each row: `u32` row index, then
 * the row's columns. A live row is its entity's (key and shard by serial); a free row keys and shards by index.
 */
function tableMembers(
  section: number,
  cols: readonly { name: string; code: number; width: number }[],
  rows: readonly Record<string, unknown>[],
  liveSerial: (row: Record<string, unknown>) => number,
): Member[] {
  const info = SECTIONS.find((s) => s.id === section);
  if (!info || info.headerShard === null) throw new Error(`table section ${section} has no header shard`);
  const out: Member[] = [{ section, key: 0n, shard: info.headerShard, bytes: () => u32(rows.length) }];
  rows.forEach((row, i) => {
    const serial = liveSerial(row);
    out.push({
      section,
      key: serial !== 0 ? BigInt(serial) : TWO32 + BigInt(i),
      shard: serial !== 0 ? serialShard(serial) : mod(i),
      // The row's index first: where a row sits is state too (§4.5's pool slots point at rows).
      bytes: () => {
        const b = rowBytes(cols, row);
        const out2 = new Uint8Array(4 + b.length);
        new DataView(out2.buffer).setUint32(0, i, true);
        out2.set(b, 4);
        return out2;
      },
    });
  });
  return out;
}

/** A `records` section's members: its count (rule 38), then each record in saved order. */
function recordMembers<T>(
  section: number,
  records: readonly T[],
  codec: { write(w: Writer, v: T): void },
  shard: (v: T) => number,
): Member[] {
  const out: Member[] = [{ section, key: 0n, shard: countShard(section), bytes: () => u32(records.length) }];
  records.forEach((v, j) => {
    out.push({ section, key: BigInt(j + 1), shard: shard(v), bytes: recordBytes(codec, v) });
  });
  return out;
}

/**
 * The slot heap's members (rule 39, sections.yaml `owner`): per arena, ascending class, its header, then each
 * block. A block's bytes are its slots, then its limit-bar entry and its filters (`u32` count before each list),
 * so a block carries everything the heap saves about it; its shard is its owner's: the container's entity, the
 * player whose main inventory it is, or, for a free block, its InvRef mod 3,600.
 */
function heapMembers(w: World): Member[] {
  const owners = new Map<number, number>();
  for (const c of w.containers) if (c.entity !== 0) owners.set(c.inv, serialShard(c.entity));
  for (const p of w.players) if (p.main !== NO_INV) owners.set(p.main, playerShard(p.index));
  const out: Member[] = [];
  const section = SECTION_ID.SLOT_HEAP;
  for (const a of [...w.heap.arenas.values()].filter((x) => x.blocks > 0).sort((x, y) => x.cls - y.cls)) {
    const base = BigInt(a.cls) * TWO32;
    out.push({
      section,
      key: base,
      shard: arenaShard(a.cls),
      bytes: () => {
        const b = new Writer();
        b.u8(a.cls, 'class');
        b.u16(a.blockSlots, 'block_slots');
        b.u32(a.blocks, 'blocks');
        return b.finish();
      },
    });
    for (let block = 0; block < a.blocks; block++) {
      const ref = a.cls * 2 ** 24 + block;
      out.push({
        section,
        key: base + 1n + BigInt(block),
        shard: owners.get(ref) ?? mod(ref),
        bytes: () => {
          const b = new Writer();
          for (let i = 0; i < a.blockSlots; i++)
            SlotCodec.write(b, a.slots[block * a.blockSlots + i] as never, 'slot');
          const bars = w.heap.bars.filter((x) => x.inv === ref);
          b.u32(bars.length, 'bars');
          for (const x of bars) InvBarCodec.write(b, x);
          const filters = w.heap.filters.filter((x) => x.inv === ref).sort((x, y) => x.slot - y.slot);
          b.u32(filters.length, 'filters');
          for (const x of filters) SlotFilterCodec.write(b, x);
          return b.finish();
        },
      });
    }
  }
  return out;
}

/** Every member of the canonical state, in (section id, key) order. */
export function members(w: World): Member[] {
  const out: Member[] = [
    ...tableMembers(
      SECTION_ID.ENTITY_TABLE,
      ENTITYTABLE_COLUMNS,
      w.entities as unknown as Record<string, unknown>[],
      (r) => (r as unknown as EntityTableRow).serial,
    ),
    ...pieces(SECTION_ID.GLOBALS, encodeGlobals(w.globals), 0, 1),
    ...heapMembers(w),
    ...recordMembers(
      SECTION_ID.CHUNKS,
      [...w.chunks.values()].map((c) => c.rec).sort((a, b) => a.surface - b.surface || a.key - b.key),
      ChunkCodec,
      (c) => mod(c.key),
    ),
    // TIMERS: none in M0 (by serial, or by owner when serial is 0).
    ...recordMembers(SECTION_ID.TIMERS, [] as never[], { write: () => {} }, () => 0),
    ...pieces(SECTION_ID.RNG, encodeRng([]), 1801, 1),
    ...recordMembers(SECTION_ID.PLAYERS, w.players, PlayerCodec, (p) => playerShard(p.index)),
    ...recordMembers(
      SECTION_ID.STATS,
      [...w.stats.values()].sort((a, b) => a.key - b.key),
      StatCodec,
      (s) => mod(s.key),
    ),
    // WORLDGEN_PENDING: none in M0 (by the chunk key of (cx, cy)).
    ...recordMembers(SECTION_ID.WORLDGEN_PENDING, [] as never[], { write: () => {} }, () => 0),
    ...recordMembers(SECTION_ID.GENERATED, w.generated, GeneratedChunkCodec, (c) => mod(c.key)),
    ...tableMembers(
      SECTION_ID.POOL_CONTAINER,
      CONTAINERPOOL_COLUMNS,
      w.containers as unknown as Record<string, unknown>[],
      (r) => (r as unknown as ContainerPoolRow).entity,
    ),
  ];
  return out;
}

/**
 * Slice t (§4.8 item 2; rule 40): XXH64 (seed 0) of shard t mod 3,600's members in (section id, key) order,
 * each framed as `u32 section id, u64 key, u32 length, bytes`. An empty shard hashes zero bytes.
 */
export function sliceBytes(w: World, shard: number): Uint8Array {
  const out = new Writer();
  for (const m of members(w)) {
    if (m.shard !== shard) continue;
    const b = m.bytes();
    out.u32(m.section, 'slice.section');
    out.u64(m.key, 'slice.key');
    out.u32(b.length, 'slice.length');
    out.bytes(b);
  }
  return out.finish();
}

export const sliceHash = (w: World, shard: number): bigint => xxh64(sliceBytes(w, shard));
