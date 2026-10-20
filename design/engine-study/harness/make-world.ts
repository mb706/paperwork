// Write a generated world to target/worlds/<scale>-<regime>-s<seed>.bin (for native Rust and tests).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, params } from '../gen/generate.ts';
import { xxh32Bytes } from '../ts/kernel.ts';

const here = dirname(fileURLToPath(import.meta.url));
const scale = process.argv[2] ?? 'tiny';
const regime = process.argv[3] ?? 'busy';
const seed = Number(process.argv[4] ?? 1);
const out = resolve(here, '../target/worlds');
mkdirSync(out, { recursive: true });
const blob = new Uint8Array(generate(params(scale, regime, seed)));
const file = `${out}/${scale}-${regime}-s${seed}.bin`;
writeFileSync(file, blob);
console.log(file, blob.byteLength, 'bytes, blob hash', xxh32Bytes(blob, blob.byteLength).toString(16));
