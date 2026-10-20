// The reference model's module: `World::tick` (10 §4.6) behind the preflight (§15.3), the per-tick digest
// (§4.8), and the ABI-shaped entry points the golden set exercises (§15.8). One SimContext = World +
// PresentationState (§3.6).

import {
  PlayerDigestCodec,
  TickDigestBodyCodec,
  TickDigestHeadCodec,
  TickDigestTailCodec,
} from '../../../src/shared/gen/abi.ts';
import { closureActions, PLAYERS, PreflightError, preflight } from '../../../src/shared/gen/actions.ts';
import { Writer } from '../../../src/shared/gen/codec.ts';
import { Presentation } from './presentation.ts';
import { applyAction, type Counters, type Ctx, charactersTick } from './rules.ts';
import { sliceHash } from './slices.ts';
import { flushStats } from './stats.ts';
import type { World } from './world.ts';
import { u64le, xxh64 } from './xxh64.ts';

/** `SimStatus` codes (§15.8) the model returns. */
export const Status = { ok: 0, framing: 1, blobMissing: 2, order: 6, input: 7, limit: 8 } as const;

/** r₀ = XXH64(u32 worldSeed ‖ u32 0) (§4.8): a new world's digest lineage. */
export function lineage0(seed: number): bigint {
  const w = new Writer();
  w.u32(seed >>> 0, 'lineage.seed');
  w.u32(0, 'lineage.zero');
  return xxh64(w.finish());
}

/** A new lineage (§4.8 item 4: remapped or migrated loads, baked saves): XXH64(u64 stateHash ‖ u32 tick). */
export function lineageOf(stateHash: bigint, tick: number): bigint {
  const w = new Writer();
  w.u64(stateHash, 'lineage.state_hash');
  w.u32(tick, 'lineage.tick');
  return xxh64(w.finish());
}

/** r_t = XXH64(r_{t−1} ‖ d_t ‖ slice_t), three little-endian u64 (§4.8 item 3). */
export function roll(r: bigint, d: bigint, slice: bigint): bigint {
  const b = new Uint8Array(24);
  b.set(u64le(r), 0);
  b.set(u64le(d), 8);
  b.set(u64le(slice), 16);
  return xxh64(b);
}

export class Sim {
  readonly w: World;
  readonly pres = new Presentation();
  /** The last tick's digest d_t (0 before any tick of this instance). */
  lastDigest = 0n;
  /** The last tick's slice hash (§4.8 item 2). */
  lastSlice = 0n;
  /** The digest lineage r (§4.8 items 3–4): `sim_load`'s, then rolled by every tick. */
  r: bigint;
  /** The bytes d_t hashed in the last tick (§4.8's sequence), for tests and the golden preimages. */
  lastDigestRecord: Uint8Array = new Uint8Array();

  /** `lineage`: the save's or checkpoint's r (`sim_load`), r₀ for a new world. */
  constructor(w: World, lineage: bigint) {
    this.w = w;
    this.r = lineage;
  }

  /**
   * `sim_tick` (§15.8): runs exactly the closure of tick `world.tick + 1`. The preflight walks the whole closure
   * with temporary watermarks and changes nothing on failure (§15.3); `blobs` holds the hex SHA-256 of the
   * blobs supplied for this tick (`sim_blob_put`).
   */
  tick(closure: Uint8Array, blobs: ReadonlySet<string> = new Set()): { status: number; reason?: string } {
    const w = this.w;
    const t = w.tick + 1;
    const lastSeq: number[] = [];
    for (let i = 0; i < PLAYERS; i++) lastSeq.push(w.player(i)?.last_seq ?? 0);
    try {
      preflight(closure, t, lastSeq, w.globals.last_system_seq, (h) =>
        blobs.has(Buffer.from(h).toString('hex')),
      );
    } catch (e) {
      if (!(e instanceof PreflightError)) throw e;
      return { status: e.code === 'framing' ? Status.framing : Status.blobMissing, reason: e.reason };
    }
    w.globals.tick = t;
    const counters: Counters = { produced: new Map(), consumed: new Map(), handcrafted: new Map() };
    const ctx: Ctx = { w, pres: this.pres, tick: t, counters };
    // Phase 1 (§4.6): the closure's batches in order, each batch's actions in seq order; then the characters.
    for (const a of closureActions(closure)) applyAction(ctx, a);
    charactersTick(ctx);
    // Phases 2–14 have nothing to do in M0: no timers, worldgen commits, energy, fluids, machines, belts,
    // inserters, agents, trains, circuits, slow fields or units.
    flushStats(w, t, counters); // phase 15
    this.digest(closure, counters); // phase 16: d_t, slice_t, r_t
    this.lastSlice = sliceHash(w, t % 3600);
    this.r = roll(this.r, this.lastDigest, this.lastSlice);
    return { status: Status.ok };
  }

  /**
   * The per-tick digest d_t (§4.8 item 1): XXH64 (seed 0) of exactly §4.8's byte sequence (abi.yaml
   * TickDigestHead ‖ RngWords per stream ‖ TickDigestBody ‖ PlayerDigest per online player ‖ TickDigestTail): the
   * tick and the closure's hash, every RNG stream's state (none in M0), the live entity count, this tick's nonzero
   * production and consumption counters in ascending key (each list after its u32 count), every online player's
   * index, position and inventory version in index order (no count), and the current research (none in M0).
   */
  private digest(closure: Uint8Array, c: Counters): void {
    const w = this.w;
    const nonzero = (m: Map<number, number>) =>
      [...m.entries()]
        .filter(([, v]) => v !== 0)
        .sort((a, b) => a[0] - b[0])
        .map(([key, value]) => ({ key, value }));
    const out = new Writer();
    TickDigestHeadCodec.write(out, { tick: w.tick, closure_hash: xxh64(closure) });
    // RngWords: the RNG section holds no stream in M0.
    TickDigestBodyCodec.write(out, {
      entity_count: w.liveEntities().length,
      produced: nonzero(c.produced),
      consumed: nonzero(c.consumed),
    });
    for (const p of w.players.filter((q) => q.online).sort((a, b) => a.index - b.index))
      PlayerDigestCodec.write(out, {
        index: p.index,
        x: p.x,
        y: p.y,
        inventory_version: p.inventory_version,
      });
    TickDigestTailCodec.write(out, { research_tech: 0xffff, research_progress: 0 });
    const rec = out.finish();
    this.lastDigestRecord = rec;
    this.lastDigest = xxh64(rec);
  }
}
