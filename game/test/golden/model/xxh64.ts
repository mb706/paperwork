// XXH64 (seed 0 unless given), the hash of 10 §4.8: the state hash, the per-tick digest, the rolling digest
// and the UI records' change detection (§15.5). Written from the xxHash specification
// (https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md, "XXH64 algorithm description") with
// BigInt arithmetic: slow, but obviously the specification. Checked against the reference implementation's
// outputs (python-xxhash 3.5.0) in xxh64.test.ts.

const M64 = 0xffff_ffff_ffff_ffffn;
const P1 = 0x9e37_79b1_85eb_ca87n;
const P2 = 0xc2b2_ae3d_27d4_eb4fn;
const P3 = 0x1656_67b1_9e37_79f9n;
const P4 = 0x85eb_ca77_c2b2_ae63n;
const P5 = 0x27d4_eb2f_1656_67c5n;

const rotl = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & M64;
const mul = (a: bigint, b: bigint): bigint => (a * b) & M64;
const add = (a: bigint, b: bigint): bigint => (a + b) & M64;

function round(acc: bigint, lane: bigint): bigint {
  return mul(rotl(add(acc, mul(lane, P2)), 31n), P1);
}

function mergeRound(acc: bigint, val: bigint): bigint {
  return add(mul(acc ^ round(0n, val), P1), P4);
}

/** XXH64 of `data` with `seed` (both as in the specification); the result is a u64 as a bigint. */
export function xxh64(data: Uint8Array, seed = 0n): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = data.length;
  let p = 0;
  let h: bigint;
  if (len >= 32) {
    let v1 = add(add(seed, P1), P2);
    let v2 = add(seed, P2);
    let v3 = seed;
    let v4 = (seed - P1) & M64;
    while (p + 32 <= len) {
      v1 = round(v1, view.getBigUint64(p, true));
      v2 = round(v2, view.getBigUint64(p + 8, true));
      v3 = round(v3, view.getBigUint64(p + 16, true));
      v4 = round(v4, view.getBigUint64(p + 24, true));
      p += 32;
    }
    h = add(add(add(rotl(v1, 1n), rotl(v2, 7n)), rotl(v3, 12n)), rotl(v4, 18n));
    h = mergeRound(h, v1);
    h = mergeRound(h, v2);
    h = mergeRound(h, v3);
    h = mergeRound(h, v4);
  } else {
    h = add(seed, P5);
  }
  h = add(h, BigInt(len));
  while (p + 8 <= len) {
    h = add(mul(rotl(h ^ round(0n, view.getBigUint64(p, true)), 27n), P1), P4);
    p += 8;
  }
  if (p + 4 <= len) {
    h = add(mul(rotl(h ^ mul(BigInt(view.getUint32(p, true)), P1), 23n), P2), P3);
    p += 4;
  }
  while (p < len) {
    h = mul(rotl(h ^ mul(BigInt(data[p] as number), P5), 11n), P1);
    p += 1;
  }
  h ^= h >> 33n;
  h = mul(h, P2);
  h ^= h >> 29n;
  h = mul(h, P3);
  h ^= h >> 32n;
  return h;
}

/** A u64 as 16 lowercase hex digits. */
export function hex64(v: bigint): string {
  return v.toString(16).padStart(16, '0');
}

/** The little-endian bytes of a u64. */
export function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v & M64, true);
  return b;
}
