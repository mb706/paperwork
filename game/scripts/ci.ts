// `npm run check`, `npm test` and `npm run ci` (10 §2.3), as parallel lanes of steps with timings.
//
//   check  biome, tsc -b, check-arch, schema-gen --check, cargo fmt --check, clippy -D warnings (with and
//          without simcheck), the clippy bans, the data stage --check (run twice, D14), and the Python
//          spec checks (validate_spec, render_spec --check, render_slice --check)
//   test   cargo test (dev and ntest profiles, simcheck) and Vitest
//   ci     check and test, then the e2e smoke (Chrome and Firefox) and the release WebAssembly build with
//          its feature gate, skipped when nothing it depends on changed since the last green run
//
// Steps in one lane run in order (the cargo steps share target/); lanes run concurrently. In M0, "green"
// means M0's checks and tests (the capability manifest, 10 §2.4); the cross-engine smoke trace and
// `bench --quick` join when the simulation exists. Pin the run on a busy host: `taskset -c 0-15 npm run ci`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits } from './lib/canonical.ts';
import { sha256Hex } from './lib/hash.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name: string) => join(ROOT, 'node_modules', '.bin', name);
const NODE = process.execPath;

interface Step {
  name: string;
  cmd: string[];
  /** Skip with a note when this returns a reason. */
  skip?: () => string | null;
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

/** The release build's inputs: when none changed since the last green run, the slow build is skipped. */
function releaseInputsHash(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  walk(join(ROOT, 'crates'));
  walk(join(ROOT, 'schema'));
  for (const f of [
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'scripts/wasm-release.sh',
    'scripts/wasm-feature-gate.ts',
  ])
    if (existsSync(join(ROOT, f))) files.push(f);
  files.sort(compareCodeUnits);
  return sha256Hex(files.map((f) => `${sha256Hex(readFileSync(join(ROOT, f)))}  ${f}\n`).join(''));
}
const STAMP = join(ROOT, '.cache', 'ci', 'wasm-release.stamp');
const RELEASE: Step = {
  name: 'release wasm + feature gate',
  cmd: ['sh', 'scripts/wasm-release.sh'],
  skip: () =>
    existsSync(STAMP) &&
    readFileSync(STAMP, 'utf8') === releaseInputsHash() &&
    existsSync(join(ROOT, 'target/wasm-release/sim.wasm'))
      ? 'unchanged since the last green run'
      : null,
  after: () => {
    mkdirSync(dirname(STAMP), { recursive: true });
    writeFileSync(STAMP, releaseInputsHash());
  },
};
const E2E: Step = {
  name: 'e2e @smoke (Chrome, Firefox)',
  cmd: [BIN('playwright'), 'test', '--grep', '@smoke'],
};
const DATA: Step = { name: 'data stage', cmd: [NODE, 'scripts/data-stage.ts', '--quiet'] };

interface Result {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}

function runStep(s: Step): Promise<Result> {
  const reason = s.skip?.();
  if (reason) return Promise.resolve({ name: s.name, ok: true, ms: 0, note: `skipped: ${reason}` });
  const t0 = performance.now();
  return new Promise((resolve) => {
    const [cmd, ...args] = s.cmd as [string, ...string[]];
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
      if (ok) s.after?.();
      else console.log(`\n── ${s.name} FAILED ──\n${out.trim()}${extra}\n`);
      console.log(`${ok ? '  ok  ' : ' FAIL '} ${s.name.padEnd(30)} ${(ms / 1000).toFixed(1).padStart(6)} s`);
      resolve({ name: s.name, ok, ms });
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
    if (results.every((r) => r.ok)) results.push(...(await runLanes([[DATA, E2E], [RELEASE]])));
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

process.exitCode = await main();
