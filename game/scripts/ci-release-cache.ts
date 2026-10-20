// The release build's cache for `npm run ci` (10 §2.3: skipped when nothing it depends on changed;
// C1a-r1 finding 13). The key covers every input of scripts/wasm-release.sh: the crates, the schema, the
// Cargo files and toolchain pin, cargo's configuration (the project's and CARGO_HOME's), the environment
// variables cargo and rustc read, the compiler's and the optimizer's identities, and the build scripts.
// A skip also needs both outputs present with the hashes the last green run recorded; the feature gate
// runs every time either way.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { compareCodeUnits } from './lib/canonical.ts';
import { sha256Hex } from './lib/hash.ts';

export const RELEASE_OUTPUTS = ['target/wasm-release/sim.wasm', 'target/wasm-release/gen.wasm'] as const;

/** Environment variables that change what cargo or rustc produce. */
export function relevantEnv(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((k) =>
      /^(RUSTFLAGS|RUSTDOCFLAGS|RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTUP_TOOLCHAIN|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_.*|CARGO_PROFILE_.*|CARGO_TARGET_.*|CARGO_INCREMENTAL|CARGO_TARGET_DIR)$/.test(
        k,
      ),
    )
    .sort(compareCodeUnits)
    .map((k) => `${k}=${env[k]}`);
}

function tool(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return `unavailable: ${(e as Error).message.split('\n')[0]}`;
  }
}

export interface KeyInputs {
  root: string;
  env: NodeJS.ProcessEnv;
  /** The compiler's and optimizer's identities (`rustc -vV`, `wasm-opt --version`). */
  tools?: { rustc: string; wasmOpt: string };
}

export function releaseInputsKey({ root, env, tools }: KeyInputs): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(join(root, 'crates'));
  walk(join(root, 'schema'));
  for (const f of [
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    '.cargo/config.toml',
    '.cargo/config',
    'scripts/wasm-release.sh',
    'scripts/wasm-feature-gate.ts',
  ])
    if (existsSync(join(root, f))) files.push(f);
  files.sort(compareCodeUnits);
  const lines = files.map((f) => `${sha256Hex(readFileSync(join(root, f)))}  ${f}`);
  const cargoHome = env.CARGO_HOME ?? join(homedir(), '.cargo');
  for (const f of ['config.toml', 'config']) {
    const p = join(cargoHome, f);
    if (existsSync(p)) lines.push(`${sha256Hex(readFileSync(p))}  $CARGO_HOME/${f}`);
  }
  lines.push(...relevantEnv(env));
  const t = tools ?? { rustc: tool('rustc', ['-vV']), wasmOpt: tool('wasm-opt', ['--version']) };
  lines.push(`rustc ${t.rustc}`, `wasm-opt ${t.wasmOpt}`);
  return sha256Hex(lines.join('\n'));
}

export interface Stamp {
  key: string;
  outputs: Record<string, string>;
}

export function outputHashes(root: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const f of RELEASE_OUTPUTS) {
    const p = join(root, f);
    if (!existsSync(p)) return null;
    out[f] = sha256Hex(readFileSync(p));
  }
  return out;
}

/** Why the release build must run, or null when the last green run's outputs still stand. */
export function mustRebuild(root: string, stamp: Stamp | null, key: string): string | null {
  if (!stamp) return 'no green run recorded';
  if (stamp.key !== key) return 'its inputs changed';
  const now = outputHashes(root);
  if (!now) return 'an output is missing';
  for (const f of RELEASE_OUTPUTS)
    if (now[f] !== stamp.outputs[f]) return `${f} changed since the last green run`;
  return null;
}
