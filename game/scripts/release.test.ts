// The release build's manifest, compressed siblings and cache policy (10 §2.3, §9.7).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { devBuildHash, releaseManifest } from './build-manifest.ts';
import { checkRelease } from './check-release.ts';
import { sha256Hex, ZERO_HASH_HEX } from './lib/hash.ts';
import { cacheControl, compressSiblings } from './release-plugin.ts';

function fakeDist(): string {
  const dist = scratchDir('dist');
  mkdirSync(join(dist, 'assets'));
  mkdirSync(join(dist, 'data'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Paperwork</title>');
  writeFileSync(join(dist, 'assets/main-Ab3dE6gH.js'), 'console.log(1);'.repeat(50));
  writeFileSync(join(dist, 'assets/sim-9xY8wV7u.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(dist, 'assets/atlas-1a2b3c4d.ktx2'), new Uint8Array([1, 2, 3]));
  writeFileSync(join(dist, 'data/prototypes.bin'), new Uint8Array(64));
  writeFileSync(join(dist, 'data/build-manifest.json'), '{}');
  return dist;
}

describe('release build', () => {
  it('lists every served file with its SHA-256 and hashes the listing', () => {
    const dist = fakeDist();
    const m = releaseManifest(dist, {
      schemaHash: ZERO_HASH_HEX,
      protocolVersion: 0,
      build: 'm0',
      contents: { meta: [], omitted: [] },
    });
    expect(m.assets.map((a) => a.path)).toEqual([
      'assets/atlas-1a2b3c4d.ktx2',
      'assets/main-Ab3dE6gH.js',
      'assets/sim-9xY8wV7u.wasm',
      'data/prototypes.bin',
      'index.html',
    ]);
    const listing = m.assets.map((a) => `${a.sha256}  ${a.path}\n`).join('');
    expect(m.buildHash).toBe(sha256Hex(listing));
    expect(m.modules.sim).toBe(sha256Hex(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));
    expect(m.prototypesHash).toBe(sha256Hex(new Uint8Array(64)));
    // Compressed siblings are encodings of the same files: they change neither the listing nor the hash.
    expect(compressSiblings(dist)).toBe(5);
    expect(
      releaseManifest(dist, {
        schemaHash: ZERO_HASH_HEX,
        protocolVersion: 0,
        build: 'm0',
        contents: { meta: [], omitted: [] },
      }).buildHash,
    ).toBe(m.buildHash);
  });

  it('writes brotli and gzip siblings of text-like files only', () => {
    const dist = fakeDist();
    compressSiblings(dist);
    const js = readFileSync(join(dist, 'assets/main-Ab3dE6gH.js'));
    expect(brotliDecompressSync(readFileSync(join(dist, 'assets/main-Ab3dE6gH.js.br'))).equals(js)).toBe(
      true,
    );
    expect(gunzipSync(readFileSync(join(dist, 'assets/main-Ab3dE6gH.js.gz'))).equals(js)).toBe(true);
    expect(() => readFileSync(join(dist, 'assets/atlas-1a2b3c4d.ktx2.br'))).toThrow();
  });

  it('caches hashed files forever and revalidates the entry points', () => {
    expect(cacheControl('/assets/main-Ab3dE6gH.js')).toMatch('immutable');
    expect(cacheControl('/')).toBe('no-cache');
    expect(cacheControl('/index.html')).toBe('no-cache');
    expect(cacheControl('/data/build-manifest.json')).toBe('no-cache');
  });

  it('hashes a dev build from its parts', () => {
    const a = devBuildHash({}, ZERO_HASH_HEX, ZERO_HASH_HEX);
    expect(a).toBe(sha256Hex(new Uint8Array(128)));
    expect(devBuildHash({ sim: 'f'.repeat(64) }, ZERO_HASH_HEX, ZERO_HASH_HEX)).not.toBe(a);
  });
});

// C1a-r1 finding 12: a release bundle must carry both modules, and the checker proves every listed file.
describe('the release bundle check', () => {
  const release = (withGen: boolean) => {
    const dist = fakeDist();
    if (withGen)
      writeFileSync(join(dist, 'assets/gen-Zz9yX8wV.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 1]));
    const m = releaseManifest(dist, {
      schemaHash: ZERO_HASH_HEX,
      protocolVersion: 0,
      build: 'm0',
      contents: { meta: ['start.inventory'], omitted: [] },
    });
    writeFileSync(join(dist, 'data/build-manifest.json'), `${JSON.stringify(m)}\n`);
    compressSiblings(dist);
    return dist;
  };
  it('accepts a complete bundle', () => {
    expect(checkRelease(release(true))).toEqual([]);
  });
  it('refuses a bundle without gen.wasm, a tampered file and a missing sibling', () => {
    expect(checkRelease(release(false))).toContain('the manifest names no gen.wasm');
    const dist = release(true);
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Changed</title>');
    rmSync(join(dist, 'data/prototypes.bin.br'));
    const problems = checkRelease(dist).join('\n');
    expect(problems).toMatch('index.html: SHA-256');
    expect(problems).toMatch('data/prototypes.bin.br is missing');
  });
});
