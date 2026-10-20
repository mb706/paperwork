// sim.wasm inside the sim worker (10 §3.1, §3.6, §15.8): instantiation from the WebAssembly.Module the main
// thread compiled once per page (§9.7), the handshake that refuses a stale module, the host imports, the
// MemoryLease, and the calls.
//
// The handshake (§15.1 "the schema handshake"; §12 M0 exit "the schema handshake refuses a stale module"): the
// module's `sim_abi_version` must be this build's ABI_VERSION, its `sim_schema_hash` this build's SCHEMA_HASH
// (which covers every layout and version, PROTOCOL_VERSION included), and it must export everything abi.yaml
// lists; anything else is refused with both values named. ABI 0 is the M0 scaffold module (crates/simabi before
// the sim package's module lands), refused like any other mismatch but marked as such.
//
// Traps (§3.6): any exception out of a call into the module ends the instance. The shell never calls it again:
// every method then throws the same TrapError, carrying the panic hook's message (`host_panic`) when there was
// one. A failed status is not a trap: it throws SimError with `sim_last_error`'s code and message.
//
// Two kinds of call. Cold calls (init, load, save, meta, queries …) go through the generated typed wrapper
// (SimModule), which copies envelopes out. Hot calls (the tick path: `sim_input`, `sim_tick`, `sim_extract`,
// `sim_digest`, `sim_pending_chunks`) are direct and allocate nothing: their results are read through the lease.
import {
  ABI_VERSION,
  checkExports,
  SimError,
  type SimExports,
  SimModule,
  SimStatus,
} from '../shared/gen/abi.ts';
import { SCHEMA_HASH } from '../shared/gen/schema.ts';
import { MemoryLease } from './lease.ts';

export type LogLevel = 'info' | 'warn' | 'error';
const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

export type RefusalReason = 'instantiate' | 'scaffold' | 'abi' | 'schema' | 'exports' | 'memory';

/** The handshake refused the module (§15.1): it must not run. */
export class HandshakeError extends Error {
  readonly reason: RefusalReason;
  /** The module's ABI version (-1 unknown) and schema hash ('' unknown). */
  readonly abi: number;
  readonly schemaHash: string;
  constructor(reason: RefusalReason, abi: number, schemaHash: string, message: string) {
    super(message);
    this.name = 'HandshakeError';
    this.reason = reason;
    this.abi = abi;
    this.schemaHash = schemaHash;
  }
}

/** The instance trapped (§3.6): it is unusable. */
export class TrapError extends Error {
  /** The panic hook's message ("index out of bounds …", file and line), if the module panicked. */
  readonly panic: string | null;
  constructor(panic: string | null, cause: unknown) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    super(panic ? `panic: ${panic}` : `trap: ${detail}`);
    this.name = 'TrapError';
    this.panic = panic;
  }
}

export interface SimHooks {
  /** `host_log` lines and the panic hook's message. */
  log(level: LogLevel, msg: string): void;
  /** `host_now`: milliseconds, for the profiling scopes only (D13). */
  now(): number;
}

const hex = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
};

/** The host imports (module `env`, §15.8) and the cell through which they reach the instance. */
export interface ImportCell {
  imports: WebAssembly.Imports;
  memory: WebAssembly.Memory | null;
  self: SimInstance | null;
}

/** The imports of sim.wasm: `host_log`, `host_panic` (before the abort, §3.6) and `host_now`. */
export function importCell(hooks: SimHooks): ImportCell {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const cell: ImportCell = { imports: {}, memory: null, self: null };
  const text = (ptr: number, len: number): string =>
    cell.memory ? decoder.decode(new Uint8Array(cell.memory.buffer, ptr >>> 0, len >>> 0)) : '';
  cell.imports = {
    env: {
      host_log: (level: number, ptr: number, len: number): void =>
        hooks.log(LOG_LEVELS[level] ?? 'error', text(ptr, len)),
      host_panic: (ptr: number, len: number): void => {
        const msg = text(ptr, len);
        if (cell.self) cell.self.panicMessage = msg;
        hooks.log('error', `sim.wasm panicked: ${msg}`);
      },
      host_now: (): number => hooks.now(),
    },
  };
  return cell;
}

/**
 * Instantiates sim.wasm and runs the handshake. Throws HandshakeError when the module must not run.
 * `dev` guards long-lived views (dev builds, §3.6).
 */
export async function instantiateSim(
  module: WebAssembly.Module,
  hooks: SimHooks,
  dev: boolean,
): Promise<SimInstance> {
  const cell = importCell(hooks);
  let instance: WebAssembly.Instance;
  try {
    instance = await WebAssembly.instantiate(module, cell.imports);
  } catch (e) {
    throw new HandshakeError('instantiate', -1, '', `sim.wasm does not instantiate: ${String(e)}`);
  }
  return handshake(instance.exports as Record<string, unknown>, cell, dev);
}

/**
 * The handshake over an instance's exports (§15.1): the ABI version, the memory, the schema hash, then every
 * export abi.yaml lists, in that order, so a stale module is refused by its hash with both hashes named.
 */
export function handshake(ex: Record<string, unknown>, cell: ImportCell | null, dev: boolean): SimInstance {
  if (cell && ex.memory instanceof WebAssembly.Memory) cell.memory = ex.memory;
  const version = ex.sim_abi_version;
  if (typeof version !== 'function')
    throw new HandshakeError('exports', -1, '', 'sim.wasm exports no sim_abi_version');
  let abi: number;
  let hash = '';
  try {
    abi = ((version as () => number)() >>> 0) as number;
    if (abi !== ABI_VERSION)
      throw new HandshakeError(
        abi === 0 ? 'scaffold' : 'abi',
        abi,
        '',
        abi === 0
          ? `sim.wasm is the M0 scaffold (ABI 0); this build's shell needs ABI ${ABI_VERSION}`
          : `sim.wasm has ABI ${abi}; this build's shell needs ABI ${ABI_VERSION}`,
      );
    const memory = ex.memory;
    if (!(memory instanceof WebAssembly.Memory))
      throw new HandshakeError('memory', abi, '', 'sim.wasm exports no memory named `memory`');
    const schemaHash = ex.sim_schema_hash;
    if (typeof schemaHash !== 'function')
      throw new HandshakeError('exports', abi, '', 'sim.wasm exports no sim_schema_hash');
    const p = ((schemaHash as () => number)() >>> 0) as number;
    if (p === 0) throw new HandshakeError('schema', abi, '', 'sim_schema_hash failed');
    const view = new DataView(memory.buffer);
    const len = view.getUint32(p, true);
    if (len !== 32) throw new HandshakeError('schema', abi, '', `sim_schema_hash is ${len} bytes, not 32`);
    hash = hex(new Uint8Array(memory.buffer, p + 4, 32));
    if (hash !== SCHEMA_HASH)
      throw new HandshakeError(
        'schema',
        abi,
        hash,
        `sim.wasm was built for schema ${hash}; this build's is ${SCHEMA_HASH} (a stale module)`,
      );
    const { missing } = checkExports(ex, 'sim');
    if (missing.length > 0)
      throw new HandshakeError('exports', abi, hash, `sim.wasm lacks the exports ${missing.join(', ')}`);
    const inst = new SimInstance(ex as unknown as SimExports, memory, dev);
    if (cell) cell.self = inst;
    return inst;
  } catch (e) {
    if (e instanceof HandshakeError) throw e;
    throw new HandshakeError('instantiate', -1, hash, `sim.wasm trapped during the handshake: ${String(e)}`);
  }
}

/** A live sim.wasm instance. */
export class SimInstance {
  readonly e: SimExports;
  readonly memory: WebAssembly.Memory;
  readonly lease: MemoryLease;
  readonly calls: SimModule;
  /** The trap that ended the instance, or null while it lives. */
  dead: TrapError | null = null;
  /** The panic hook's last message (`host_panic`, set by the imports before the abort). */
  panicMessage: string | null = null;
  /** sim_digest's result after `digest()`: tick, d (low, high), r (low, high). */
  readonly digestOut = new Uint32Array(5);

  constructor(e: SimExports, memory: WebAssembly.Memory, dev: boolean) {
    this.e = e;
    this.memory = memory;
    this.calls = new SimModule(e);
    this.lease = new MemoryLease({ memory, epoch: () => this.e.sim_memory_epoch() >>> 0 }, dev);
  }

  /** Marks the instance dead (§3.6 step 2: it is never called again) and returns its trap. */
  private trapped(err: unknown): TrapError {
    if (!this.dead) this.dead = new TrapError(this.panicMessage, err);
    return this.dead;
  }

  /**
   * A cold call through the generated wrapper. A failed status throws SimError (the instance lives on); any
   * other exception out of the module is a trap.
   */
  cold<T>(f: (m: SimModule) => T): T {
    if (this.dead) throw this.dead;
    let out: T;
    try {
      out = f(this.calls);
    } catch (err) {
      if (err instanceof SimError) {
        this.lease.check();
        throw err;
      }
      throw this.trapped(err);
    }
    this.lease.check();
    return out;
  }

  /** The error of the last failing call (`sim_last_error`). */
  lastError(): SimError {
    if (this.dead) throw this.dead;
    try {
      return this.calls.lastError();
    } catch (err) {
      throw this.trapped(err);
    }
  }

  /** Throws SimError for a failed status. */
  check(status: number): void {
    if (status !== SimStatus.ok) throw this.lastError();
  }

  // ---------------------------------------------------------------------------------------------- hot path

  /** `sim_input(len)`: the input buffer's address; the views are reacquired if it moved. */
  input(len: number): number {
    if (this.dead) throw this.dead;
    let p: number;
    try {
      p = this.e.sim_input(len) >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    if (p === 0 && len > 0) throw new SimError(SimStatus.err_input, 'the input buffer cannot grow');
    return p;
  }

  /** `sim_tick(len)`: runs the tick whose closure the input buffer holds; returns the status. */
  tick(len: number): number {
    if (this.dead) throw this.dead;
    let s: number;
    try {
      s = this.e.sim_tick(len) >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    return s;
  }

  /** `sim_extract(len)` with the view request in the input buffer: the packet's envelope address, or 0. */
  extract(len: number): number {
    if (this.dead) throw this.dead;
    let p: number;
    try {
      p = this.e.sim_extract(len) >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    return p;
  }

  /** `sim_digest()` into `digestOut` (tick, d low, d high, r low, r high). */
  digest(): void {
    if (this.dead) throw this.dead;
    let p: number;
    try {
      p = this.e.sim_digest() >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    if (p === 0) throw this.lastError();
    const dv = this.lease.dv;
    const o = this.digestOut;
    o[0] = dv.getUint32(p + 4, true);
    o[1] = dv.getUint32(p + 8, true);
    o[2] = dv.getUint32(p + 12, true);
    o[3] = dv.getUint32(p + 16, true);
    o[4] = dv.getUint32(p + 20, true);
  }

  /** `sim_pending_chunks()`: the envelope's address (`u32 count`, then ChunkRequest records). */
  pendingChunks(): number {
    if (this.dead) throw this.dead;
    let p: number;
    try {
      p = this.e.sim_pending_chunks() >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    if (p === 0) throw this.lastError();
    return p;
  }

  /**
   * `sim_load(len)` with its input already written into the input buffer (a late game's sections are written
   * once, straight into linear memory, not staged in a JavaScript copy). Throws SimError for a refusal.
   */
  load(len: number): void {
    if (this.dead) throw this.dead;
    let s: number;
    try {
      s = this.e.sim_load(len) >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    this.check(s);
  }

  /** `sim_set_flags(flags)`. */
  setFlags(flags: number): void {
    if (this.dead) throw this.dead;
    let s: number;
    try {
      s = this.e.sim_set_flags(flags) >>> 0;
    } catch (err) {
      throw this.trapped(err);
    }
    this.lease.check();
    this.check(s);
  }
}
