import { describe, expect, it } from 'vitest';
import { hex64, xxh64 } from './xxh64.ts';

const text = (s: string) => new TextEncoder().encode(s);

describe('xxh64', () => {
  // Outputs of the reference implementation (python-xxhash 3.5.0, `xxhash.xxh64(data, seed).hexdigest()`).
  it.each([
    ['', 'ef46db3751d8e999'],
    ['a', 'd24ec4f1a98c6e5b'],
    ['abc', '44bc2cf5ad770999'],
    ['message digest', '066ed728fceeb3be'],
    ['abcdefghijklmnopqrstuvwxyz', 'cfe1f278fa89835c'],
  ])('hashes %j like the reference', (s, want) => {
    expect(hex64(xxh64(text(s)))).toBe(want);
  });

  it('hashes 768 bytes (every lane path) like the reference', () => {
    const b = new Uint8Array(768);
    for (let i = 0; i < b.length; i++) b[i] = i & 0xff;
    expect(hex64(xxh64(b))).toBe('8e03c838c596036f');
  });

  it('honours the seed like the reference', () => {
    expect(hex64(xxh64(text('abc'), 0x9e3779b97f4a7c15n))).toBe('2ed0f59d6b43ac8b');
  });

  it('reads a subarray at an odd offset', () => {
    const big = new Uint8Array(800);
    for (let i = 0; i < 768; i++) big[i + 3] = i & 0xff;
    expect(hex64(xxh64(big.subarray(3, 771)))).toBe('8e03c838c596036f');
  });
});
