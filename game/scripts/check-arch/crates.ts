// The crate graph (10 §2.2): each crate depends only on the crates its job allows, and the four pure
// crates forbid unsafe code. New crates need a reason in a report (10 §2.1).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Violation } from './common.ts';

const CRATE_DEPS: Record<string, readonly string[]> = {
  schema: [],
  det: ['libm'],
  worldgen: ['det', 'schema'],
  sim: ['det', 'schema', 'worldgen'],
  simabi: ['sim', 'schema', 'det'],
  genabi: ['worldgen', 'schema', 'det'],
  simtool: ['sim', 'schema', 'det', 'worldgen'],
};
const DEV_DEPS = ['proptest'];
export const PURE_CRATES = ['schema', 'det', 'worldgen', 'sim'];

export function checkCrates(root: string): Violation[] {
  const out: Violation[] = [];
  const v = (file: string, message: string, rule = 'crate-graph') =>
    out.push({ file, line: 1, col: 1, rule, message });
  let meta: {
    packages: {
      name: string;
      manifest_path: string;
      dependencies: { name: string; kind: string | null }[];
    }[];
  };
  try {
    meta = JSON.parse(
      execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--offline', '--locked'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (e) {
    v('Cargo.toml', `cargo metadata failed: ${(e as Error).message.split('\n')[0]}`);
    return out;
  }
  for (const p of meta.packages) {
    const file = relative(root, p.manifest_path).split(sep).join('/');
    const allowed = CRATE_DEPS[p.name];
    if (!allowed) {
      v(
        file,
        `crate ${p.name} is not in check-arch's crate graph (10 §2.2): add it with its allowed dependencies`,
      );
      continue;
    }
    for (const d of p.dependencies) {
      const ok =
        d.kind === 'dev'
          ? allowed.includes(d.name) || DEV_DEPS.includes(d.name) || d.name in CRATE_DEPS
          : allowed.includes(d.name);
      if (!ok)
        v(
          file,
          `${p.name} may not depend on ${d.name} (10 §2.2: ${p.name} → ${allowed.join(', ') || 'nothing'})`,
        );
    }
  }
  for (const c of PURE_CRATES) {
    const lib = join(root, 'crates', c, 'src', 'lib.rs');
    if (!existsSync(lib) || !readFileSync(lib, 'utf8').includes('#![forbid(unsafe_code)]'))
      v(`crates/${c}/src/lib.rs`, `${c} must declare #![forbid(unsafe_code)] (10 §2.2)`, 'unsafe');
  }
  return out;
}
