// Seeded integer hashing and value noise for the fake sim's terrain (10 §15.10: "generated terrain",
// deterministic). Integer arithmetic and +, −, ×, ÷ only: the worker shells keep the determinism bans of §2.5.

/** Murmur3's finalizer on u32 (§4.3's fmix32). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A u32 hash of (seed, a, b, c), order-sensitive. */
export function hash(seed: number, a: number, b = 0, c = 0): number {
  let h = fmix32(seed ^ 0x2545f491);
  h = fmix32((h ^ a) >>> 0);
  h = fmix32(((h + 0x9e3779b9) ^ b) >>> 0);
  h = fmix32(((h + 0x7f4a7c15) ^ c) >>> 0);
  return h;
}

/** A uniform number in [0, 1) from a hash. */
export const unit = (h: number): number => h / 4294967296;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1): a lattice of hashed values every `scale` tiles, smoothly interpolated. */
export function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const v = (i: number, j: number) => unit(hash(seed, x0 + i, y0 + j));
  const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
  const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
  return a + (b - a) * ty;
}

/** Two octaves of value noise, in [0, 1). */
export function fractal(seed: number, x: number, y: number, scale: number): number {
  return (valueNoise(seed, x, y, scale) * 2 + valueNoise(seed + 1, x, y, scale / 3)) / 3;
}
