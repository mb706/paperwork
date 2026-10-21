// The paired A/B comparison of 10 §10.6 (C2c-r1 finding 11): a hot-path change is measured against a base
// revision in one session, the two builds interleaved within each pair in alternating order (A B, then B A …),
// so turbo windows and load drift hit both alike; the result is the paired ratio (this tree ÷ base) per metric,
// its median and its spread, with each run's clock flags. Run it pinned:
//
//   taskset -c 0-15 node bench/ab.ts --base <rev> [--scenario NAME|all] [--pairs N] [--quick] [--runner native|chrome|firefox]
//
// The base is checked out as a git worktree under target/ab/<rev>, and both simtools are built in the
// `wasmdev` profile (release semantics, incremental); the base must be a revision whose simtool has `--json`.
// `--runner chrome|firefox` (C8) compares the two trees' sim.wasm instead (the `wasmdev` profile without simcheck,
// as the Node runner's), in one browser session: bench.html's A/B mode (e2e/bench.spec.ts with BENCH_AB), every
// scenario of both modules within each pair, in alternating order, with this host's clocks sampled meanwhile.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d: string): string => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : d;
};
const base = opt('--base', '');
if (!base) {
  console.error(
    'usage: node bench/ab.ts --base <rev> [--scenario NAME|all] [--pairs N] [--quick] [--runner native|chrome|firefox]',
  );
  process.exit(2);
}
const scenario = opt('--scenario', 'all');
const runner = opt('--runner', 'native');
const pairs = Number(opt('--pairs', '5'));
const quick = args.includes('--quick');
const game = resolve(import.meta.dirname, '..');
const sh = (cmd: string, a: string[], cwd = game, env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync(cmd, a, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 26,
  });

const rev = sh('git', ['rev-parse', '--short', base]).trim();
const tree = join(game, 'target', 'ab', rev);
if (!existsSync(tree)) sh('git', ['worktree', 'add', '--detach', tree, rev]);
const build = (dir: string, target: string): string => {
  sh('cargo', ['build', '--locked', '--quiet', '--profile', 'wasmdev', '-p', 'simtool'], dir, {
    ...process.env,
    CARGO_TARGET_DIR: target,
  });
  return join(target, 'wasmdev', 'simtool');
};
if (runner === 'chrome' || runner === 'firefox') {
  // Both trees' sim.wasm (wasmdev, no simcheck), then bench.html's A/B mode in one browser session.
  const wasm = (dir: string, target: string): string => {
    sh(
      'cargo',
      [
        'build',
        '--locked',
        '--quiet',
        '--profile',
        'wasmdev',
        '--target',
        'wasm32-unknown-unknown',
        '-p',
        'simabi',
      ],
      dir,
      { ...process.env, CARGO_TARGET_DIR: target },
    );
    return join(target, 'wasm32-unknown-unknown', 'wasmdev', 'simabi.wasm');
  };
  console.error(`building sim.wasm at ${rev} and in this tree…`);
  const a = wasm(join(tree, 'game'), join(game, 'target', 'ab', `${rev}-target`));
  const b = wasm(game, join(game, 'target', 'bench'));
  execFileSync(
    'npx',
    ['playwright', 'test', 'e2e/bench.spec.ts', '--project', runner, '--reporter', 'list'],
    {
      cwd: game,
      stdio: 'inherit',
      env: {
        ...process.env,
        BENCH_AB: `${a},${b}`,
        BENCH_PAIRS: String(pairs),
        BENCH_QUICK: quick ? '1' : '0',
      },
    },
  );
  process.exit(0);
}
console.error(`building simtool at ${rev} and in this tree…`);
const bins = {
  A: build(join(tree, 'game'), join(game, 'target', 'ab', `${rev}-target`)),
  B: build(game, join(game, 'target')),
};
const protos = join(game, 'public', 'data', 'prototypes.bin');

interface Run {
  scenario: string;
  metrics: Record<string, number>;
  flags: string[];
}
const runs: Record<'A' | 'B', Run[][]> = { A: [], B: [] };
for (let k = 0; k < pairs; k++) {
  const order: ('A' | 'B')[] = k % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
  for (const which of order) {
    const a = ['bench', '--scenario', scenario, '--no-history', '--json', '--protos', protos];
    if (quick) a.push('--quick');
    const out = sh(bins[which], a);
    runs[which].push(
      out
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l) as Run),
    );
    console.error(`pair ${k + 1}/${pairs}: ${which} done`);
  }
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
console.log(`paired A/B over ${pairs} pairs: A = ${rev}, B = this tree (ratio B ÷ A; < 1 is faster)`);
const names = [...new Set(runs.B.flat().map((r) => r.scenario))];
for (const name of names) {
  const pick = (which: 'A' | 'B', k: number) => runs[which][k]?.find((r) => r.scenario === name);
  const turbo = (['A', 'B'] as const).flatMap((w) =>
    runs[w].flat().filter((r) => r.scenario === name && r.flags.includes('turbo')),
  );
  console.log(`${name}${turbo.length ? ` (turbo in ${turbo.length} of ${2 * pairs} runs: flagged)` : ''}`);
  const metrics = Object.keys(pick('B', 0)?.metrics ?? {}).filter(
    (m) => m.endsWith('_ms') || m.endsWith('_per_s'),
  );
  for (const m of metrics) {
    const ratios: number[] = [];
    const as: number[] = [];
    const bs: number[] = [];
    for (let k = 0; k < pairs; k++) {
      const a = pick('A', k)?.metrics[m];
      const b = pick('B', k)?.metrics[m];
      if (a === undefined || b === undefined || a === 0) continue;
      ratios.push(b / a);
      as.push(a);
      bs.push(b);
    }
    if (ratios.length === 0) continue;
    console.log(
      `  ${m.padEnd(28)} A ${median(as).toPrecision(4).padStart(10)}  B ${median(bs).toPrecision(4).padStart(10)}  ratio ${median(ratios).toFixed(3)} [${Math.min(...ratios).toFixed(3)}, ${Math.max(...ratios).toFixed(3)}]`,
    );
  }
}
