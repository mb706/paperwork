// The host-factor calibration of 10 §10.6 and §11 (C8): the user's bench.html results (bench/user-results/, from
// `POST /__bench`) against this host's runs of the same page with the same module (the browser runner's lines in
// bench/history.jsonl, e2e/bench.spec.ts), metric by metric. The ratio host ÷ laptop of each time (laptop ÷ host of
// each rate) says how much slower this host is; their median is the measured host factor, which §11 estimates at
// 2.4 (IMPL-3) until this confirms it. Only means are compared: tails depend on the machines' noise, not their speed.
//
//   node bench/calibrate.ts [bench/user-results/<file>.json] [--write]
//
// --write appends the result to bench/calibration.jsonl. Run the host side first, with the module the user ran:
//   BENCH=1 taskset -c 0-7 npx playwright test e2e/bench.spec.ts --project chrome   (or firefox, as the user's browser)
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchResults } from '../src/dev/bench.ts';

const GAME = join(import.meta.dirname, '..');
const ESTIMATE = 2.4;
/** The metrics compared: means of times, and one rate. */
const TIMES = ['tick_mean_ms', 'extract_mean_ms', 'save_ms', 'load_ms', 'hash_ms'];
const RATES = ['apply_actions_per_s'];

interface HistoryLine {
  ts: number;
  scenario: string;
  runner: string;
  module_sha256?: string;
  quick: boolean;
  metrics: Record<string, number>;
  flags: string[];
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const dir = join(GAME, 'bench', 'user-results');
const file =
  args.find((a) => a.endsWith('.json')) ??
  (existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(dir, f))
        .pop()
    : undefined);
if (!file) {
  console.error('no results in bench/user-results/: the user runs http://127.0.0.1:5173/bench.html first');
  process.exit(2);
}
const user = JSON.parse(readFileSync(file, 'utf8')) as BenchResults;
if (!user.sim || user.sim.rows.length === 0) {
  console.error(`${file}: no simulation results`);
  process.exit(2);
}
const family = /Firefox\//.test(user.userAgent) ? 'firefox' : 'chrome';
const sha = user.module?.sha256;
const lines = readFileSync(join(GAME, 'bench', 'history.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('{'))
  .map((l) => JSON.parse(l) as HistoryLine)
  .filter((h) => h.runner === `${family} wasm` && !h.quick && (!sha || h.module_sha256 === sha));
if (lines.length === 0) {
  console.error(
    `no full ${family} runs of module ${sha?.slice(0, 12)} in bench/history.jsonl: run\n` +
      `  BENCH=1 taskset -c 0-7 npx playwright test e2e/bench.spec.ts --project ${family}`,
  );
  process.exit(2);
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0
    ? Number.NaN
    : n % 2
      ? (s[(n - 1) / 2] as number)
      : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
};
const rows: { scenario: string; metric: string; host: number; laptop: number; factor: number }[] = [];
for (const u of user.sim.rows) {
  // this host's latest full run of the scenario, preferring windows without turbo
  const mine = lines.filter((h) => h.scenario === u.scenario);
  const pick = mine.filter((h) => !h.flags.includes('turbo')).pop() ?? mine.pop();
  if (!pick) continue;
  for (const m of [...TIMES, ...RATES]) {
    const host = pick.metrics[m];
    const laptop = u.metrics[m];
    if (host === undefined || laptop === undefined || host <= 0 || laptop <= 0) continue;
    rows.push({
      scenario: u.scenario,
      metric: m,
      host,
      laptop,
      factor: RATES.includes(m) ? laptop / host : host / laptop,
    });
  }
}
const factor = median(rows.map((r) => r.factor));
console.log(
  `calibration: ${file}\n  the user's browser: ${user.userAgent}\n  module ${sha?.slice(0, 12)}; host runs: ${family} wasm\n`,
);
for (const r of rows)
  console.log(
    `  ${r.scenario.padEnd(15)} ${r.metric.padEnd(20)} host ${r.host.toPrecision(4).padStart(10)}  laptop ${r.laptop.toPrecision(4).padStart(10)}  host factor ${r.factor.toFixed(2)}`,
  );
console.log(
  `\nmeasured host factor (median of ${rows.length}): ${factor.toFixed(2)} (§11's estimate: ${ESTIMATE}; ${factor > ESTIMATE ? 'the host is slower than estimated: host budgets are generous' : 'the host is faster than estimated: host budgets are strict'})`,
);
if (write) {
  appendFileSync(
    join(GAME, 'bench', 'calibration.jsonl'),
    `${JSON.stringify({ ts: Math.floor(Date.now() / 1000), user: file, userAgent: user.userAgent, module: sha, family, factor, estimate: ESTIMATE, rows })}\n`,
  );
  console.log('appended to bench/calibration.jsonl');
}
