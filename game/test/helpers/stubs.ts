// The modules the shell's tests run (pm/wp/C3-shell.md):
// - the stub modules of test/stubs/ (Rust, the generated SimAbi and GenAbi), built on demand into target/stubs/
//   (cargo's lock serialises concurrent builds; an up-to-date build is a no-op);
// - the real modules (crates/simabi, crates/genabi), built as the dev server builds them (wasmdev, simcheck).
//   Until the sim package's module lands they are the M0 scaffold (ABI 0): `realSim()` says so, and the tests
//   that need the real module skip with that reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME } from './paths.ts';

const TARGET = 'wasm32-unknown-unknown';
let stubsBuilt = false;
let realBuilt = false;

function cargo(args: string[]): void {
  execFileSync('cargo', args, { cwd: GAME, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

export function buildStubs(): void {
  if (stubsBuilt) return;
  cargo([
    'build',
    '--release',
    '--locked',
    '--quiet',
    '--target',
    TARGET,
    '--manifest-path',
    'test/stubs/Cargo.toml',
    '--target-dir',
    'target/stubs',
  ]);
  stubsBuilt = true;
}

/** The stub sim.wasm's bytes. */
export function stubSimBytes(): Uint8Array {
  buildStubs();
  return new Uint8Array(readFileSync(join(GAME, 'target', 'stubs', TARGET, 'release', 'stubsim.wasm')));
}

/** The stub gen.wasm's bytes. */
export function stubGenBytes(): Uint8Array {
  buildStubs();
  return new Uint8Array(readFileSync(join(GAME, 'target', 'stubs', TARGET, 'release', 'stubgen.wasm')));
}

const compiled = new Map<string, Promise<WebAssembly.Module>>();
function compileOnce(key: string, bytes: () => Uint8Array): Promise<WebAssembly.Module> {
  let m = compiled.get(key);
  if (!m) {
    m = WebAssembly.compile(bytes() as Uint8Array<ArrayBuffer>);
    compiled.set(key, m);
  }
  return m;
}

export const stubSim = (): Promise<WebAssembly.Module> => compileOnce('stubsim', stubSimBytes);
export const stubGen = (): Promise<WebAssembly.Module> => compileOnce('stubgen', stubGenBytes);

/** The real modules as the dev server builds them (wasmdev profile, simcheck). */
function buildReal(): void {
  if (realBuilt) return;
  cargo([
    'build',
    '--profile',
    'wasmdev',
    '--features',
    'simcheck',
    '--locked',
    '--quiet',
    '--target',
    TARGET,
    '-p',
    'simabi',
    '-p',
    'genabi',
  ]);
  realBuilt = true;
}

export function realSimBytes(): Uint8Array {
  buildReal();
  return new Uint8Array(readFileSync(join(GAME, 'target', TARGET, 'wasmdev', 'simabi.wasm')));
}

export function realGenBytes(): Uint8Array {
  buildReal();
  return new Uint8Array(readFileSync(join(GAME, 'target', TARGET, 'wasmdev', 'genabi.wasm')));
}

/**
 * The real sim.wasm, or why the tests that need it skip: while crates/simabi is the M0 scaffold (ABI 0), there
 * is no real module yet (the sim package's C2b/C2c phases deliver it).
 */
export async function realSim(): Promise<{ module: WebAssembly.Module } | { skip: string }> {
  const module = await compileOnce('realsim', realSimBytes);
  const instance = await WebAssembly.instantiate(module, {
    env: { host_log: () => {}, host_panic: () => {}, host_now: () => 0 },
  });
  const v = instance.exports.sim_abi_version;
  const abi = typeof v === 'function' ? (v as () => number)() >>> 0 : -1;
  if (abi === 0)
    return { skip: 'crates/simabi is the M0 scaffold (ABI 0): the real sim.wasm has not landed' };
  return { module };
}

// ------------------------------------------------------------------------------------- the stubs' contract

/** FNV-1a, 64 bits (test/stubs/common.rs `fnv`). */
export const FNV_OFFSET = 0xcbf29ce484222325n;
export function fnv(h: bigint, bytes: Uint8Array): bigint {
  let x = h;
  for (const b of bytes) {
    x ^= BigInt(b);
    x = (x * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return x;
}

const le32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};
const le64 = (v: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

/** The stub's per-tick digest: d_t = FNV-1a 64 of (u32 tick, the closure's bytes). */
export const stubDigest = (tick: number, closure: Uint8Array): bigint =>
  fnv(fnv(FNV_OFFSET, le32(tick)), closure);
/** The stub's rolling digest: r_t = FNV-1a 64 of (r_{t−1}, d_t). */
export const stubRoll = (r: bigint, d: bigint): bigint => fnv(fnv(FNV_OFFSET, le64(r)), le64(d));
/** A stub world's r₀ (a new world): FNV-1a 64 of the seed. */
export const stubLineage0 = (seed: number): bigint => fnv(FNV_OFFSET, le32(seed));

/** The stub sim's `debug_dump` commands (test/stubs/stubsim/src/lib.rs). */
export const STUB_COMMAND = {
  /** The dev panic: C3's proposal for the real module's simcheck builds. */
  panic: 0xffffffff,
  /** Grow linear memory and move the exported column (the epoch moves). */
  grow: 0xffff0001,
  /** The next packet is about 607 KiB. */
  bigPacket: 0xffff0002,
  /** A trap without a panic message. */
  unreachable: 0xffff0003,
  /** Two chunk requests (5,0) and (6,0) committing 30 ticks on, reported by the next sim_pending_chunks. */
  request: 0xffff0004,
} as const;
