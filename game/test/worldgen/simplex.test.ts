// Worldgen's simplex noise is a port of simplex-noise 4.0.3 (10 §5.18: "pinned by golden values from
// simplex-noise 4.0.3"). This test computes the package's own values for seeded permutation tables (the
// package's buildPermutationTable fed by the SplitMix64 stream the Rust port uses) and holds the fixture
// `simplex-4.0.3.txt` to them; the Rust test `worldgen/tests/simplex.rs` holds the port to the same fixture,
// bit for bit. `UPDATE_SIMPLEX_GOLDEN=1` rewrites the fixture.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPermutationTable, createNoise2D } from 'simplex-noise';
import { describe, expect, it } from 'vitest';
import { GAME } from '../helpers/paths.ts';

const FIXTURE = join(GAME, 'test', 'worldgen', 'simplex-4.0.3.txt');
const M = (1n << 64n) - 1n;

/** SplitMix64's doubles in [0, 1), as worldgen's `SplitMix64::next_f64`. */
function splitmix(seed: bigint): () => number {
  let s = seed & M;
  return () => {
    s = (s + 0x9e3779b97f4a7c15n) & M;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
    z ^= z >> 31n;
    return Number(z >> 11n) / 2 ** 53;
  };
}

const bits = (v: number): string => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v, true);
  return b.getBigUint64(0, true).toString(16).padStart(16, '0');
};

/** The points: a lattice around the origin, negative and far coordinates, cell edges, tiny steps. */
function points(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = -6; i <= 6; i++)
    for (let j = -6; j <= 6; j++) out.push([i * 0.37 + 0.01 * j, j * 0.41 - 0.003 * i]);
  for (const v of [0, 1, -1, 0.5, -0.5, 255.75, -256.25, 1000.1, -1234.5678, 65536.3, -70000.9, 1e6 + 0.25])
    out.push([v, -v * 0.7 + 0.11]);
  for (let k = 0; k < 40; k++) out.push([k * 17.3 - 300, ((k * 29.1) % 97) - 48]);
  return out;
}

/**
 * The fixture's text: per seed, `seed <hex>`, `perm` and the table's first 256 entries, then one line per
 * point, `<x bits> <y bits> <noise bits>` (f64 bits, hex).
 */
function compute(): string {
  const lines = [
    '# simplex-noise@4.0.3: buildPermutationTable and createNoise2D fed by SplitMix64 (worldgen::noise)',
  ];
  for (const seed of [0n, 1945n, 0x0123456789abcdefn, M]) {
    lines.push(`seed ${seed.toString(16)}`);
    lines.push(`perm ${Array.from(buildPermutationTable(splitmix(seed)).slice(0, 256)).join(' ')}`);
    const noise = createNoise2D(splitmix(seed));
    for (const [x, y] of points()) lines.push(`${bits(x)} ${bits(y)} ${bits(noise(x, y))}`);
  }
  return `${lines.join('\n')}\n`;
}

describe('worldgen simplex noise', () => {
  it('the fixture holds simplex-noise 4.0.3s values', () => {
    const got = compute();
    if (process.env.UPDATE_SIMPLEX_GOLDEN === '1') writeFileSync(FIXTURE, got);
    expect(readFileSync(FIXTURE, 'utf8'), 'stale: UPDATE_SIMPLEX_GOLDEN=1 rewrites it').toBe(got);
  });
});
