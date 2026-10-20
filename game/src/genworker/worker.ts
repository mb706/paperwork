// The worldgen worker (10 §3.1, §5.18, §15.9): one instance of gen.wasm, the `worldgen` crate's pure functions,
// serving one sim worker's pool. It never touches the World. The main thread sends `boot` with gen.wasm (compiled
// once per page, §9.7) and the pool port; the sim worker sends `init` (prototypes.bin and the world's `new_world`
// record), then chunk and chart requests, and every answer carries the world's hash. The main thread may ask for
// a map preview on the worker's own channel.
//
// The handshake is the sim's (§15.1): `gen_abi_version` must be GEN_ABI_VERSION and `gen_schema_hash` SCHEMA_HASH,
// with every export abi.yaml lists; ABI 0 is the M0 scaffold. A refused or trapped worker answers every request
// `failed`, and the sim generates those chunks inline (§5.18): the pool only saves time.
import {
  checkExports,
  GEN_ABI_VERSION,
  type GenExports,
  GenInitInputCodec,
  GenInitOutputCodec,
  GenModule,
  NewWorldCodec,
  SimError,
} from '../shared/gen/abi.ts';
import { SCHEMA_HASH } from '../shared/gen/schema.ts';
import type { GenReply, GenRequest, GenToMain, MainToGen } from '../shared/gen-protocol.ts';

export interface GenHost {
  /** The worker's own channel (the main thread). */
  post(msg: GenToMain, transfer?: Transferable[]): void;
}

const LEVELS = ['info', 'warn', 'error'] as const;
const hex = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
};

/** Thrown out of a call that trapped: the instance is unusable (§3.6). */
class GenTrap extends Error {}

export class GenWorker {
  private readonly host: GenHost;
  private module: GenModule | null = null;
  private memory: WebAssembly.Memory | null = null;
  private dead: string | null = null;
  private refused: string | null = null;
  /** Requests are handled in arrival order, after `boot` finishes. */
  private queue: Promise<void> = Promise.resolve();
  private gen = 0;
  /** Chunks generated, for tests. */
  chunks = 0;

  constructor(host: GenHost) {
    this.host = host;
  }

  /** A message on the worker's own channel. */
  handle(m: MainToGen): Promise<void> {
    if (m.t === 'port') {
      const port = m.port;
      port.onmessage = (e: MessageEvent<GenRequest>) => {
        void this.enqueue(() => this.request(e.data, (r, t) => port.postMessage(r, t ?? [])));
      };
      return Promise.resolve();
    }
    if (m.t === 'boot') return this.enqueue(() => this.boot(m.module));
    return this.enqueue(() => this.request(m, (r, t) => this.host.post(r, t)));
  }

  private enqueue(f: () => Promise<void> | void): Promise<void> {
    this.queue = this.queue.then(f).catch((e: unknown) => {
      this.host.post({ t: 'log', level: 'error', msg: `worldgen worker: ${String(e)}` });
    });
    return this.queue;
  }

  private async boot(module: WebAssembly.Module | null): Promise<void> {
    const refuse = (reason: string, abi: number, schemaHash: string, message: string) => {
      this.refused = message;
      this.host.post({ t: 'refused', reason, abi, schemaHash, message });
      this.host.post({
        t: 'log',
        level: reason === 'scaffold' ? 'info' : 'error',
        msg: `worldgen worker: ${message}`,
      });
    };
    if (!module) return refuse('instantiate', -1, '', 'no gen.wasm module in boot');
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = (ptr: number, len: number) =>
      this.memory ? decoder.decode(new Uint8Array(this.memory.buffer, ptr >>> 0, len >>> 0)) : '';
    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(module, {
        env: {
          host_log: (level: number, ptr: number, len: number) =>
            this.host.post({ t: 'log', level: LEVELS[level] ?? 'error', msg: text(ptr, len) }),
          host_panic: (ptr: number, len: number) => {
            this.dead = text(ptr, len);
            this.host.post({ t: 'log', level: 'error', msg: `gen.wasm panicked: ${this.dead}` });
          },
          host_now: () => 0,
        },
      });
    } catch (e) {
      return refuse('instantiate', -1, '', `gen.wasm does not instantiate: ${String(e)}`);
    }
    const ex = instance.exports as Record<string, unknown>;
    if (ex.memory instanceof WebAssembly.Memory) this.memory = ex.memory;
    const version = ex.gen_abi_version;
    if (typeof version !== 'function')
      return refuse('exports', -1, '', 'gen.wasm exports no gen_abi_version');
    const abi = (version as () => number)() >>> 0;
    if (abi !== GEN_ABI_VERSION)
      return refuse(
        abi === 0 ? 'scaffold' : 'abi',
        abi,
        '',
        abi === 0
          ? `gen.wasm is the M0 scaffold (ABI 0); this build needs ${GEN_ABI_VERSION}`
          : `gen.wasm has ABI ${abi}; this build needs ${GEN_ABI_VERSION}`,
      );
    if (!this.memory || typeof ex.gen_schema_hash !== 'function')
      return refuse('exports', abi, '', 'gen.wasm lacks memory or gen_schema_hash');
    const p = (ex.gen_schema_hash as () => number)() >>> 0;
    const hash = p === 0 ? '' : hex(new Uint8Array(this.memory.buffer, p + 4, 32));
    if (hash !== SCHEMA_HASH)
      return refuse(
        'schema',
        abi,
        hash,
        `gen.wasm was built for schema ${hash}; this build's is ${SCHEMA_HASH}`,
      );
    const { missing } = checkExports(ex, 'gen');
    if (missing.length > 0)
      return refuse('exports', abi, hash, `gen.wasm lacks the exports ${missing.join(', ')}`);
    this.module = new GenModule(ex as unknown as GenExports);
    this.host.post({ t: 'ready', abi, schemaHash: hash });
  }

  /** One call; a trap ends the instance. SimError (a status) passes through. */
  private call<T>(f: (m: GenModule) => T): T {
    if (this.dead !== null) throw new GenTrap(`gen.wasm trapped: ${this.dead}`);
    const m = this.module;
    if (!m) throw new GenTrap(this.refused ?? 'gen.wasm is not booted');
    try {
      return f(m);
    } catch (e) {
      if (e instanceof SimError) throw e;
      this.dead = e instanceof Error ? e.message : String(e);
      throw new GenTrap(`gen.wasm trapped: ${this.dead}`);
    }
  }

  private request(m: GenRequest, reply: (r: GenReply, transfer?: Transferable[]) => void): void {
    const fail = (e: unknown) =>
      reply({
        t: 'failed',
        id: m.id,
        gen: m.gen,
        status: e instanceof SimError ? e.status : -1,
        message: e instanceof Error ? e.message : String(e),
      });
    try {
      switch (m.t) {
        case 'init': {
          this.gen = m.gen;
          const input = GenInitInputCodec.encode({
            protos: new Uint8Array(m.protos),
            world: NewWorldCodec.decode(new Uint8Array(m.world), true),
          });
          const out = GenInitOutputCodec.decode(this.call((g) => g.init(input)));
          reply({
            t: 'inited',
            id: m.id,
            gen: m.gen,
            worldHash: out.world_hash.toString(16).padStart(16, '0'),
          });
          return;
        }
        case 'chunk': {
          const data = this.call((g) => g.chunk(m.surface, m.cx, m.cy));
          this.chunks += 1;
          const buf = data.buffer as ArrayBuffer;
          reply({ t: 'chunk', id: m.id, gen: m.gen, data: buf }, [buf]);
          return;
        }
        case 'chart': {
          const buf = this.call((g) => g.chart(m.surface, m.cx, m.cy)).buffer as ArrayBuffer;
          reply({ t: 'chart', id: m.id, gen: m.gen, data: buf }, [buf]);
          return;
        }
        case 'preview': {
          const buf = this.call((g) => g.preview(new Uint8Array(m.request))).buffer as ArrayBuffer;
          reply({ t: 'preview', id: m.id, gen: m.gen, data: buf }, [buf]);
          return;
        }
      }
    } catch (e) {
      fail(e);
    }
  }

  /** The generation of the world this worker serves (0 before an `init`). */
  get world(): number {
    return this.gen;
  }
}
