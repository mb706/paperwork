// `npm run check`, `npm test` and `npm run ci` (10 §2.3), as parallel lanes of steps with timings.
//
//   check  biome, tsc -b, check-arch, schema-gen --check, cargo fmt --check, clippy -D warnings (with and
//          without simcheck), the clippy bans, the data stage --check (run twice, D14), and the Python
//          spec checks (validate_spec, render_spec --check, render_slice --check)
//   test   cargo test (dev and ntest profiles, simcheck) and Vitest
//   ci     check and test, then the data stage, then in parallel the e2e smoke (Chrome and Firefox) and the
//          release path: the release WebAssembly (its build skipped when no input changed since the last
//          green run, its feature gate always run), vite build, the bundle check and the preview smoke; then,
//          alone so that nothing else loads the host, the benchmark budget gate (10 §10.6): `simtool bench
//          --quick` natively and the same scenarios through sim.wasm in Node (bench/node-runner.ts)
//
// Steps in one lane run in order (the cargo steps share target/); lanes run concurrently. In M0, "green"
// means M0's checks and tests (the capability manifest, 10 §2.4); the cross-engine smoke trace joins with
// integration. Pin the run on a busy host: `taskset -c 0-15 npm run ci`.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mustRebuild,
  outputHashes,
  RELEASE_OUTPUTS,
  releaseInputsKey,
  type Stamp,
} from './ci-release-cache.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name: string) => join(ROOT, 'node_modules', '.bin', name);
const NODE = process.execPath;

interface Step {
  name: string;
  cmd: string[];
  /** Skip with a note when this returns a reason. */
  skip?: () => string | null;
  /** What to run instead when skipped. */
  skipCmd?: string[];
  /** Run after the step succeeds. */
  after?: () => void;
}
type Lane = Step[];

const CHECK: Lane[] = [
  [{ name: 'biome', cmd: [BIN('biome'), 'check', '.'] }],
  [{ name: 'tsc -b', cmd: [BIN('tsc'), '-b'] }],
  [
    { name: 'check-arch', cmd: [NODE, 'scripts/check-arch.ts'] },
    { name: 'schema-gen --check', cmd: [NODE, 'scripts/schema-gen.ts', '--check'] },
    { name: 'clippy bans fire', cmd: [NODE, 'scripts/check-clippy-bans.ts'] },
  ],
  [{ name: 'data stage --check', cmd: [NODE, 'scripts/data-stage.ts', '--check', '--quiet'] }],
  [
    {
      name: 'validate_spec.py',
      cmd: ['gamedev-python', '../tools/validate_spec.py', '../design/spec/data', '--quiet'],
    },
    { name: 'render_spec.py --check', cmd: ['gamedev-python', '../tools/render_spec.py', '--check'] },
    { name: 'render_slice.py --check', cmd: ['gamedev-python', '../tools/render_slice.py', '--check'] },
  ],
];
const CARGO_CHECK: Step[] = [
  { name: 'cargo fmt --check', cmd: ['cargo', 'fmt', '--all', '--check'] },
  {
    name: 'cargo clippy',
    cmd: ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'],
  },
  {
    name: 'cargo clippy (simcheck)',
    cmd: [
      'cargo',
      'clippy',
      '--workspace',
      '--all-targets',
      '--locked',
      '--features',
      'simcheck',
      '--',
      '-D',
      'warnings',
    ],
  },
];
const CARGO_TEST: Step[] = [
  { name: 'cargo test', cmd: ['cargo', 'test', '--workspace', '--locked', '--features', 'simcheck'] },
  {
    name: 'cargo test (ntest)',
    cmd: ['cargo', 'test', '--workspace', '--locked', '--profile', 'ntest', '--features', 'simcheck'],
  },
];
const VITEST: Step = { name: 'vitest', cmd: [BIN('vitest'), 'run'] };

const STAMP = join(ROOT, '.cache', 'ci', 'wasm-release.stamp.json');
const readStamp = (): Stamp | null => {
  try {
    return JSON.parse(readFileSync(STAMP, 'utf8')) as Stamp;
  } catch {
    return null;
  }
};
let releaseKey = '';
const RELEASE: Step = {
  name: 'release wasm + feature gate',
  cmd: ['sh', 'scripts/wasm-release.sh'],
  // Skipped only when the inputs and both outputs are those of the last green run; the gate still runs.
  skip: () => {
    releaseKey = releaseInputsKey({ root: ROOT, env: process.env });
    const why = mustRebuild(ROOT, readStamp(), releaseKey);
    return why === null ? 'unchanged since the last green run (feature gate run)' : null;
  },
  skipCmd: [NODE, 'scripts/wasm-feature-gate.ts', ...RELEASE_OUTPUTS],
  after: () => {
    mkdirSync(dirname(STAMP), { recursive: true });
    const stamp: Stamp = {
      key: releaseKey || releaseInputsKey({ root: ROOT, env: process.env }),
      outputs: outputHashes(ROOT) ?? {},
    };
    writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
  },
};
const BUILD: Step = {
  name: 'vite build',
  cmd: [NODE, 'node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'],
};
const CHECK_RELEASE: Step = { name: 'release bundle check', cmd: [NODE, 'scripts/check-release.ts'] };
const E2E_RELEASE: Step = {
  name: 'e2e @release (preview)',
  cmd: [BIN('playwright'), 'test', '-c', 'playwright.release.config.ts'],
};
const E2E: Step = {
  name: 'e2e @smoke (Chrome, Firefox)',
  cmd: [BIN('playwright'), 'test', '--grep', '@smoke'],
};
const DATA: Step = { name: 'data stage', cmd: [NODE, 'scripts/data-stage.ts', '--quiet'] };
// The budget gate (10 §10.6; C2c-r1 finding 8): each scenario's tick p99 against §11's budget × the host factor.
// `simtool` and the module without simcheck build in the `wasmdev` profile (release semantics, no LTO,
// incremental), the module into its own target directory so the dev module stays as the dev server built it.
const SCENARIOS = 'target/bench/scenarios';
const BENCH: Step[] = [
  { name: 'bench: simtool', cmd: ['cargo', 'build', '--locked', '--profile', 'wasmdev', '-p', 'simtool'] },
  {
    name: 'bench --quick (native)',
    cmd: ['target/wasmdev/simtool', 'bench', '--quick', '--no-history', '--write-scenarios', SCENARIOS],
  },
  {
    name: 'bench: sim.wasm',
    cmd: [
      'cargo',
      'build',
      '--locked',
      '--profile',
      'wasmdev',
      '--target',
      'wasm32-unknown-unknown',
      '-p',
      'simabi',
      '--target-dir',
      'target/bench',
    ],
  },
  { name: 'bench --quick (Node, wasm)', cmd: [NODE, 'bench/node-runner.ts', '--quick', '--no-history'] },
];

interface Result {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}

function runStep(s: Step): Promise<Result> {
  const reason = s.skip?.();
  if (reason && !s.skipCmd)
    return Promise.resolve({ name: s.name, ok: true, ms: 0, note: `skipped: ${reason}` });
  const t0 = performance.now();
  return new Promise((resolve) => {
    const [cmd, ...args] = (reason ? s.skipCmd : s.cmd) as [string, ...string[]];
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    const done = (ok: boolean, extra = ''): void => {
      const ms = Math.round(performance.now() - t0);
      if (!ok) console.log(`\n── ${s.name} FAILED ──\n${out.trim()}${extra}\n`);
      else if (!reason) s.after?.();
      console.log(`${ok ? '  ok  ' : ' FAIL '} ${s.name.padEnd(30)} ${(ms / 1000).toFixed(1).padStart(6)} s`);
      resolve({ name: s.name, ok, ms, ...(reason ? { note: `skipped: ${reason}` } : {}) });
    };
    child.on('error', (e) => done(false, `\n${e.message}`));
    child.on('close', (code) => done(code === 0));
  });
}

async function runLanes(lanes: Lane[]): Promise<Result[]> {
  const results = await Promise.all(
    lanes.map(async (lane) => {
      const out: Result[] = [];
      for (const s of lane) {
        const r = await runStep(s);
        out.push(r);
        if (!r.ok) break;
      }
      return out;
    }),
  );
  return results.flat();
}

async function main(): Promise<number> {
  const mode = process.argv[2] ?? 'ci';
  const t0 = performance.now();
  let results: Result[] = [];
  if (mode === 'check') results = await runLanes([...CHECK, CARGO_CHECK]);
  else if (mode === 'test') results = await runLanes([CARGO_TEST, [VITEST]]);
  else if (mode === 'ci') {
    results = await runLanes([...CHECK, [...CARGO_CHECK, ...CARGO_TEST], [VITEST]]);
    // The data stage first, alone: afterwards every run of it (the dev server's, vite build's) writes
    // nothing, so the two browser suites never read a file being written.
    if (results.every((r) => r.ok)) results.push(...(await runLanes([[DATA]])));
    if (results.every((r) => r.ok))
      results.push(...(await runLanes([[E2E], [RELEASE, BUILD, CHECK_RELEASE, E2E_RELEASE]])));
    if (results.every((r) => r.ok)) results.push(...(await runLanes([BENCH])));
  } else {
    console.error('usage: node scripts/ci.ts check|test|ci');
    return 2;
  }
  const wall = (performance.now() - t0) / 1000;
  const failed = results.filter((r) => !r.ok);
  for (const r of results) if (r.note) console.log(`  ${r.name}: ${r.note}`);
  const cpu = results.reduce((a, r) => a + r.ms, 0) / 1000;
  console.log(
    `${mode}: ${failed.length === 0 ? 'green' : `${failed.length} step(s) failed`} in ${wall.toFixed(1)} s wall (${cpu.toFixed(1)} s of steps)`,
  );
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
