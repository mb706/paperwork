// The M0 benchmark scenarios through sim.wasm's ABI (10 §10.6; C2c-r1 finding 8, then C8): the one runner core of the
// Node runner (bench/node-runner.ts, a worker thread) and the browser runner (bench.html's module worker,
// src/dev/bench/worker.ts), timed as the game runs them: per tick `sim_tick`, `sim_digest` and `sim_pending_chunks`
// (the shell's calls), `sim_extract` per extraction. The scenarios are what `simtool bench --write-scenarios DIR`
// exports (states, logs, subscriptions, views, both gate sets in scenarios.json); `files(name)` gives a file's bytes.
// The plan is simtool's, whole (the M0 exit audit #8, C9): the warm-up, then per repetition the timed ticks and the
// profiled ones (run untimed here: per-phase times read the host clock only in simcheck builds, so they are native
// only), and the result says how many ticks it simulated, which the runners check against the plan's `ticks`.
// Metrics the ABI cannot show are native only (NATIVE_ONLY); any other missing metric fails a gate.
import { closureActions } from '../../shared/gen/actions.ts';
import { parseClosureLog } from '../../shared/gen/container.ts';

export interface Gate {
  metric: string;
  limit: number;
  unit: string;
  floor: boolean;
  scales: boolean;
}
export interface Plan {
  warmup: number;
  timed: number;
  /** Per repetition, after the timed ticks: native per-phase timing, untimed ticks here. */
  profiled: number;
  reps: number;
  /** The ticks the plan simulates (m0-walk's full plan: 36,000, its 10 minutes). */
  ticks: number;
}

/**
 * The gate metrics only the native runner measures: the codec's throughput with encoding (the sequencer's writing is
 * Rust code the ABI does not expose) and the regenerations per tick (the World's counter). Any other gate metric a
 * WebAssembly runner lacks fails its gate.
 */
export const NATIVE_ONLY: ReadonlySet<string> = new Set(['actions_per_s', 'max_regenerations_per_tick']);
export interface BenchScenario {
  name: string;
  state: string | null;
  log: string | null;
  subs: string | null;
  view: string | null;
  full: Plan;
  quick: Plan;
  thresholds: Gate[];
  budgets: Gate[];
}
export interface BenchManifest {
  host_factor: number;
  protos: string;
  scenarios: BenchScenario[];
}
export interface ScenarioResult {
  metrics: Record<string, number>;
  allocs: number | null;
  memory_bytes: number;
  /** The ticks simulated (the plan's `ticks` when it ran whole). */
  ticks: number;
}

const STATUS_OK = 0;

/** One instance of sim.wasm over §15.8's calling convention. */
class Sim {
  readonly e: Record<string, (...a: number[]) => number>;
  readonly memory: WebAssembly.Memory;

  constructor(module: WebAssembly.Module, now: () => number) {
    // check-arch-ignore linear-memory: runs in bench.html's module worker or a Node worker thread, never on a page
    const instance = new WebAssembly.Instance(module, {
      env: { host_log: () => {}, host_panic: () => {}, host_now: now },
    });
    this.e = instance.exports as unknown as Record<string, (...a: number[]) => number>;
    this.memory = instance.exports.memory as WebAssembly.Memory;
  }

  private put(bytes: Uint8Array): number {
    const at = (this.e.sim_input?.(bytes.length) ?? 0) >>> 0;
    new Uint8Array(this.memory.buffer, at, bytes.length).set(bytes);
    return bytes.length;
  }

  status(name: string, bytes: Uint8Array): number {
    const f = this.e[name];
    if (!f) throw new Error(`no export ${name}`);
    return f(this.put(bytes)) >>> 0;
  }

  must(name: string, bytes: Uint8Array): void {
    const s = this.status(name, bytes);
    if (s !== STATUS_OK) throw new Error(`${name}: status ${s}`);
  }

  /** An envelope export's payload (copied), or null when it failed. */
  envelope(name: string, bytes?: Uint8Array, ...args: number[]): Uint8Array | null {
    const f = this.e[name];
    if (!f) throw new Error(`no export ${name}`);
    const ptr = (bytes === undefined ? f(...args) : f(this.put(bytes))) >>> 0;
    if (ptr === 0) return null;
    const len = new DataView(this.memory.buffer).getUint32(ptr, true);
    return new Uint8Array(this.memory.buffer.slice(ptr + 4, ptr + 4 + len));
  }

  allocations(): number | null {
    const out = this.envelope('sim_allocs');
    return out ? Number(new DataView(out.buffer).getBigUint64(0, true)) : null;
  }
}

/** `InitInput` around prototypes.bin. */
function initInput(protos: Uint8Array): Uint8Array {
  const out = new Uint8Array(protos.length + 12);
  new DataView(out.buffer).setUint32(0, protos.length, true);
  out.set(protos, 4);
  return out;
}

/** `LoadInput` from `sim_save`'s output: the frames as they are, no remap tables, the lineage. */
function stateInput(state: Uint8Array): Uint8Array {
  const out = new Uint8Array(state.length + 2);
  out.set(state.subarray(0, state.length - 8), 0);
  out.set(state.subarray(state.length - 8), state.length - 6);
  return out;
}

export function stats(xs: number[]): [number, number, number, number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const n = Math.max(1, s.length);
  const at = (q: number) => s[Math.min(n - 1, Math.floor(n * q))] ?? 0;
  return [s.reduce((a, b) => a + b, 0) / n, at(0.5), at(0.9), at(0.99), s[s.length - 1] ?? 0];
}

/**
 * Per-tick statistics. Where a browser coarsens `performance.now()` (100 µs in Chrome, 1 ms in Firefox, unless the
 * page is cross-origin isolated), each interval reads as a whole number of steps, but with the clock's phase random
 * the mean of the readings is still the true mean; the percentiles are then upper bounds in steps.
 */
function putTicks(m: Record<string, number>, prefix: string, xs: number[]): void {
  const [mean, p50, p90, p99, max] = stats(xs);
  Object.assign(m, {
    [`${prefix}_mean_ms`]: mean,
    [`${prefix}_p50_ms`]: p50,
    [`${prefix}_p90_ms`]: p90,
    [`${prefix}_p99_ms`]: p99,
    [`${prefix}_max_ms`]: max,
  });
}

/** The smallest step `now()` makes here (browsers coarsen it unless the page is cross-origin isolated). */
export function timerResolutionMs(now: () => number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 20; k++) {
    const a = now();
    let b = now();
    while (b === a) b = now();
    best = Math.min(best, b - a);
  }
  return best;
}

/** Runs one scenario (`quick`: ci's budget gate, one short repetition). */
export function runScenario(
  module: WebAssembly.Module,
  files: (name: string) => Uint8Array,
  sc: BenchScenario,
  quick: boolean,
  now: () => number = () => performance.now(),
): ScenarioResult {
  const plan = quick ? sc.quick : sc.full;
  const protos = files('prototypes.bin');
  const fresh = (): Sim => {
    const s = new Sim(module, now);
    s.must('sim_init', initInput(protos));
    return s;
  };
  const state = files(sc.state as string);
  const sim = fresh();
  sim.must('sim_load', stateInput(state));
  const m: Record<string, number> = {};
  const empty = new Uint8Array(0);
  let ticks = 0;
  /** One tick with the shell's calls; returns its milliseconds. */
  const tick = (closure: Uint8Array): number => {
    const t = now();
    sim.must('sim_tick', closure);
    const ms = now() - t;
    sim.envelope('sim_digest');
    sim.envelope('sim_pending_chunks');
    ticks++;
    return ms;
  };
  /** The plan's profiled ticks of a repetition: run as the native runner runs them (no extraction), untimed. */
  const profiled = (): void => {
    for (let i = 0; i < plan.profiled; i++) tick(empty);
  };
  let allocs: number | null = null;
  const counted = (f: () => void): void => {
    const a = sim.allocations();
    f();
    const b = sim.allocations();
    if (a !== null && b !== null) allocs = (allocs ?? 0) + (b - a);
  };
  if (sc.name === 'm0-walk') {
    for (let i = 0; i < plan.warmup; i++) tick(empty);
    const times: number[] = [];
    counted(() => {
      for (let r = 0; r < plan.reps; r++) {
        for (let i = 0; i < plan.timed; i++) times.push(tick(empty));
        profiled();
      }
    });
    putTicks(m, 'tick', times);
  } else if (sc.name === 'm0-chests-10k') {
    const view = files(sc.view as string);
    sim.must('sim_subscribe', files(sc.subs as string));
    sim.envelope('sim_extract', view);
    sim.envelope('sim_extract', view);
    const extract = (): number => {
      const t = now();
      if (!sim.envelope('sim_extract', view)) throw new Error('sim_extract failed');
      return now() - t;
    };
    for (let i = 0; i < plan.warmup; i++) {
      tick(empty);
      extract();
    }
    const times: number[] = [];
    const extracts: number[] = [];
    counted(() => {
      for (let r = 0; r < plan.reps; r++) {
        for (let i = 0; i < plan.timed; i++) {
          times.push(tick(empty));
          extracts.push(extract());
        }
        profiled();
      }
    });
    putTicks(m, 'tick', times);
    putTicks(m, 'extract', extracts);
    const save: number[] = [];
    const hash: number[] = [];
    const load: number[] = [];
    let saved: Uint8Array | null = null;
    for (let i = 0; i < plan.reps * 5; i++) {
      let t = now();
      saved = sim.envelope('sim_save', new Uint8Array(4));
      save.push(now() - t);
      t = now();
      sim.envelope('sim_state_hash');
      hash.push(now() - t);
      const other = fresh();
      const input = stateInput(saved as Uint8Array);
      t = now();
      other.must('sim_load', input);
      load.push(now() - t);
    }
    for (const [k, xs] of [
      ['save', save],
      ['hash', hash],
      ['load', load],
    ] as const) {
      const [mean, , , , max] = stats(xs);
      m[`${k}_ms`] = mean;
      m[`${k}_max_ms`] = max;
    }
  } else if (sc.name === 'm0-codec') {
    const log = parseClosureLog(files(sc.log as string));
    const records = log.records.map((r) => ({
      closure: r.closure,
      actions: closureActions(r.closure).length,
    }));
    if (records.length < plan.warmup + plan.reps * plan.timed)
      throw new Error(
        `m0-codec: the log has ${records.length} ticks, the plan needs ${plan.warmup + plan.reps * plan.timed}`,
      );
    for (const r of records.slice(0, plan.warmup)) tick(r.closure);
    const timed = records.slice(plan.warmup, plan.warmup + plan.reps * plan.timed);
    let ms = 0;
    let actions = 0;
    counted(() => {
      for (const r of timed) {
        ms += tick(r.closure);
        actions += r.actions;
      }
    });
    m.actions = actions;
    m.apply_ms = ms;
    m.apply_actions_per_s = actions / (ms / 1000);
  } else if (sc.name === 'm0-load-30k') {
    const loads: number[] = [];
    const input = stateInput(state);
    for (let i = 0; i < Math.max(1, plan.reps) * 2; i++) {
      const other = fresh();
      const t = now();
      other.must('sim_load', input);
      loads.push(now() - t);
    }
    const [mean, , , , max] = stats(loads);
    m.load_ms = mean;
    m.load_max_ms = max;
    const log = parseClosureLog(files(sc.log as string));
    const first = log.records[0];
    const times: number[] = [];
    counted(() => {
      times.push(tick(first ? first.closure : empty));
      for (let i = 1; i < 600; i++) times.push(tick(empty));
    });
    putTicks(m, 'tick', times);
  } else {
    throw new Error(`unknown scenario ${sc.name}`);
  }
  return { metrics: m, allocs, memory_bytes: sim.memory.buffer.byteLength, ticks };
}

/** One gate's verdict: the value, the limit on this machine (× the factor where it scales), met or not. */
export interface Verdict {
  metric: string;
  value: number | null;
  unit: string;
  floor: boolean;
  /** A time or a rate (the factor applies), or a count (it does not). */
  scales: boolean;
  /** The reference machine's limit, and the limit on this machine (reference × factor where it scales). */
  limit: number;
  here: number;
  met: boolean | null;
}

/** The gates of a scenario against a result, with `factor` = this machine ÷ the reference (2.4 on this host). */
export function verdicts(gates: readonly Gate[], r: ScenarioResult, factor: number): Verdict[] {
  return gates.map((g) => {
    const v = r.metrics[g.metric];
    const here = g.scales ? (g.floor ? g.limit / factor : g.limit * factor) : g.limit;
    return {
      metric: g.metric,
      value: v ?? null,
      unit: g.unit,
      floor: g.floor,
      scales: g.scales,
      limit: g.limit,
      here,
      // a native-only metric is not judged here; any other missing metric misses its gate
      met: v === undefined ? (NATIVE_ONLY.has(g.metric) ? null : false) : g.floor ? v >= here : v <= here,
    };
  });
}

/** Why a result is not the plan's whole run, or null (the M0 exit audit #8: the simulated duration is enforced). */
export function planProblem(sc: BenchScenario, r: ScenarioResult, quick: boolean): string | null {
  const want = (quick ? sc.quick : sc.full).ticks;
  if (typeof want !== 'number')
    return `${sc.name}: scenarios.json has no ticks for its plan (rewrite the scenarios)`;
  return r.ticks === want ? null : `${sc.name}: simulated ${r.ticks} ticks, the plan ${want}`;
}
