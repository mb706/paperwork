// The Node runner of 10 §10.6 (C2c-r1 finding 8): the M0 scenarios that `simtool bench --write-scenarios DIR`
// exports, timed through sim.wasm's ABI in a worker thread, as the game runs them: per tick `sim_tick`,
// `sim_digest` and `sim_pending_chunks` (the shell's calls), `sim_extract` per extraction. The same method and
// gates as `simtool bench` (scenarios.json carries both): a full run checks §10.6's thresholds, `--quick` (`ci`'s
// budget gate) the tails, on the reference machine × the host factor. The main thread samples the pinned cores'
// clocks while a scenario runs and flags turbo. Results go to bench/history.jsonl ("runner": "node wasm").
//
//   node bench/node-runner.ts [--scenarios DIR] [--module sim.wasm] [--quick] [--json] [--no-history]
//
// Defaults: target/bench/scenarios and target/bench/wasm32-unknown-unknown/wasmdev/simabi.wasm (the module
// without simcheck, built into its own target directory so the dev module stays as the dev server built it).
// Metrics the ABI cannot show (`max_regenerations_per_tick`, the codec's encoding) are native only.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { closureActions } from '../src/shared/gen/actions.ts';
import { parseClosureLog } from '../src/shared/gen/container.ts';

interface Gate {
  metric: string;
  limit: number;
  unit: string;
  floor: boolean;
  scales: boolean;
}
interface Plan {
  warmup: number;
  timed: number;
  reps: number;
}
interface Scenario {
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
interface Manifest {
  host_factor: number;
  protos: string;
  scenarios: Scenario[];
}
interface Job {
  dir: string;
  module: string;
  scenario: Scenario;
  quick: boolean;
}
interface Result {
  metrics: Record<string, number>;
  allocs: number | null;
  memory_bytes: number;
}

const STATUS_OK = 0;

/** One instance of sim.wasm over §15.8's calling convention. */
class Sim {
  readonly e: Record<string, (...a: number[]) => number>;
  readonly memory: WebAssembly.Memory;

  constructor(module: WebAssembly.Module) {
    const instance = new WebAssembly.Instance(module, {
      env: { host_log: () => {}, host_panic: () => {}, host_now: () => performance.now() },
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

function stats(xs: number[]): [number, number, number, number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const n = Math.max(1, s.length);
  const at = (q: number) => s[Math.min(n - 1, Math.floor(n * q))] ?? 0;
  return [s.reduce((a, b) => a + b, 0) / n, at(0.5), at(0.9), at(0.99), s[s.length - 1] ?? 0];
}

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

/** Runs one scenario in this worker thread. */
function run(job: Job): Result {
  const file = (f: string) => new Uint8Array(readFileSync(join(job.dir, f)));
  const sc = job.scenario;
  const plan = job.quick ? sc.quick : sc.full;
  const module = new WebAssembly.Module(readFileSync(job.module));
  const protos = file('prototypes.bin');
  const fresh = (): Sim => {
    const s = new Sim(module);
    s.must('sim_init', initInput(protos));
    return s;
  };
  const state = file(sc.state as string);
  const sim = fresh();
  sim.must('sim_load', stateInput(state));
  const m: Record<string, number> = {};
  const empty = new Uint8Array(0);
  /** One tick with the shell's calls; returns its milliseconds. */
  const tick = (closure: Uint8Array): number => {
    const t = performance.now();
    sim.must('sim_tick', closure);
    const ms = performance.now() - t;
    sim.envelope('sim_digest');
    sim.envelope('sim_pending_chunks');
    return ms;
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
      for (let r = 0; r < plan.reps; r++) for (let i = 0; i < plan.timed; i++) times.push(tick(empty));
    });
    putTicks(m, 'tick', times);
  } else if (sc.name === 'm0-chests-10k') {
    const view = file(sc.view as string);
    sim.must('sim_subscribe', file(sc.subs as string));
    sim.envelope('sim_extract', view);
    sim.envelope('sim_extract', view);
    const extract = (): number => {
      const t = performance.now();
      if (!sim.envelope('sim_extract', view)) throw new Error('sim_extract failed');
      return performance.now() - t;
    };
    for (let i = 0; i < plan.warmup; i++) {
      tick(empty);
      extract();
    }
    const times: number[] = [];
    const extracts: number[] = [];
    counted(() => {
      for (let r = 0; r < plan.reps; r++)
        for (let i = 0; i < plan.timed; i++) {
          times.push(tick(empty));
          extracts.push(extract());
        }
    });
    putTicks(m, 'tick', times);
    putTicks(m, 'extract', extracts);
    const save: number[] = [];
    const hash: number[] = [];
    const load: number[] = [];
    let saved: Uint8Array | null = null;
    for (let i = 0; i < plan.reps * 5; i++) {
      let t = performance.now();
      saved = sim.envelope('sim_save', new Uint8Array(4));
      save.push(performance.now() - t);
      t = performance.now();
      sim.envelope('sim_state_hash');
      hash.push(performance.now() - t);
      const other = fresh();
      const input = stateInput(saved as Uint8Array);
      t = performance.now();
      other.must('sim_load', input);
      load.push(performance.now() - t);
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
    const log = parseClosureLog(file(sc.log as string));
    const records = log.records.map((r) => ({
      closure: r.closure,
      actions: closureActions(r.closure).length,
    }));
    const warm = Math.min(job.quick ? 100 : 100, records.length);
    for (const r of records.slice(0, warm)) tick(r.closure);
    const timed = records.slice(warm, warm + plan.reps * 1000);
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
      const t = performance.now();
      other.must('sim_load', input);
      loads.push(performance.now() - t);
    }
    const [mean, , , , max] = stats(loads);
    m.load_ms = mean;
    m.load_max_ms = max;
    const log = parseClosureLog(file(sc.log as string));
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
  return { metrics: m, allocs, memory_bytes: sim.memory.buffer.byteLength };
}

if (!isMainThread) {
  parentPort?.postMessage(run(workerData as Job));
} else {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string): string => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? (args[i + 1] as string) : d;
  };
  const dir = opt('--scenarios', 'target/bench/scenarios');
  const module = opt('--module', 'target/bench/wasm32-unknown-unknown/wasmdev/simabi.wasm');
  const quick = args.includes('--quick');
  const json = args.includes('--json');
  const history = args.includes('--no-history') ? null : opt('--history', 'bench/history.jsonl');
  const manifest = JSON.parse(readFileSync(join(dir, 'scenarios.json'), 'utf8')) as Manifest;
  const hf = manifest.host_factor;
  const cpus = (
    readFileSync('/proc/self/status', 'utf8').match(/Cpus_allowed_list:\s*(\S+)/)?.[1] ?? ''
  ).trim();
  const cpuList = cpus.split(',').flatMap((p) => {
    const [a, b] = p.split('-').map(Number) as [number, number | undefined];
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
  const base = Number(/@\s*([\d.]+)GHz/.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1] ?? 0) * 1000;
  const git = (a: string[]): string => {
    try {
      return execFileSync('git', a, { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  let ok = true;
  for (const sc of manifest.scenarios) {
    // The clocks of the pinned cores while the scenario runs (§10.6's clock log), every 20 ms.
    const samples: number[] = [];
    const sample = () => {
      let max = 0;
      for (const c of cpuList) {
        try {
          const khz = Number(
            readFileSync(`/sys/devices/system/cpu/cpu${c}/cpufreq/scaling_cur_freq`, 'utf8'),
          );
          if (khz / 1000 > max) max = khz / 1000;
        } catch {}
      }
      if (max > 0) samples.push(max);
    };
    const timer = setInterval(sample, 20);
    const t0 = performance.now();
    const result = await new Promise<Result>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), {
        workerData: { dir, module, scenario: sc, quick } satisfies Job,
      });
      w.once('message', resolve);
      w.once('error', reject);
    });
    clearInterval(timer);
    sample();
    const gates = quick ? sc.budgets : sc.thresholds;
    const lines: string[] = [`${sc.name} (node wasm${quick ? ', budget gate: tails' : ''})`];
    let pass = true;
    for (const g of gates) {
      const v = result.metrics[g.metric];
      if (v === undefined) {
        lines.push(`  ${g.metric.padEnd(28)} ${'n/a'.padStart(14)} (native only)`);
        continue;
      }
      const host = g.scales ? (g.floor ? g.limit / hf : g.limit * hf) : g.limit;
      const met = g.floor ? v >= host : v <= host;
      const ref = g.floor ? v >= g.limit : v <= g.limit;
      pass &&= met;
      lines.push(
        `  ${g.metric.padEnd(28)} ${v.toFixed(4).padStart(14)} ${g.unit.padEnd(9)} reference ${g.floor ? '≥' : '≤'} ${String(g.limit).padEnd(10)} ${ref ? 'met' : 'MISSED'}  host gate ${g.floor ? '≥' : '≤'} ${host.toFixed(4).padEnd(10)} ${met ? 'pass' : 'FAIL'}`,
      );
    }
    for (const [k, v] of Object.entries(result.metrics))
      if (!gates.some((g) => g.metric === k)) lines.push(`  ${k.padEnd(28)} ${v.toFixed(4).padStart(14)}`);
    const lo = samples.length ? Math.min(...samples) : 0;
    const hi = samples.length ? Math.max(...samples) : 0;
    const turbo = base > 0 && hi > base + 50;
    lines.push(
      `  clock while it ran            ${lo.toFixed(0)}–${hi.toFixed(0)} MHz${turbo ? ' (turbo: flagged, not an absolute number)' : ''}`,
    );
    lines.push(
      `  allocations in timed windows  ${result.allocs ?? 'n/a (a module without simcheck)'}; linear memory ${(result.memory_bytes / 1048576).toFixed(1)} MiB; ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
    ok &&= pass;
    const line = JSON.stringify({
      ts: Math.floor(Date.now() / 1000),
      git: git(['rev-parse', 'HEAD']),
      // The history file itself does not make a run dirty (it is appended to as the run goes).
      dirty:
        git([
          'status',
          '--porcelain',
          '--untracked-files=no',
          '--',
          ':/',
          ':(exclude,glob)**/bench/history.jsonl',
        ]) !== '',
      scenario: sc.name,
      runner: 'node wasm',
      module,
      quick,
      reps: (quick ? sc.quick : sc.full).reps,
      metrics: result.metrics,
      allocs: result.allocs,
      memory_bytes: result.memory_bytes,
      gate: pass ? 'pass' : 'fail',
      host_factor: hf,
      flags: turbo ? ['turbo'] : [],
      clock: { samples: samples.length, min_mhz: lo, max_mhz: hi, turbo },
      host: { loadavg: readFileSync('/proc/loadavg', 'utf8').trim(), cpus },
    });
    if (json) console.log(line);
    else console.log(lines.join('\n'));
    if (history) appendFileSync(history, `${line}\n`);
  }
  process.exitCode = ok ? 0 : 1;
}
