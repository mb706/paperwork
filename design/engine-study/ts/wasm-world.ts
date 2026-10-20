// The Rust kernel (rust/src/lib.rs compiled to wasm32) behind the same interface as ts/kernel.ts's World.
// Works in Node and in a browser Worker. The world blob is copied into linear memory once, at load.
import type { SimLike } from './sim-like.ts';

export type { SimLike };

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(p: number, len: number): void;
  load(p: number, len: number): void;
  step(n: number): void;
  set_no_sleep(v: number): void;
  set_timing(v: number): void;
  phase_ms(k: number): number;
  reset_phase_ms(): void;
  hash(): number;
  tick(): number;
  stats(): number;
  extract(x0: number, y0: number, x1: number, y1: number, full: number): number;
  out_ptr(): number;
}

export const STAT_NAMES = [
  'tick', 'research', 'lines', 'linesActive', 'linesNonEmpty', 'beltItems', 'inserters', 'insActive', 'insMoving',
  'insWaitSrc', 'insWaitDst', 'machines', 'machActive', 'machCrafting', 'nodeGrowths',
] as const;

export class WasmWorld implements SimLike {
  private ex: Exports;

  private constructor(ex: Exports) {
    this.ex = ex;
  }

  static async compile(bytes: BufferSource): Promise<WebAssembly.Module> {
    return WebAssembly.compile(bytes);
  }

  static async create(mod: WebAssembly.Module, blob: ArrayBuffer, now: () => number): Promise<WasmWorld> {
    const inst = await WebAssembly.instantiate(mod, { env: { now } });
    const ex = inst.exports as unknown as Exports;
    const len = blob.byteLength;
    const p = ex.alloc(len);
    new Uint8Array(ex.memory.buffer, p, len).set(new Uint8Array(blob));
    ex.load(p, len);
    ex.dealloc(p, len);
    return new WasmWorld(ex);
  }

  step(): void {
    this.ex.step(1);
  }
  run(n: number): void {
    this.ex.step(n);
  }
  hash(): number {
    return this.ex.hash() >>> 0;
  }
  stats(): Record<string, number> {
    const a = new Float64Array(this.ex.memory.buffer, this.ex.stats(), STAT_NAMES.length);
    const o: Record<string, number> = {};
    STAT_NAMES.forEach((k, i) => {
      o[k] = a[i];
    });
    return o;
  }
  setNoSleep(v: boolean): void {
    this.ex.set_no_sleep(v ? 1 : 0);
  }
  setTiming(v: boolean): void {
    this.ex.set_timing(v ? 1 : 0);
  }
  phaseMs(): number[] {
    return [0, 1, 2, 3, 4].map((k) => this.ex.phase_ms(k));
  }
  resetPhaseMs(): void {
    this.ex.reset_phase_ms();
  }
  extract(x0: number, y0: number, x1: number, y1: number, full: boolean): number {
    return this.ex.extract(x0, y0, x1, y1, full ? 1 : 0);
  }
  outBytes(n: number): Uint8Array {
    return new Uint8Array(this.ex.memory.buffer, this.ex.out_ptr(), n * 16);
  }
  memoryBytes(): number {
    return this.ex.memory.buffer.byteLength;
  }
}
