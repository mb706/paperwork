// The reference model behind the WebAssembly ABI (10 §15.8; abi.yaml `sim_exports`, `gen_exports`): each export's
// call order, input decoding, status and envelope, as the golden ABI traces (m0/abi/traces.json) pin them. The
// sim's real module must answer every traced call identically; inputs are the bytes the shell writes into
// `sim_input`, outputs the envelope bytes it reads back.
import {
  BlobPutCodec,
  ChunkDataCodec,
  GenInitInputCodec,
  InitInputCodec,
  LoadInputCodec,
  LoadReportCodec,
  NewWorldCodec,
  PendingChunksCodec,
  PreviewRequestCodec,
  QueryInputCodec,
  QueryStepOutputCodec,
  SaveFlags,
  SaveInputCodec,
  SaveOutputCodec,
  SimMetaCodec,
  SimStatus,
  SubscribeInputCodec,
  UnsubscribeInputCodec,
} from '../../../src/shared/gen/abi.ts';
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import { ViewRequestCodec } from '../../../src/shared/gen/packet.ts';
import { DigestResultCodec, StateHashCodec } from '../../../src/shared/gen/projections.ts';
import { readPrototypesBin } from '../../../src/shared/gen/protos.ts';
import { SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import { SimFlags } from '../../../src/shared/gen/types.ts';
import { Extractor } from './extract.ts';
import { runQuery } from './projections.ts';
import { loadProtos, type Protos, WORLDGEN_VERSION, worldgenDataHash } from './protos.ts';
import { applyRemaps, type Removed } from './remap.ts';
import { lineage0, lineageOf, Sim, Status } from './sim.ts';
import { World } from './world.ts';

export interface CallResult {
  status: number;
  /** The envelope's bytes, for envelope exports that succeeded. */
  out?: Uint8Array;
}

const ok = (out?: Uint8Array): CallResult => (out ? { status: SimStatus.ok, out } : { status: SimStatus.ok });
const err = (status: number): CallResult => ({ status });

/** Decodes with a generated codec; a decoder error is ERR_INPUT (§15.8: every input is validated). */
function decode<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

const KNOWN_FLAGS = SimFlags.no_sleep | SimFlags.historical | SimFlags.profile;

export class Module {
  protos: Protos | null = null;
  protosBin: Uint8Array | null = null;
  sim: Sim | null = null;
  x = new Extractor();
  /** The last world call (§15.8: sim_load_report answers only after sim_load). */
  private lastWorldCall: 'new_world' | 'load' | null = null;
  private report: { new_lineage: boolean; r: bigint; removed: Removed[] } | null = null;
  private flags = 0;
  private blobs = new Set<string>();
  /** Running queries in arrival order (§15.5: at most 4). */
  private queries: { id: number; kind: number; flags: number; params: Uint8Array; first: number }[] = [];

  // ----------------------------------------------------------------------------------------------- sim

  sim_init(input: Uint8Array): CallResult {
    const v = decode(() => InitInputCodec.decode(input));
    if (!v || (v.flags & ~KNOWN_FLAGS) !== 0) return err(SimStatus.err_input);
    // prototypes.bin must carry this build's schema hash (§2.3, §15.2).
    const ok2 = decode(() => readPrototypesBin(v.protos, Buffer.from(SCHEMA_HASH, 'hex')));
    if (!ok2) return err(SimStatus.err_protos);
    this.protos = loadProtos(v.protos);
    this.protosBin = v.protos;
    this.flags = v.flags;
    this.sim = null;
    this.lastWorldCall = null;
    this.report = null;
    this.x = new Extractor();
    this.queries = [];
    return ok();
  }

  /**
   * sim_new_world (§15.8). Model scope: M0's golden worlds are loaded, never generated (the model has no
   * worldgen), so a new world here holds its settings and nothing else; the traces pin only its status.
   */
  sim_new_world(input: Uint8Array): CallResult {
    if (!this.protos) return err(SimStatus.err_order);
    const nw = decode(() => NewWorldCodec.decode(input, true));
    if (!nw) return err(SimStatus.err_input);
    const w = new World(this.protos, {
      tick: 0,
      seed: nw.seed,
      map: nw.map,
      world: nw.world,
      game: nw.game,
      surfaces: [{ index: 0 }],
      worldgen_version: WORLDGEN_VERSION,
      worldgen_data_hash: { bytes: worldgenDataHash(this.protosBin as Uint8Array) },
      next_serial: 1,
      last_system_seq: 0,
    });
    this.sim = new Sim(w, lineage0(nw.seed));
    this.lastWorldCall = 'new_world';
    this.report = null;
    this.x = new Extractor();
    this.queries = [];
    return ok();
  }

  sim_load(input: Uint8Array): CallResult {
    if (!this.protos || !this.protosBin) return err(SimStatus.err_order);
    const build = { worldgenVersion: WORLDGEN_VERSION, worldgenDataHash: worldgenDataHash(this.protosBin) };
    const v = decode(() => LoadInputCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    const frames = v.sections.map((f) => ({ id: f.id, version: f.version, data: f.data }));
    const verdict = World.check(frames, build);
    if (verdict !== 'ok') return err(SimStatus[verdict]);
    const w = decode(() => World.load(this.protos as Protos, frames));
    if (!w) return err(SimStatus.err_load_schema);
    let removed: Removed[] = [];
    if (v.remaps.length > 0) {
      removed = applyRemaps(w, v.remaps);
      w.rebuild();
    }
    // §4.8 item 4: a remapping load starts a new lineage over the resulting state.
    const fresh = v.remaps.length > 0;
    const r = fresh ? lineageOf(w.stateHash().hash, w.tick) : v.r;
    this.sim = new Sim(w, r);
    if ((this.flags & SimFlags.historical) !== 0) this.sim.pres.events.historical = true;
    this.lastWorldCall = 'load';
    this.report = { new_lineage: fresh, r, removed };
    this.x = new Extractor();
    this.queries = [];
    return ok();
  }

  sim_tick(closure: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const r = this.sim.tick(closure, this.blobs);
    this.blobs = new Set(); // a blob is held for the next tick only (§15.3)
    return err(r.status === Status.ok ? SimStatus.ok : r.status);
  }

  sim_set_flags(flags: number): CallResult {
    if ((flags & ~KNOWN_FLAGS) !== 0) return err(SimStatus.err_input);
    this.flags = flags;
    if (this.sim) this.sim.pres.events.historical = (flags & SimFlags.historical) !== 0;
    return ok();
  }

  sim_blob_put(input: Uint8Array): CallResult {
    const v = decode(() => BlobPutCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    this.blobs.add(Buffer.from(v.sha256.bytes).toString('hex'));
    return ok();
  }

  /** M0's golden worlds are fully stored, so nothing is ever pending, and a supplied chunk is ignored (§15.8). */
  sim_supply_chunk(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    if (!decode(() => ChunkDataCodec.decode(input, true))) return err(SimStatus.err_input);
    return ok();
  }

  sim_pending_chunks(): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    return ok(PendingChunksCodec.encode({ requests: [] }));
  }

  sim_extract(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const view = decode(() => ViewRequestCodec.decode(input));
    if (!view) return err(SimStatus.err_input);
    this.x.view = view;
    return ok(this.x.extract(this.sim));
  }

  sim_subscribe(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const v = decode(() => SubscribeInputCodec.decode(input));
    if (!v || !this.x.subscribe(v.subs)) return err(SimStatus.err_input);
    return ok();
  }

  sim_unsubscribe(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const v = decode(() => UnsubscribeInputCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    this.x.unsubscribe(v.ids);
    return ok();
  }

  sim_query(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const v = decode(() => QueryInputCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    if (this.queries.length >= 4) return err(SimStatus.err_limit);
    this.queries.push({
      id: v.id,
      kind: v.header.kind,
      flags: v.header.flags,
      params: v.params,
      first: this.sim.w.tick,
    });
    return ok();
  }

  /**
   * sim_query_step (§15.5): advances the running queries in arrival order by at most `units` of work and returns
   * those that finished. Model decision (rule 45): each M0 query is one unit of work, so `units` queries finish;
   * the traces pin `units` 0 (none) and 0xFFFFFFFF (all), which every cost model agrees on.
   */
  sim_query_step(units: number): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const sim = this.sim;
    const done = this.queries.slice(0, units);
    this.queries = this.queries.slice(done.length);
    const results = done.map((q) => {
      const a = runQuery(sim, q.kind, q.flags, q.params);
      const body = a.ok ? a.body : new Uint8Array([a.reason & 0xff, a.reason >> 8]);
      return { id: q.id, ok: a.ok, flags: 0, first_tick: q.first, last_tick: sim.w.tick, body };
    });
    return ok(QueryStepOutputCodec.encode({ results }));
  }

  sim_query_cancel(id: number): CallResult {
    this.queries = this.queries.filter((q) => q.id !== id);
    return ok();
  }

  sim_digest(): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    return ok(DigestResultCodec.encode({ tick: this.sim.w.tick, d: this.sim.lastDigest, r: this.sim.r }));
  }

  sim_state_hash(): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const h = this.sim.w.stateHash();
    return ok(
      StateHashCodec.encode({
        hash: h.hash,
        sections: h.sections.map((s) => ({ section: s.id, hash: s.hash })),
      }),
    );
  }

  sim_save(input: Uint8Array): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const v = decode(() => SaveInputCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    // BAKE (§4.4, §15.8): every pristine chunk written as modified (the golden worlds have none), and the baked
    // save carries a new lineage over its state (§4.8 item 4); the running world keeps its own r.
    const w = this.sim.w;
    const r = (v.flags & SaveFlags.bake) !== 0 ? lineageOf(w.stateHash().hash, w.tick) : this.sim.r;
    return ok(saveOutput(w.frames(), r));
  }

  sim_meta(): CallResult {
    if (!this.sim) return err(SimStatus.err_order);
    const w = this.sim.w;
    return ok(
      SimMetaCodec.encode({
        tick: w.tick,
        seed: w.globals.seed,
        last_system_seq: w.globals.last_system_seq,
        worldgen_version: w.globals.worldgen_version,
        r: this.sim.r,
        players: w.players.map((p) => ({
          index: p.index,
          online: p.online,
          last_seq: p.last_seq,
          input_gen: p.input_gen,
        })),
      }),
    );
  }

  sim_load_report(): CallResult {
    if (this.lastWorldCall !== 'load' || !this.report) return err(SimStatus.err_order);
    return ok(LoadReportCodec.encode(this.report));
  }

  // ----------------------------------------------------------------------------------------------- gen

  /** gen_init and gen_preview: the model checks their inputs; worldgen itself is not modelled (C2's crate). */
  gen_init(input: Uint8Array): CallResult {
    const v = decode(() => GenInitInputCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    throw new Error('gen_init: worldgen is not modelled; only malformed inputs are traced');
  }

  gen_preview(input: Uint8Array): CallResult {
    const v = decode(() => PreviewRequestCodec.decode(input));
    if (!v) return err(SimStatus.err_input);
    throw new Error('gen_preview: worldgen is not modelled; only malformed inputs are traced');
  }
}

/** abi.yaml `SaveOutput`: u32 count, the frames (container framing, codec raw), then the lineage r. */
export function saveOutput(
  frames: readonly { id: number; version: number; flags: number; data: Uint8Array }[],
  r: bigint,
): Uint8Array {
  return SaveOutputCodec.encode({
    sections: frames.map((f) => ({
      id: f.id,
      version: f.version,
      codec: 0,
      flags: f.flags,
      raw_length: f.data.length,
      data: f.data,
    })),
    r,
  });
}

/** The start of a load: a save container's sections and its lineage, as the shell passes them to sim_load. */
export function loadInputOf(container: Uint8Array): {
  sections: { id: number; version: number; data: Uint8Array }[];
  r: bigint;
} {
  const c = readSaveContainer(container);
  return { sections: c.frames, r: BigInt(`0x${c.header.lineage}`) };
}
