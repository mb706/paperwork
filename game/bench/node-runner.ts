// The Node runner of 10 §10.6 (C2c-r1 finding 8): the M0 scenarios that `simtool bench --write-scenarios DIR`
// exports, timed through sim.wasm's ABI in a worker thread, as the game runs them: per tick `sim_tick`,
// `sim_digest` and `sim_pending_chunks` (the shell's calls), `sim_extract` per extraction. The same method and
// gates as `simtool bench` (scenarios.json carries both): a full run checks §10.6's thresholds, `--quick` (`ci`'s
// budget gate) the tails, on the reference machine × the host factor. The main thread samples the pinned cores'
// clocks while a scenario runs and flags turbo. Results go to bench/history.jsonl ("runner": "node wasm").
// The runner core is shared with the browser runner (bench.html's worker): src/dev/bench/sim-core.ts (C8).
//
//   node bench/node-runner.ts [--scenarios DIR] [--module sim.wasm] [--quick] [--json] [--no-history]
//
// Defaults: target/bench/scenarios and target/bench/wasm32-unknown-unknown/wasmdev/simabi.wasm (the module
// without simcheck, built into its own target directory so the dev module stays as the dev server built it).
// The gate metrics the ABI cannot show are native only (sim-core's NATIVE_ONLY, listed as such); any other missing
// metric fails, and so does a run that did not simulate its plan's ticks (the M0 exit audit #3 and #8, C9).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import {
  type BenchManifest as Manifest,
  NATIVE_ONLY,
  planProblem,
  type ScenarioResult as Result,
  runScenario,
  type BenchScenario as Scenario,
} from '../src/dev/bench/sim-core.ts';

interface Job {
  dir: string;
  module: string;
  scenario: Scenario;
  quick: boolean;
}

/** Runs one scenario in this worker thread. */
function run(job: Job): Result {
  const module = new WebAssembly.Module(readFileSync(job.module));
  return runScenario(module, (f) => new Uint8Array(readFileSync(join(job.dir, f))), job.scenario, job.quick);
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
    const short = planProblem(sc, result, quick);
    if (short !== null) {
      pass = false;
      lines.push(`  FAIL: ${short}`);
    }
    for (const g of gates) {
      const v = result.metrics[g.metric];
      if (v === undefined) {
        const native = NATIVE_ONLY.has(g.metric);
        pass &&= native;
        lines.push(
          `  ${g.metric.padEnd(28)} ${'n/a'.padStart(14)} ${native ? '(native only)' : 'MISSING: FAIL'}`,
        );
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
