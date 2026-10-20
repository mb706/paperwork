// check-arch (10 §2.2, §2.5, §4.1): the architecture rules that TypeScript and cargo cannot enforce alone.
//
//  1. Import boundaries between the TypeScript layers of src/ (10 §2.2), the packages each may use, and
//     static import targets (check-arch/ts-rules.ts).
//  2. Threads and memory: only src/app/ (and src/dev/) creates workers; the main thread only compiles
//     WebAssembly and the worker shells instantiate it; no SharedArrayBuffer or Atomics (10 §0 #6).
//  3. Determinism bans (D14, 10 §2.5) in the data stage, the schema generator, their libraries and
//     src/shared/, and (without the clock) in the worker shells, seen through aliases and closed over
//     imports; emitter order (check-arch/ts-rules.ts).
//  4. Generated files: the generators' inventory, headers, sources, schema hash and content hashes
//     (check-arch/generated.ts).
//  5. The crate graph and forbid(unsafe_code) (check-arch/crates.ts); no I/O in det, worldgen or sim
//     beyond clippy's bans (check-arch/rust-rules.ts).
//
// A line may opt out of one rule with a comment on the line before: `// check-arch-ignore <rule>: <reason>`.
//
// Usage: node scripts/check-arch.ts [--no-cargo]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, type Violation } from './check-arch/common.ts';
import { checkCrates } from './check-arch/crates.ts';
import { checkGeneratedFiles, generatedInventory } from './check-arch/generated.ts';
import { checkRustSource } from './check-arch/rust-rules.ts';
import { checkSource } from './check-arch/ts-rules.ts';

export { checkRustSource } from './check-arch/rust-rules.ts';
export { checkSource } from './check-arch/ts-rules.ts';

function files(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'target' || e.name === 'dist' || e.name.startsWith('.'))
      continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, exts));
    else if (exts.test(e.name)) out.push(p);
  }
  return out;
}

function main(): number {
  const started = performance.now();
  const ts = [
    ...['src', 'scripts', 'test', 'e2e', 'bench'].flatMap((d) => files(join(ROOT, d), /\.tsx?$/)),
    ...readdirSync(ROOT)
      .filter((f) => /\.config\.ts$/.test(f) && statSync(join(ROOT, f)).isFile())
      .map((f) => join(ROOT, f)),
  ];
  const rel = (abs: string) => relative(ROOT, abs).split(sep).join('/');
  const violations: Violation[] = [];
  for (const abs of ts) violations.push(...checkSource(rel(abs), readFileSync(abs, 'utf8')));
  violations.push(...checkGeneratedFiles(ROOT, generatedInventory()));
  for (const c of ['det', 'worldgen', 'sim'])
    for (const abs of files(join(ROOT, 'crates', c, 'src'), /\.rs$/))
      violations.push(...checkRustSource(rel(abs), readFileSync(abs, 'utf8')));
  if (!process.argv.includes('--no-cargo')) violations.push(...checkCrates(ROOT));
  for (const x of violations) console.error(`${x.file}:${x.line}:${x.col}: [${x.rule}] ${x.message}`);
  const ms = Math.round(performance.now() - started);
  console.log(`check-arch: ${ts.length} TypeScript files, ${violations.length} violation(s) in ${ms} ms`);
  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
