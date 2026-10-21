// `npm run ci:fast`, `npm run check`, `npm test` and `npm run ci` (10 §2.3), as parallel lanes of steps with timings.
//
//   fast   the inner loop, about 40 s warm (C9): Biome, tsc -b, check-arch, schema-gen --check, cargo fmt and clippy,
//          the native tests (`cargo test --profile ntest`, every test with assertions on, optimised) and Vitest. No
//          e2e, release or benchmarks: run the full `ci` before reporting work done
//   check  biome, tsc -b, check-arch, schema-gen --check, cargo fmt --check, clippy -D warnings (with and
//          without simcheck), the clippy bans, the data stage --check (run twice, D14), the Python spec checks
//          (validate_spec, render_spec --check, render_slice --check), and the published art's acceptance
//          (`npm run assets -- --check`: the fixtures, and the atlas against its provenance)
//   test   cargo test (dev and ntest profiles, simcheck) and Vitest
//   ci     the merge gate: check and test (the cargo lane also builds what the browser suites run: simtool, the
//          simcheck simtool, the dev server's modules), then the data stage, then in parallel the browser suites
//          (@smoke and @audio in Chrome and Firefox, PW_WORKERS workers: the cross-engine trace of D18 d among them,
//          the game's sound, the art at both pixel ratios) and the release path (the release WebAssembly, its
//          build skipped when no input changed since the last green run, its feature gate always run; vite build,
//          the bundle check, the preview smoke); then, alone so that nothing else loads the host, the timing tests
//          (@timing: 60 UPS over a whole walk, one worker) and the benchmark budget gate (10 §10.6: `simtool bench
//          --quick` natively and the same scenarios through sim.wasm in Node).
//          A green run records its inputs' key (scripts/ci-inputs.ts: the tracked and changed files of game/,
//          design/spec/ and tools/, the tools' versions, the published art's and audio's provenance); a run whose
//          key is unchanged skips every lane, and the Python spec lane is skipped when design/spec/ and tools/ are
//          unchanged. `npm run ci -- --force` runs everything.
//   slow   `npm run test:slow` (10 §2.3, §10.4; C8): the ignored native probes, then the cross-engine trace on every
//          recorded session in test/logs/ in Node, Chrome and Firefox, on the dev module and on the release one
//
// Steps in one lane run in order (the cargo steps share target/); lanes run concurrently. In M0, "green"
// means M0's checks and tests (the capability manifest, 10 §2.4). Pin the run on a busy host:
// `taskset -c 0-15 npm run ci`.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentFacts, treeKey } from './ci-inputs.ts';
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

const REPO = join(ROOT, '..');

interface Step {
  name: string;
  cmd: string[];
  /** Extra environment variables. */
  env?: Record<string, string>;
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
      skip: () => specUnchanged(),
    },
    {
      name: 'render_spec.py --check',
      cmd: ['gamedev-python', '../tools/render_spec.py', '--check'],
      skip: () => specUnchanged(),
    },
    {
      name: 'render_slice.py --check',
      cmd: ['gamedev-python', '../tools/render_slice.py', '--check'],
      skip: () => specUnchanged(),
    },
  ],
  // the published art against its provenance (the M0 exit audit #4): missing or stale fails
  [{ name: 'assets --check', cmd: [NODE, 'scripts/build-assets.ts', '--check'] }],
];
// `ci:fast` (C9): the inner loop's lanes
const FAST: Lane[] = [
  [{ name: 'biome', cmd: [BIN('biome'), 'check', '.'] }],
  [{ name: 'tsc -b', cmd: [BIN('tsc'), '-b'] }],
  [
    { name: 'check-arch', cmd: [NODE, 'scripts/check-arch.ts'] },
    { name: 'schema-gen --check', cmd: [NODE, 'scripts/schema-gen.ts', '--check'] },
  ],
  [
    { name: 'cargo fmt --check', cmd: ['cargo', 'fmt', '--all', '--check'] },
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
    {
      name: 'cargo test (ntest)',
      cmd: ['cargo', 'test', '--workspace', '--locked', '--profile', 'ntest', '--features', 'simcheck'],
    },
  ],
  [{ name: 'vitest', cmd: [BIN('vitest'), 'run'] }],
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
// The native side of the cross-engine trace (e2e/trace.spec.ts, D18 d) and of the budget gate: built here, in the
// cargo lane, so the e2e lane finds it fresh (C8).
const SIMTOOL: Step = {
  name: 'simtool (wasmdev)',
  cmd: ['cargo', 'build', '--locked', '--profile', 'wasmdev', '-p', 'simtool'],
};
// What else the browser suites run, built once here rather than on demand inside a test (the M0 exit audit #10): the
// simcheck simtool that replays the dev panic's report (e2e/simtool.ts), and the dev server's modules (the cargo
// plugin's own command, so its start-up build finds them fresh).
const PREBUILD: Step[] = [
  {
    name: 'simtool (simcheck)',
    cmd: ['cargo', 'build', '--locked', '-p', 'simtool', '--features', 'simcheck'],
  },
  {
    name: 'wasmdev modules',
    cmd: [
      'cargo',
      'build',
      '--profile',
      'wasmdev',
      '--features',
      'simcheck',
      '--target',
      'wasm32-unknown-unknown',
      '-p',
      'simabi',
      '-p',
      'genabi',
      '--locked',
    ],
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
  name: 'e2e @smoke @audio',
  cmd: [BIN('playwright'), 'test', '--grep', '@smoke|@audio'],
};
// Tests that measure time, alone on the host (the M0 exit audit #9, #10): one worker, nothing else running.
const TIMING: Step = {
  name: 'e2e @timing (alone)',
  cmd: [BIN('playwright'), 'test', '--grep', '@timing', '--workers', '1'],
};
const DATA: Step = { name: 'data stage', cmd: [NODE, 'scripts/data-stage.ts', '--quiet'] };
// The budget gate (10 §10.6; C2c-r1 finding 8): each scenario's tick p99 against §11's budget × the host factor.
// `simtool` and the module without simcheck build in the `wasmdev` profile (release semantics, no LTO,
// incremental), the module into its own target directory so the dev module stays as the dev server built it.
// This run's own scenario directory: concurrent runs in one tree never write each other's (the M0 exit audit #6).
const SCENARIOS = `target/bench/scenarios-ci-${process.pid}`;
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
  {
    name: 'bench --quick (Node, wasm)',
    cmd: [NODE, 'bench/node-runner.ts', '--quick', '--no-history', '--scenarios', SCENARIOS],
  },
];

// `npm run test:slow` (C8): the native probes (ignored by `cargo test`), then the cross-engine trace on every
// session, dev and release modules (the release module built and gated first).
const SLOW: Step[] = [
  {
    name: 'cargo test --ignored (ntest)',
    cmd: [
      'cargo',
      'test',
      '--workspace',
      '--locked',
      '--profile',
      'ntest',
      '--features',
      'simcheck',
      '--',
      '--ignored',
    ],
  },
  SIMTOOL,
  { name: 'release wasm + feature gate', cmd: ['sh', 'scripts/wasm-release.sh'] },
  {
    name: 'trace: every session (dev)',
    cmd: [BIN('playwright'), 'test', 'e2e/trace.spec.ts'],
    env: { TRACE_SET: 'all' },
  },
  {
    name: 'trace: every session (release)',
    cmd: [BIN('playwright'), 'test', 'e2e/trace.spec.ts'],
    env: { TRACE_SET: 'all', TRACE_MODULE: 'release' },
  },
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
      env: { ...process.env, FORCE_COLOR: '0', ...s.env },
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

// The last green `ci` run's input keys (scripts/ci-inputs.ts).
const GREEN = join(ROOT, '.cache', 'ci', 'green.json');
interface Green {
  key: string;
  specKey: string;
  time: string;
  wall: number;
}
const readGreen = (): Green | null => {
  try {
    return JSON.parse(readFileSync(GREEN, 'utf8')) as Green;
  } catch {
    return null;
  }
};
let green: Green | null = null;
let specKey = '';
/** The Python spec checks read only design/spec/ and tools/: unchanged since a green run, they are skipped. */
function specUnchanged(): string | null {
  if (!green || specKey === '' || green.specKey !== specKey) return null;
  return 'design/spec/ and tools/ unchanged since the last green run';
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const mode = argv[0] ?? 'ci';
  const force = argv.includes('--force');
  const t0 = performance.now();
  let results: Result[] = [];
  let key = '';
  if (mode === 'fast') results = await runLanes(FAST);
  else if (mode === 'check') results = await runLanes([...CHECK, CARGO_CHECK]);
  else if (mode === 'test') results = await runLanes([CARGO_TEST, [VITEST]]);
  else if (mode === 'ci') {
    key = treeKey(REPO, ['game', 'design/spec', 'tools'], environmentFacts(ROOT));
    specKey = treeKey(REPO, ['design/spec', 'tools']);
    green = force ? null : readGreen();
    if (green?.key === key) {
      console.log(
        `ci: green, unchanged since the last green run (${green.time}, ${green.wall.toFixed(1)} s; key ${key.slice(0, 12)}): every lane skipped. \`npm run ci -- --force\` runs them`,
      );
      return 0;
    }
    results = await runLanes([...CHECK, [...CARGO_CHECK, ...CARGO_TEST, SIMTOOL, ...PREBUILD], [VITEST]]);
    // The data stage first, alone: afterwards every run of it (the dev server's, vite build's) writes
    // nothing, so the two browser suites never read a file being written.
    if (results.every((r) => r.ok)) results.push(...(await runLanes([[DATA]])));
    if (results.every((r) => r.ok))
      results.push(...(await runLanes([[E2E], [RELEASE, BUILD, CHECK_RELEASE, E2E_RELEASE]])));
    // the quiet stage: what measures time, with nothing else running
    if (results.every((r) => r.ok)) results.push(...(await runLanes([[TIMING, ...BENCH]])));
    rmSync(join(ROOT, SCENARIOS), { recursive: true, force: true });
  } else if (mode === 'slow') {
    results = await runLanes([[...SLOW]]);
  } else {
    console.error('usage: node scripts/ci.ts fast|check|test|ci|slow [--force]');
    return 2;
  }
  const wall = (performance.now() - t0) / 1000;
  const failed = results.filter((r) => !r.ok);
  for (const r of results) if (r.note) console.log(`  ${r.name}: ${r.note}`);
  const cpu = results.reduce((a, r) => a + r.ms, 0) / 1000;
  if (mode === 'ci' && failed.length === 0) {
    mkdirSync(dirname(GREEN), { recursive: true });
    const g: Green = { key, specKey, time: new Date().toISOString(), wall };
    writeFileSync(GREEN, `${JSON.stringify(g, null, 1)}\n`);
  }
  console.log(
    `${mode}: ${failed.length === 0 ? 'green' : `${failed.length} step(s) failed`} in ${wall.toFixed(1)} s wall (${cpu.toFixed(1)} s of steps)`,
  );
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
