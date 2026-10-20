// A minimal driver of sim.wasm over 10 §15.8's calling convention, for the simulation's own WebAssembly tests
// (the Shell package owns the real loader in src/simworker/). It builds the module with cargo (`wasmdev`,
// simcheck, the full ABI), instantiates it with the three host imports, writes requests through `sim_input`
// and reads envelopes back. Not a shell: no MemoryLease, no worker, no pacing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SimStatus } from '../../src/shared/gen/abi.ts';
import { GAME } from '../helpers/paths.ts';

const target = (crate: string): string =>
  join(GAME, 'target', 'wasm32-unknown-unknown', 'wasmdev', `${crate}.wasm`);

/** Builds `simabi` (sim.wasm) or `genabi` (gen.wasm) with the full ABI; cargo skips a fresh build quickly. */
export function buildModule(crate: 'simabi' | 'genabi' = 'simabi'): WebAssembly.Module {
  const r = spawnSync(
    'cargo',
    [
      'build',
      '--locked',
      '--profile',
      'wasmdev',
      '--features',
      'simcheck,full-abi',
      '--target',
      'wasm32-unknown-unknown',
      '-p',
      crate,
    ],
    { cwd: GAME, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`cargo build of ${crate} failed:\n${r.stderr}`);
  return new WebAssembly.Module(readFileSync(target(crate)));
}

const NAMES = new Map(Object.entries(SimStatus).map(([k, v]) => [v as number, k]));

/** A status code's name (abi.yaml `SimStatus`). */
export const statusName = (code: number): string => NAMES.get(code) ?? `status ${code}`;

type Export = (...args: number[]) => number;

/** One instance of sim.wasm (prefix `sim`) or gen.wasm (prefix `gen`): a fresh world for every test. */
export class WasmSim {
  readonly exports: Record<string, Export>;
  readonly memory: WebAssembly.Memory;
  readonly prefix: string;
  panics: string[] = [];

  constructor(module: WebAssembly.Module, prefix: 'sim' | 'gen' = 'sim') {
    this.prefix = prefix;
    let memory: WebAssembly.Memory | null = null;
    const text = (ptr: number, len: number): string =>
      new TextDecoder().decode(new Uint8Array((memory as WebAssembly.Memory).buffer, ptr >>> 0, len >>> 0));
    const instance = new WebAssembly.Instance(module, {
      env: {
        host_panic: (ptr: number, len: number) => {
          this.panics.push(text(ptr, len));
        },
        host_log: () => {},
        host_now: () => 0,
      },
    });
    this.exports = instance.exports as unknown as Record<string, Export>;
    memory = instance.exports.memory as WebAssembly.Memory;
    this.memory = memory;
  }

  private call(name: string, ...args: number[]): number {
    const f = this.exports[name];
    if (!f) throw new Error(`sim.wasm exports no ${name}`);
    return f(...args) >>> 0;
  }

  /** Writes a request into the input buffer (§15.8: `sim_input(len)`) and returns its length. */
  private input(bytes: Uint8Array): number {
    const ptr = this.call(`${this.prefix}_input`, bytes.length);
    if (ptr === 0 && bytes.length > 0) throw new Error('sim_input: memory cannot grow');
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
  }

  /** A status export with an input buffer: the status's name. */
  status(name: string, bytes: Uint8Array = new Uint8Array()): string {
    return statusName(this.call(name, this.input(bytes)));
  }

  /** A status export with plain arguments (`sim_set_flags`). */
  statusArgs(name: string, ...args: number[]): string {
    return statusName(this.call(name, ...args));
  }

  /**
   * An envelope export: its payload (the bytes after `u32 len`), or the status from `sim_last_error` when it
   * returned 0. `bytes` is the input buffer's request, if the export reads one.
   */
  envelope(name: string, bytes?: Uint8Array, ...args: number[]): { status: string; out: Uint8Array | null } {
    const ptr = bytes === undefined ? this.call(name, ...args) : this.call(name, this.input(bytes));
    if (ptr === 0) return { status: this.lastError().status, out: null };
    if (ptr % 8 !== 0) throw new Error(`${name}: the envelope at ${ptr} is not 8-byte aligned`);
    const view = new DataView(this.memory.buffer);
    const len = view.getUint32(ptr, true);
    return { status: 'ok', out: new Uint8Array(this.memory.buffer.slice(ptr + 4, ptr + 4 + len)) };
  }

  /** `sim_last_error`: the code's name and the message. */
  lastError(): { status: string; message: string } {
    const ptr = this.call(`${this.prefix}_last_error`);
    if (ptr === 0) return { status: 'none', message: '' };
    const view = new DataView(this.memory.buffer);
    const len = view.getUint32(ptr, true);
    const code = view.getUint32(ptr + 4, true);
    const message = new TextDecoder().decode(new Uint8Array(this.memory.buffer, ptr + 8, len - 4));
    return { status: statusName(code), message };
  }

  /** The full state hash (`sim_state_hash`'s first u64), or null without a world. */
  stateHash(): bigint | null {
    const r = this.envelope('sim_state_hash');
    return r.out ? new DataView(r.out.buffer).getBigUint64(0, true) : null;
  }
}

/** `InitInput` around a prototypes.bin (§15.8): `u32 protos_len`, the bytes, `u32 flags`, `u32 reserved`. */
export function initInput(protos: Uint8Array, flags = 0): Uint8Array {
  const out = new Uint8Array(protos.length + 12);
  const v = new DataView(out.buffer);
  v.setUint32(0, protos.length, true);
  out.set(protos, 4);
  v.setUint32(4 + protos.length, flags, true);
  return out;
}

/** `LoadInput` from `SaveOutput` bytes (a golden state): the frames as they are, no remap tables, the lineage. */
export function stateInput(state: Uint8Array): Uint8Array {
  // SaveOutput is u32 count, frames, u64 r; LoadInput is u32 count, frames, u16 kind_count, u64 r.
  const out = new Uint8Array(state.length + 2);
  out.set(state.subarray(0, state.length - 8), 0);
  out.set(state.subarray(state.length - 8), state.length - 6);
  return out;
}
