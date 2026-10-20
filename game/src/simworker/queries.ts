// Queries (10 §15.5 "Queries"): one-off, read-only, never logged, and they never delay a tick. The module runs
// them as continuations (`sim_query` starts one; `sim_query_step(units)` advances the running ones in arrival
// order and returns those that finished). The shell runs at most 4 at once and holds later ones in arrival
// order; it steps them only in the time a wake has left after its due ticks, at most 2 ms per wake, converting
// milliseconds to units from its own measurements, and on a timer while no tick runs. `cancel` drops a running
// or waiting query. Results go to the main thread as `res`.
import { QueryInputCodec, QueryStepOutputCodec, SimError, SimStatus } from '../shared/gen/abi.ts';
import { QueryHeaderCodec, UiInvalidReason } from '../shared/gen/projections.ts';
import type { SimInstance } from './module.ts';

/** At most this many queries run in the module (§15.5, `ERR_LIMIT` beyond). */
export const QUERIES_RUNNING = 4;
/** The most a wake spends stepping queries. */
export const QUERY_BUDGET_MS = 2;

export interface QueryResultOut {
  id: number;
  ok: boolean;
  /** The result record when ok, else a u16 UiInvalidReason. */
  value: ArrayBuffer;
}

const reason = (r: number): ArrayBuffer => {
  const b = new ArrayBuffer(2);
  new DataView(b).setUint16(0, r, true);
  return b;
};

export class QueryScheduler {
  private readonly waiting: { id: number; q: Uint8Array }[] = [];
  private readonly running = new Set<number>();
  /** Units of query work per millisecond, measured (§15.5: "from its own measurements"). */
  unitsPerMs = 256;

  /** Queries in the module or waiting. */
  get pending(): number {
    return this.running.size + this.waiting.length;
  }

  /** Work to do: queries running, or waiting for a slot (a wake fills the slots, C3-r1 11). */
  get busy(): boolean {
    return this.running.size > 0 || this.waiting.length > 0;
  }

  /** A `query` message: `q` is `u16 kind, u16 flags`, then the kind's parameters. */
  submit(sim: SimInstance, id: number, q: Uint8Array, done: (r: QueryResultOut) => void): void {
    this.waiting.push({ id, q });
    this.fill(sim, done);
  }

  /** A `cancel` message: an unknown id is ignored. A running query's slot goes to the next waiting one. */
  cancel(sim: SimInstance, id: number, done: (r: QueryResultOut) => void): void {
    if (this.running.delete(id)) {
      sim.cold((m) => m.queryCancel(id));
      this.fill(sim, done);
    } else {
      const i = this.waiting.findIndex((x) => x.id === id);
      if (i >= 0) this.waiting.splice(i, 1);
    }
  }

  private fill(sim: SimInstance, done: (r: QueryResultOut) => void): void {
    while (this.running.size < QUERIES_RUNNING && this.waiting.length > 0) {
      const next = this.waiting.shift() as { id: number; q: Uint8Array };
      let input: Uint8Array;
      try {
        if (next.q.length < QueryHeaderCodec.SIZE) throw new Error('a query shorter than its header');
        input = QueryInputCodec.encode({
          id: next.id,
          header: QueryHeaderCodec.decode(next.q.subarray(0, QueryHeaderCodec.SIZE)),
          params: next.q.subarray(QueryHeaderCodec.SIZE),
        });
      } catch {
        done({ id: next.id, ok: false, value: reason(UiInvalidReason.bad_parameters) });
        continue;
      }
      try {
        sim.cold((m) => m.query(input));
        this.running.add(next.id);
      } catch (e) {
        if (!(e instanceof SimError)) throw e;
        if (e.status === SimStatus.err_limit) {
          this.waiting.unshift(next);
          return;
        }
        done({ id: next.id, ok: false, value: reason(UiInvalidReason.bad_parameters) });
      }
    }
  }

  /** Advances the running queries by about `ms` of work and answers those that finished. */
  step(sim: SimInstance, ms: number, now: () => number, done: (r: QueryResultOut) => void): void {
    if (this.running.size === 0) this.fill(sim, done);
    if (this.running.size === 0) return;
    const units = Math.max(1, Math.floor(this.unitsPerMs * ms));
    const t0 = now();
    const out = QueryStepOutputCodec.decode(sim.cold((m) => m.queryStep(units)));
    const spent = now() - t0;
    // Units per millisecond, smoothed; a step that finished early says little, so only full steps teach.
    if (out.results.length < this.running.size && spent > 0.05)
      this.unitsPerMs = Math.max(1, Math.min(1e7, 0.7 * this.unitsPerMs + 0.3 * (units / spent)));
    for (const r of out.results) {
      if (!this.running.delete(r.id)) continue;
      const b = r.body;
      done({
        id: r.id,
        ok: r.ok,
        value: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
      });
    }
    this.fill(sim, done);
  }
}
