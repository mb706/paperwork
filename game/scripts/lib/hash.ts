// Hashing helpers for the build tools. Pure functions over bytes: identical input gives identical output
// on every machine (D14).
import { createHash } from 'node:crypto';

/** SHA-256 of UTF-8 text or bytes, as 64 lowercase hex digits. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of UTF-8 text or bytes, as 32 bytes. */
export function sha256Bytes(data: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/** Lowercase hex of bytes. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Bytes of a hex string (even length, [0-9a-f]). */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error(`not lowercase hex: ${hex}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** The all-zero 32-byte hash, written while the schema is empty (before C1b's generator exists). */
export const ZERO_HASH_HEX = '0'.repeat(64);
