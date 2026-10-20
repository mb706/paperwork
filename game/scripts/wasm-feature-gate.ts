// The WebAssembly feature gate (10 §2.3, D19): a release module may use exactly the features of Rust
// 1.99's wasm32 target defaults. SIMD, relaxed SIMD, threads and atomics above all fail the build.
//
// Two checks, so neither a stripped target-features section nor a mislabelled one slips through:
//  1. `wasm-opt <module> --print-features` must print exactly ALLOWED (the target-features section);
//  2. the module must validate with only ALLOWED enabled (`--mvp-features --enable-…`), so no instruction
//     outside the set can hide in it.
//
// Usage: node scripts/wasm-feature-gate.ts <module.wasm>...
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The defaults of Rust 1.99's wasm32-unknown-unknown target, measured with binaryen 133 (10 §2.3). */
export const ALLOWED_FEATURES = [
  'mutable-globals',
  'nontrapping-float-to-int',
  'bulk-memory',
  'bulk-memory-opt',
  'sign-ext',
  'reference-types',
  'multivalue',
  'call-indirect-overlong',
] as const;

export interface GateResult {
  ok: boolean;
  printed: string[];
  problems: string[];
}

function wasmOpt(args: string[]): { status: number; out: string } {
  const r = spawnSync('wasm-opt', args, { encoding: 'utf8' });
  if (r.error) throw new Error(`wasm-opt: ${r.error.message} (binaryen 133 must be on PATH; see CLAUDE.md)`);
  return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

export function checkWasmFeatures(path: string): GateResult {
  const problems: string[] = [];
  const p = wasmOpt([path, '--print-features']);
  const printed = p.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('--enable-'))
    .map((l) => l.slice('--enable-'.length))
    .sort();
  if (p.status !== 0) problems.push(`wasm-opt --print-features failed: ${p.out.trim()}`);
  const allowed = new Set<string>(ALLOWED_FEATURES);
  const extra = printed.filter((f) => !allowed.has(f));
  const missing = [...allowed].filter((f) => !printed.includes(f)).sort();
  if (extra.length > 0) problems.push(`features outside the allowed set: ${extra.join(', ')}`);
  if (missing.length > 0) problems.push(`the target-features section lacks: ${missing.join(', ')}`);
  const v = wasmOpt([path, '--mvp-features', ...ALLOWED_FEATURES.map((f) => `--enable-${f}`), '--quiet']);
  if (v.status !== 0) {
    const first = v.out.trim().split('\n').slice(0, 3).join(' | ');
    problems.push(`does not validate with only the allowed features: ${first}`);
  }
  return { ok: problems.length === 0, printed, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/wasm-feature-gate.ts <module.wasm>...');
    process.exit(2);
  }
  let failed = 0;
  for (const f of files) {
    const r = checkWasmFeatures(f);
    if (r.ok) console.log(`feature gate: ${f} ok (${r.printed.length} allowed features)`);
    else {
      failed++;
      for (const p of r.problems) console.error(`feature gate: ${f}: ${p}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}
