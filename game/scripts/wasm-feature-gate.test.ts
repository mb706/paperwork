// The WebAssembly feature gate (10 §2.3, D19) passes a module with exactly the allowed features and fails
// SIMD, whether or not its target-features section admits it. Needs binaryen (wasm-as, wasm-opt).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { ALLOWED_FEATURES, checkWasmFeatures } from './wasm-feature-gate.ts';

function assemble(dir: string, name: string, wat: string, features: string[], section: boolean): string {
  const src = join(dir, `${name}.wat`);
  const raw = join(dir, `${name}.raw.wasm`);
  const out = join(dir, `${name}.wasm`);
  writeFileSync(src, wat);
  const flags = features.map((f) => `--enable-${f}`);
  execFileSync('wasm-as', [...flags, src, '-o', raw], { stdio: 'pipe' });
  execFileSync(
    'wasm-opt',
    [raw, '--mvp-features', ...flags, ...(section ? ['--emit-target-features'] : []), '-o', out],
    { stdio: 'pipe' },
  );
  return out;
}

describe('the feature gate', () => {
  const dir = scratchDir('feature-gate');
  const plain = '(module (func (export "f") (param i32) (result i32) (i32.extend8_s (local.get 0))))';
  const simd =
    '(module (func (export "f") (param i32) (result i32) (i32x4.extract_lane 0 (i32x4.splat (local.get 0)))))';

  it('passes a module that declares exactly the allowed features', () => {
    const r = checkWasmFeatures(assemble(dir, 'plain', plain, [...ALLOWED_FEATURES], true));
    expect(r.problems).toEqual([]);
    expect(r.printed).toEqual([...ALLOWED_FEATURES].sort());
  });
  it('fails a module that declares SIMD', () => {
    const r = checkWasmFeatures(assemble(dir, 'simd', simd, [...ALLOWED_FEATURES, 'simd'], true));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch('outside the allowed set: simd');
  });
  it('fails a module that uses SIMD without declaring it', () => {
    const r = checkWasmFeatures(assemble(dir, 'hidden', simd, ['simd'], false));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch('does not validate with only the allowed features');
  });
});
