// The release build's cache skips only when every input and both outputs are those of the last green run
// (C1a-r1 finding 13).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { mustRebuild, outputHashes, releaseInputsKey, type Stamp } from './ci-release-cache.ts';

const TOOLS = { rustc: 'rustc 1.99.1', wasmOpt: 'wasm-opt version 133' };

function tree(): string {
  const root = scratchDir('release-cache');
  for (const d of ['crates/sim/src', 'target/wasm-release']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'crates/sim/src/lib.rs'), 'pub fn f() {}\n');
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\n');
  writeFileSync(join(root, 'target/wasm-release/sim.wasm'), 'sim');
  writeFileSync(join(root, 'target/wasm-release/gen.wasm'), 'gen');
  return root;
}

describe('the release cache', () => {
  const env = { CARGO_HOME: '/nonexistent' };
  it('skips when nothing changed', () => {
    const root = tree();
    const key = releaseInputsKey({ root, env, tools: TOOLS });
    const stamp: Stamp = { key, outputs: outputHashes(root) ?? {} };
    expect(mustRebuild(root, stamp, key)).toBeNull();
  });
  it('rebuilds when an output is missing or changed', () => {
    const root = tree();
    const key = releaseInputsKey({ root, env, tools: TOOLS });
    const stamp: Stamp = { key, outputs: outputHashes(root) ?? {} };
    writeFileSync(join(root, 'target/wasm-release/sim.wasm'), 'tampered');
    expect(mustRebuild(root, stamp, key)).toMatch('sim.wasm changed');
    rmSync(join(root, 'target/wasm-release/gen.wasm'));
    expect(mustRebuild(root, stamp, key)).toBe('an output is missing');
    expect(mustRebuild(root, null, key)).toBe('no green run recorded');
  });
  it('keys on the sources, cargo configuration, environment and tools', () => {
    const root = tree();
    const key = releaseInputsKey({ root, env, tools: TOOLS });
    expect(
      releaseInputsKey({ root, env: { ...env, RUSTFLAGS: '-C target-feature=+simd128' }, tools: TOOLS }),
    ).not.toBe(key);
    expect(
      releaseInputsKey({ root, env: { ...env, CARGO_PROFILE_RELEASE_LTO: 'false' }, tools: TOOLS }),
    ).not.toBe(key);
    expect(releaseInputsKey({ root, env: { ...env, UNRELATED: '1' }, tools: TOOLS })).toBe(key);
    expect(releaseInputsKey({ root, env, tools: { ...TOOLS, wasmOpt: 'wasm-opt version 134' } })).not.toBe(
      key,
    );
    mkdirSync(join(root, '.cargo'));
    writeFileSync(
      join(root, '.cargo/config.toml'),
      '[build]\nrustflags = ["-C", "target-feature=+simd128"]\n',
    );
    const withConfig = releaseInputsKey({ root, env, tools: TOOLS });
    expect(withConfig).not.toBe(key);
    writeFileSync(join(root, 'crates/sim/src/lib.rs'), 'pub fn g() {}\n');
    expect(releaseInputsKey({ root, env, tools: TOOLS })).not.toBe(withConfig);
  });
});
