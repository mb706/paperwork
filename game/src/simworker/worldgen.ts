// The sim worker's side of the worldgen pool (10 §3.1, §5.18, §15.9). The pool belongs to this sim worker: its
// ports come in `boot`. Once the world is bound the shell initialises every worker with prototypes.bin and the
// world's `new_world` record (`gen_init`), sends each request of `sim_pending_chunks` to a worker round-robin,
// passes each answer to `sim_supply_chunk` between ticks, and forgets requests whose commit tick has passed:
// the sim generated those inline (§5.18, D12). So the pool only saves time; with no pool, a late one, or one
// refused, the same chunks commit (D12: no pool, 1 and 4 workers give the same hashes). Chart images of pristine
// chunks (`gen_chart`, §5.19) come the same way and go to the main thread as `chart` messages.
import type { GenReply, GenRequest } from '../shared/gen-protocol.ts';
import type { StateGen } from '../shared/protocol.ts';

interface Pending {
  surface: number;
  cx: number;
  cy: number;
  commit: number;
}

export interface PoolHooks {
  /** A chunk answered in time: hand it to `sim_supply_chunk`. */
  supply(data: Uint8Array, commit: number): void;
  /** A chart image arrived (a ChartChunk record). */
  chart(data: ArrayBuffer): void;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
}

export class GenPool {
  private readonly ports: MessagePort[];
  private readonly hooks: PoolHooks;
  private gen: StateGen = 0;
  private next = 0;
  private nextId = 1;
  private readonly inflight = new Map<number, Pending>();
  private readonly charts = new Set<number>();
  /** `init` went out: later requests queue behind it on each port (a port delivers in order). */
  private initSent = false;
  /** Workers that answered `inited` with the world's hash (one hash for all). */
  ready = 0;
  worldHash: string | null = null;
  /** The world tick: answers whose commit tick is not after it are late. */
  tick = 0;
  /** Chunks supplied and answers that came too late, for tests and the debug overlay. */
  supplied = 0;
  late = 0;

  constructor(ports: readonly MessagePort[], hooks: PoolHooks) {
    this.ports = [...ports];
    this.hooks = hooks;
    for (const p of this.ports) p.onmessage = (e: MessageEvent<GenReply>) => this.answer(e.data);
  }

  get size(): number {
    return this.ports.length;
  }

  /** `gen_init` on every worker for the world of generation `gen`. */
  init(gen: StateGen, protos: Uint8Array, world: Uint8Array): void {
    this.gen = gen;
    this.ready = 0;
    this.worldHash = null;
    this.initSent = this.ports.length > 0;
    for (const p of this.ports) {
      const pb = protos.slice().buffer;
      const wb = world.slice().buffer;
      const m: GenRequest = { t: 'init', id: this.nextId++, gen, protos: pb, world: wb };
      p.postMessage(m, [pb, wb]);
    }
  }

  /** A `ChunkRequest` (§15.9): to the next worker, if the pool is ready; otherwise the sim generates it inline. */
  request(surface: number, cx: number, cy: number, commit: number): void {
    if (!this.initSent) return;
    const id = this.nextId++;
    this.inflight.set(id, { surface, cx, cy, commit });
    const port = this.ports[this.next % this.ports.length] as MessagePort;
    this.next += 1;
    const m: GenRequest = { t: 'chunk', id, gen: this.gen, surface, cx, cy };
    port.postMessage(m);
  }

  /** A pristine chunk's chart image (§5.19). */
  chart(surface: number, cx: number, cy: number): void {
    if (!this.initSent) return;
    const id = this.nextId++;
    this.charts.add(id);
    const port = this.ports[this.next % this.ports.length] as MessagePort;
    this.next += 1;
    const m: GenRequest = { t: 'chart', id, gen: this.gen, surface, cx, cy };
    port.postMessage(m);
  }

  /** Forgets requests whose commit tick has passed (the sim generated them inline). */
  forget(tick: number): void {
    this.tick = tick;
    // Every tick calls this: with nothing in flight it allocates nothing (no iterator).
    if (this.inflight.size === 0) return;
    for (const [id, q] of this.inflight) if (q.commit <= tick) this.inflight.delete(id);
  }

  private answer(m: GenReply): void {
    if (m.gen !== this.gen) return;
    switch (m.t) {
      case 'inited':
        if (this.worldHash !== null && this.worldHash !== m.worldHash) {
          this.hooks.log(
            'error',
            `worldgen workers disagree on the world hash (${this.worldHash}, ${m.worldHash})`,
          );
          return;
        }
        this.worldHash = m.worldHash;
        this.ready += 1;
        return;
      case 'chunk': {
        const q = this.inflight.get(m.id);
        this.inflight.delete(m.id);
        if (!q || q.commit <= this.tick) {
          this.late += 1;
          return;
        }
        this.supplied += 1;
        this.hooks.supply(new Uint8Array(m.data), q.commit);
        return;
      }
      case 'chart':
        if (this.charts.delete(m.id)) this.hooks.chart(m.data);
        return;
      case 'failed':
        this.inflight.delete(m.id);
        this.charts.delete(m.id);
        this.hooks.log('warn', `worldgen: ${m.message}`);
        return;
      case 'preview':
        return;
    }
  }

  close(): void {
    for (const p of this.ports) {
      p.onmessage = null;
      p.close();
    }
  }
}
