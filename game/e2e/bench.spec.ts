// The browser runner of 10 §10.6 (C8): bench.html (src/dev/bench.ts) driven by Playwright in Chrome and Firefox, on
// this host. Its simulation section is the M0 scenarios through sim.wasm in a module worker (the core the Node
// runner shares: src/dev/bench/sim-core.ts), gated like the native and Node runners: a full run against §10.6's
// thresholds, BENCH_QUICK=1 against the budget gate's tails, both × the host factor 2.4. The determinism section must
// reproduce every natively recorded d_t. Results go to bench/history.jsonl ("runner": "chrome wasm" / "firefox wasm")
// with the pinned cores' clocks sampled meanwhile (turbo flagged, IMPL-3); `node bench/calibrate.ts` compares them
// with the user's bench.html results.
//
//   BENCH=1 taskset -c 0-7 npx playwright test e2e/bench.spec.ts     full plan, both browsers, the release module
//   BENCH_QUICK=1 BENCH_NO_HISTORY=1 …                               the quick plan, nothing appended
//   BENCH_SECTIONS=sim,det,render,gpu,audio …                        more of the page (render and gpu: Chrome only)
//   BENCH_AB=<a.wasm>,<b.wasm> BENCH_PAIRS=5 …                       the paired A/B of two modules (bench/ab.ts)
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BenchResults } from '../src/dev/bench.ts';
import { watchConsole } from './console.ts';

const GAME = join(import.meta.dirname, '..');
const HOST_FACTOR = 2.4;
const quick = process.env.BENCH_QUICK === '1';
const history = process.env.BENCH_NO_HISTORY === '1' ? null : join(GAME, 'bench', 'history.jsonl');
const ab = process.env.BENCH_AB?.split(',') ?? null;

/** The pinned cores' clocks, sampled every 20 ms while `f` runs (§10.6's clock log). */
async function clocked<T>(
  f: () => Promise<T>,
): Promise<{ value: T; min: number; max: number; turbo: boolean }> {
  const cpus = (
    readFileSync('/proc/self/status', 'utf8').match(/Cpus_allowed_list:\s*(\S+)/)?.[1] ?? ''
  ).trim();
  const list = cpus.split(',').flatMap((p) => {
    const [a, b] = p.split('-').map(Number) as [number, number | undefined];
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
  const base = Number(/@\s*([\d.]+)GHz/.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1] ?? 0) * 1000;
  const samples: number[] = [];
  const timer = setInterval(() => {
    let max = 0;
    for (const c of list) {
      try {
        const khz = Number(readFileSync(`/sys/devices/system/cpu/cpu${c}/cpufreq/scaling_cur_freq`, 'utf8'));
        if (khz / 1000 > max) max = khz / 1000;
      } catch {}
    }
    if (max > 0) samples.push(max);
  }, 20);
  try {
    const value = await f();
    const min = samples.length ? Math.min(...samples) : 0;
    const max = samples.length ? Math.max(...samples) : 0;
    return { value, min, max, turbo: base > 0 && max > base + 50 };
  } finally {
    clearInterval(timer);
  }
}

const git = (a: string[]): string => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', cwd: GAME }).trim();
  } catch {
    return '';
  }
};

test.describe.configure({ mode: 'serial' });
test.skip(
  process.env.BENCH !== '1' && !ab,
  'a benchmark: run it with BENCH=1 (it appends to bench/history.jsonl)',
);

test('the browser runner: bench.html on this host @bench', async ({ page, browserName }, info) => {
  test.setTimeout(30 * 60_000);
  const problems = watchConsole(page);
  if (ab) {
    for (const [k, file] of [
      ['a', ab[0]],
      ['b', ab[1]],
    ] as const) {
      const body = readFileSync(file as string);
      await page.route(`**/__ab/${k}.wasm`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/wasm', body }),
      );
    }
  }
  const sections = process.env.BENCH_SECTIONS ?? (browserName === 'chromium' ? 'gpu,sim,det' : 'sim,det');
  const query = ab
    ? `ab=1&pairs=${process.env.BENCH_PAIRS ?? 3}&post=0${quick ? '&quick=1' : ''}`
    : `auto=${sections}&post=0${quick ? '&quick=1' : ''}${process.env.BENCH_MODULE === 'dev' ? '&module=dev' : ''}`;
  await page.request.get('/data/build-manifest.json');
  const run = await clocked(async () => {
    await page.goto(`/bench.html?${query}`);
    await page.waitForFunction(
      () => (window as unknown as { __bench?: unknown }).__bench !== undefined,
      null,
      {
        timeout: 30 * 60_000,
        polling: 1000,
      },
    );
    return (await page.evaluate(
      () => (window as unknown as { __bench: BenchResults }).__bench,
    )) as BenchResults;
  });
  const r = run.value;
  writeFileSync(info.outputPath('bench.json'), `${JSON.stringify(r, null, 1)}\n`);
  const runner = `${info.project.name} wasm`;
  const clock = `clock ${run.min.toFixed(0)}–${run.max.toFixed(0)} MHz${run.turbo ? ' (turbo: flagged, not an absolute number)' : ''}`;
  if (ab) {
    console.log(`\nA/B in ${runner}, ${clock}\n${JSON.stringify(r.ab, null, 1)}\n`);
    expect(r.errors).toEqual([]);
    expect(problems).toEqual([]);
    return;
  }
  expect(r.errors, 'bench.html sections').toEqual([]);
  const lines: string[] = [
    `bench.html in ${runner} (module ${r.module?.url} ${r.module?.sha256.slice(0, 12)}; ${clock})`,
  ];
  let pass = true;
  for (const row of r.sim?.rows ?? []) {
    lines.push(`${row.scenario}${quick ? ' (budget gate: tails)' : ''}`);
    let rowPass = true;
    for (const v of row.verdicts) {
      if (v.value === null) {
        lines.push(`  ${v.metric.padEnd(28)} ${'n/a'.padStart(14)} (native only)`);
        continue;
      }
      // bench.html judged the reference machine (factor 1); the host gate is × 2.4 where the metric scales
      const limit = v.scales ? (v.floor ? v.limit / HOST_FACTOR : v.limit * HOST_FACTOR) : v.limit;
      const met = v.floor ? v.value >= limit : v.value <= limit;
      rowPass &&= met;
      lines.push(
        `  ${v.metric.padEnd(28)} ${v.value.toFixed(4).padStart(14)} ${v.unit.padEnd(9)} reference ${v.floor ? '≥' : '≤'} ${String(v.limit).padEnd(8)} ${v.met ? 'met' : 'MISSED'}  host gate ${v.floor ? '≥' : '≤'} ${limit.toFixed(4).padEnd(10)} ${met ? 'pass' : 'FAIL'}`,
      );
    }
    pass &&= rowPass;
    if (history)
      appendFileSync(
        history,
        `${JSON.stringify({
          ts: Math.floor(Date.now() / 1000),
          git: git(['rev-parse', 'HEAD']),
          dirty:
            git([
              'status',
              '--porcelain',
              '--untracked-files=no',
              '--',
              ':/',
              ':(exclude,glob)**/bench/history.jsonl',
            ]) !== '',
          scenario: row.scenario,
          runner,
          module: r.module?.url,
          module_sha256: r.module?.sha256,
          quick,
          metrics: row.metrics,
          memory_bytes: row.memory_bytes,
          gate: rowPass ? 'pass' : 'fail',
          host_factor: HOST_FACTOR,
          flags: run.turbo ? ['turbo'] : [],
          clock: { min_mhz: run.min, max_mhz: run.max, turbo: run.turbo },
          timer_resolution_ms: r.timerResolutionMs,
          user_agent: r.userAgent,
          host: { loadavg: readFileSync('/proc/loadavg', 'utf8').trim() },
        })}\n`,
      );
  }
  for (const d of r.determinism ?? [])
    lines.push(
      `determinism ${d.log}: ${d.ticks} ticks, ${d.identical ? 'identical to native' : `DIFFERS at ${d.firstDifferingTick}`}`,
    );
  for (const x of r.render ?? [])
    lines.push(
      `render ${x.scene}: main ${x.mainMs.median.toFixed(2)} ms, GPU ${x.gpuMs.median.toFixed(2)} ms (${x.gpuMs.method}), ${x.raf.fps.toFixed(1)} FPS (SwiftShader: not a GPU number)`,
    );
  console.log(`\n${lines.join('\n')}\n`);
  for (const d of r.determinism ?? []) expect(d.identical, `determinism ${d.log}`).toBe(true);
  expect(pass, 'the host gates').toBe(true);
  expect(problems).toEqual([]);
});
