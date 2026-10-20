// The golden set's reference model (test/golden/model/module.ts) behind sim.wasm's exports (10 §15.8): a
// `SimExports` over a real WebAssembly.Memory, with §15.8's calling convention (an input buffer, 8-aligned
// envelopes in an output arena, the error envelope, the memory epoch). The shell runs on it exactly as on a
// module, so its replay, extraction and subscription logic is checked against the golden digests and packets
// before the real module exists (with the real module, the same tests run on it).
//
// Regions are bump-allocated and never freed: an input buffer or arena that must grow moves to the end of
// memory (raising the epoch), and memory grows by whole pages (replacing `memory.buffer`), so the shell's lease
// sees both kinds of move.
import { ABI_VERSION, type SimExports, SimStatus } from '../../src/shared/gen/abi.ts';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { Module } from '../golden/model/module.ts';

const PAGE = 65536;

export interface ModelExports extends SimExports {
  /** The model behind the exports. */
  readonly model: Module;
  /** Calls into the "module" so far, by export (the boundary audit, §3.6 rule 3). */
  readonly counts: Map<string, number>;
}

export function modelExports(): ModelExports {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const model = new Module();
  const counts = new Map<string, number>();
  let top = 64;
  let epoch = 1;
  const region = { input: 0, inputCap: 0, out: 0, outCap: 0, err: 0, errCap: 0 };

  const alloc = (n: number): number => {
    const at = (top + 7) & ~7;
    top = at + n;
    const need = top - memory.buffer.byteLength;
    if (need > 0) memory.grow(Math.ceil(need / PAGE));
    return at;
  };
  const bytes = () => new Uint8Array(memory.buffer);
  const view = () => new DataView(memory.buffer);
  const read = (len: number): Uint8Array => bytes().slice(region.input, region.input + len);
  const envelope = (b: Uint8Array): number => {
    if (region.outCap < b.length + 4) {
      region.outCap = Math.max(256, (b.length + 4) * 2);
      region.out = alloc(region.outCap);
      epoch += 1;
    }
    view().setUint32(region.out, b.length, true);
    bytes().set(b, region.out + 4);
    return region.out;
  };
  let lastError = 0;
  const fail = (code: number, what: string): void => {
    const msg = new TextEncoder().encode(`model: ${what} failed (${code})`);
    if (region.errCap < msg.length + 8) {
      region.errCap = msg.length + 64;
      region.err = alloc(region.errCap);
    }
    view().setUint32(region.err, msg.length + 4, true);
    view().setUint32(region.err + 4, code, true);
    bytes().set(msg, region.err + 8);
    lastError = region.err;
  };
  const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  const status = (name: string, r: { status: number }): number => {
    count(name);
    if (r.status !== SimStatus.ok) fail(r.status, name);
    return r.status;
  };
  const env = (name: string, r: { status: number; out?: Uint8Array }): number => {
    count(name);
    if (r.status !== SimStatus.ok || !r.out) {
      fail(r.status, name);
      return 0;
    }
    return envelope(r.out);
  };
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) hash[i] = Number.parseInt(SCHEMA_HASH.slice(2 * i, 2 * i + 2), 16);

  const exports: ModelExports = {
    model,
    counts,
    memory,
    sim_abi_version: () => ABI_VERSION,
    sim_schema_hash: () => envelope(hash),
    sim_input: (len: number) => {
      count('sim_input');
      if (region.inputCap < len || region.input === 0) {
        region.inputCap = Math.max(1024, len * 2);
        region.input = alloc(region.inputCap);
        epoch += 1;
      }
      return region.input;
    },
    sim_init: (len) => status('sim_init', model.sim_init(read(len))),
    sim_new_world: (len) => status('sim_new_world', model.sim_new_world(read(len))),
    sim_load: (len) => status('sim_load', model.sim_load(read(len))),
    sim_tick: (len) => status('sim_tick', model.sim_tick(read(len))),
    sim_set_flags: (flags) => status('sim_set_flags', model.sim_set_flags(flags >>> 0)),
    sim_blob_put: (len) => status('sim_blob_put', model.sim_blob_put(read(len))),
    sim_supply_chunk: (len) => status('sim_supply_chunk', model.sim_supply_chunk(read(len))),
    sim_pending_chunks: () => env('sim_pending_chunks', model.sim_pending_chunks()),
    sim_extract: (len) => env('sim_extract', model.sim_extract(read(len))),
    sim_subscribe: (len) => status('sim_subscribe', model.sim_subscribe(read(len))),
    sim_unsubscribe: (len) => status('sim_unsubscribe', model.sim_unsubscribe(read(len))),
    sim_query: (len) => status('sim_query', model.sim_query(read(len))),
    sim_query_step: (units) => env('sim_query_step', model.sim_query_step(units >>> 0)),
    sim_query_cancel: (id) => status('sim_query_cancel', model.sim_query_cancel(id >>> 0)),
    sim_digest: () => env('sim_digest', model.sim_digest()),
    sim_state_hash: () => env('sim_state_hash', model.sim_state_hash()),
    sim_save: (len) => env('sim_save', model.sim_save(read(len))),
    sim_meta: () => env('sim_meta', model.sim_meta()),
    sim_load_report: () => env('sim_load_report', model.sim_load_report()),
    sim_last_error: () => lastError,
    sim_memory_epoch: () => epoch,
    sim_pool_dir: () => envelope(new Uint8Array(0)),
    sim_allocs: () => {
      fail(SimStatus.err_order, 'sim_allocs (the model has no counting allocator)');
      return 0;
    },
  };
  return exports;
}

/**
 * A WebAssembly.Module-shaped stand-in is impossible (modules are engine objects), so the shell takes an
 * "instantiator" in tests: this one answers the model's exports in place of `WebAssembly.instantiate`.
 */
export function modelInstantiator(): {
  exports: ModelExports;
  instantiate: () => Promise<Record<string, unknown>>;
} {
  const exports = modelExports();
  return { exports, instantiate: async () => exports as unknown as Record<string, unknown> };
}
