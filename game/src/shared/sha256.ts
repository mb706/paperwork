// SHA-256 (FIPS 180-4), synchronous, for the sim worker's blob checks (10 §15.3 "Blobs": the shell supplies a
// blob after verifying its hash). WebCrypto's digest is asynchronous, and an asynchronous check let a tick or a
// system action overtake the action that named the blob (C3-r1 5): the sequencer must stamp an action when it
// arrives. Blobs are rare and at most a few megabytes; this runs at roughly 200 MB/s in V8. Integer arithmetic
// only (deterministic, and allowed in worker code).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const W = new Uint32Array(64);

/** Hashes one 64-byte block at `at` of `b` into `h`. */
function block(h: Uint32Array, b: Uint8Array, at: number): void {
  for (let i = 0; i < 16; i++) {
    const o = at + 4 * i;
    W[i] =
      (((b[o] as number) << 24) |
        ((b[o + 1] as number) << 16) |
        ((b[o + 2] as number) << 8) |
        (b[o + 3] as number)) >>>
      0;
  }
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15] as number;
    const w2 = W[i - 2] as number;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = ((W[i - 16] as number) + s0 + (W[i - 7] as number) + s1) >>> 0;
  }
  let a = h[0] as number;
  let bb = h[1] as number;
  let c = h[2] as number;
  let d = h[3] as number;
  let e = h[4] as number;
  let f = h[5] as number;
  let g = h[6] as number;
  let hh = h[7] as number;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + (K[i] as number) + (W[i] as number)) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & bb) ^ (a & c) ^ (bb & c);
    const t2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = bb;
    bb = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = ((h[0] as number) + a) >>> 0;
  h[1] = ((h[1] as number) + bb) >>> 0;
  h[2] = ((h[2] as number) + c) >>> 0;
  h[3] = ((h[3] as number) + d) >>> 0;
  h[4] = ((h[4] as number) + e) >>> 0;
  h[5] = ((h[5] as number) + f) >>> 0;
  h[6] = ((h[6] as number) + g) >>> 0;
  h[7] = ((h[7] as number) + hh) >>> 0;
}

/** The SHA-256 of `bytes` (32 bytes). */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const n = bytes.length;
  const whole = n - (n % 64);
  for (let at = 0; at < whole; at += 64) block(h, bytes, at);
  // The tail, the 0x80 marker, zeros and the bit length (u64 big-endian) in one or two blocks.
  const tail = new Uint8Array(n % 64 < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[n % 64] = 0x80;
  const bits = n * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  const end = tail.length;
  tail[end - 8] = hi >>> 24;
  tail[end - 7] = (hi >>> 16) & 0xff;
  tail[end - 6] = (hi >>> 8) & 0xff;
  tail[end - 5] = hi & 0xff;
  tail[end - 4] = lo >>> 24;
  tail[end - 3] = (lo >>> 16) & 0xff;
  tail[end - 2] = (lo >>> 8) & 0xff;
  tail[end - 1] = lo & 0xff;
  for (let at = 0; at < end; at += 64) block(h, tail, at);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const v = h[i] as number;
    out[4 * i] = v >>> 24;
    out[4 * i + 1] = (v >>> 16) & 0xff;
    out[4 * i + 2] = (v >>> 8) & 0xff;
    out[4 * i + 3] = v & 0xff;
  }
  return out;
}

/** Lowercase hex of bytes. */
export function hexOf(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
}

/** Whether `bytes` hash to the 32-byte `name` (a blob's name, §15.3). */
export function hashesTo(bytes: Uint8Array, name: Uint8Array): boolean {
  const h = sha256(bytes);
  for (let i = 0; i < 32; i++) if (h[i] !== name[i]) return false;
  return true;
}
