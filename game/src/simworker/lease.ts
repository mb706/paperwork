// The MemoryLease (10 §3.6, boundary rule 4: view lifetimes are explicit). WebAssembly memory growth detaches
// the old ArrayBuffer, and a pool that reallocates moves its columns, so every view the shell holds over linear
// memory comes from a lease that records `memory.buffer` and `sim_memory_epoch()`. After every call into the
// module the shell calls `check()`: two comparisons (and the epoch export), and the views are reacquired when
// either changed. Only the shell touches linear memory; packets and responses leave the worker as copies.
//
// The shell's own views (`u8`, `dv`) are read through the lease at each use, so they are never stale. Views
// handed out for longer (`views()`, the generated pool views of `sim_pool_dir`) are guarded in dev builds: a
// stale one throws on access (StaleViewError), where in a release build it would silently read old memory.
import { PoolDirCodec } from '../shared/gen/abi.ts';
import { poolViews } from '../shared/gen/pools.ts';

/** A view used after the lease moved on (dev builds). */
export class StaleViewError extends Error {
  constructor(what: string) {
    super(`stale view of linear memory: ${what} (reacquire views after every call into the module, 10 §3.6)`);
    this.name = 'StaleViewError';
  }
}

export interface LeaseSource {
  memory: WebAssembly.Memory;
  /** `sim_memory_epoch()` (never moves memory). */
  epoch(): number;
}

export class MemoryLease {
  private readonly src: LeaseSource;
  private readonly dev: boolean;
  private buffer: ArrayBuffer;
  private epochSeen: number;
  /** Bytes of linear memory: valid until the next call into the module, then reacquired by `check()`. */
  u8: Uint8Array;
  /** The same memory as 32-bit words (memory is always a whole number of 64-KiB pages). */
  u32: Uint32Array;
  dv: DataView;
  /** Raised every time the views are reacquired. */
  generation = 0;
  private pools: { generation: number; views: Record<string, Record<string, ArrayBufferView>> } | null = null;

  constructor(src: LeaseSource, dev: boolean) {
    this.src = src;
    this.dev = dev;
    this.buffer = src.memory.buffer;
    this.epochSeen = src.epoch();
    this.u8 = new Uint8Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
    this.dv = new DataView(this.buffer);
  }

  /**
   * After every call into the module: reacquires the views if the buffer was replaced (memory growth) or the
   * epoch moved (a column, the arena or the input buffer moved). Returns whether they were reacquired.
   */
  check(): boolean {
    const b = this.src.memory.buffer;
    const e = this.src.epoch();
    if (b === this.buffer && e === this.epochSeen) return false;
    this.buffer = b;
    this.epochSeen = e;
    this.u8 = new Uint8Array(b);
    this.u32 = new Uint32Array(b);
    this.dv = new DataView(b);
    this.generation += 1;
    return true;
  }

  /** The linear memory's size in bytes. */
  get bytes(): number {
    return this.buffer.byteLength;
  }

  /**
   * The generated pool read views (src/shared/gen/pools.ts) from `sim_pool_dir`'s directory bytes, valid until
   * the lease moves; dev builds guard them so that a stale one throws.
   */
  views(dir: () => Uint8Array): Record<string, Record<string, ArrayBufferView>> {
    if (this.pools && this.pools.generation === this.generation) return this.pools.views;
    const entries = PoolDirCodec.decode(dir()).columns;
    // Reading the directory is a call into the module: it may have moved memory itself.
    this.check();
    const raw = poolViews(this.buffer, entries);
    const views: Record<string, Record<string, ArrayBufferView>> = {};
    for (const [table, cols] of Object.entries(raw)) {
      const t: Record<string, ArrayBufferView> = {};
      for (const [col, v] of Object.entries(cols))
        t[col] = this.dev ? this.guard(v, `${table}.${col}`, this.generation) : v;
      views[table] = t;
    }
    this.pools = { generation: this.generation, views };
    return views;
  }

  /** A dev-build view that throws once the lease has moved past `generation`. */
  guard<T extends object>(view: T, what: string, generation: number): T {
    const lease = this;
    return new Proxy(view, {
      get(target, prop) {
        if (lease.generation !== generation) throw new StaleViewError(what);
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
      set(target, prop, value) {
        if (lease.generation !== generation) throw new StaleViewError(what);
        return Reflect.set(target, prop, value, target);
      },
    });
  }
}
