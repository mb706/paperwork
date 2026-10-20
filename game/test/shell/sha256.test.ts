// The synchronous SHA-256 the sim worker verifies blobs with (src/shared/sha256.ts; C3-r1 5, 7) against Node's,
// across every padding case (lengths 0–200 cross the one- and two-block tails) and a few large inputs.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashesTo, hexOf, sha256 } from '../../src/shared/sha256.ts';

const node = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('sha256 (FIPS 180-4)', () => {
  it('matches node:crypto for lengths 0–200 and large inputs', () => {
    for (let n = 0; n <= 200; n++) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 131 + n * 7) & 0xff;
      expect(hexOf(sha256(b)), `length ${n}`).toBe(node(b));
    }
    for (const n of [4095, 65536, 1_000_003]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24;
      expect(hexOf(sha256(b)), `length ${n}`).toBe(node(b));
    }
  });

  it('the known answers of FIPS 180-2 (abc, the 448-bit message)', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(hexOf(sha256(enc('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hexOf(sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashesTo checks a blob against its name', () => {
    const b = new Uint8Array(1000).fill(9);
    const name = sha256(b);
    expect(hashesTo(b, name)).toBe(true);
    b[500] = 8;
    expect(hashesTo(b, name)).toBe(false);
  });
});
