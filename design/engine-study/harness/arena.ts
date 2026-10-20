// Hybrid experiment (WP A1 question 7): move every typed array of a TS World into one arena — a plain
// ArrayBuffer, or the buffer of a WebAssembly.Memory — and replace each field by a view. If the TS kernel runs
// as fast on views into wasm linear memory, then "all sim state in wasm memory, some systems in Rust, the
// rest in TS on the same memory" costs TS nothing.
import type { World } from '../ts/kernel.ts';

type TA = Int32Array | Float64Array | Uint16Array | Int16Array | Uint32Array | Float32Array | Uint8Array;
const CTORS = [Int32Array, Float64Array, Uint16Array, Int16Array, Uint32Array, Float32Array, Uint8Array];

export function arenaize(w: World, kind: 'buffer' | 'wasm-memory'): { bytes: number } {
  const fields: [string, TA][] = [];
  for (const [k, v] of Object.entries(w)) {
    if (k === 'out' || k === 'outF' || k === 'outU' || k === 'phaseAcc') continue; // render buffer and timers stay
    if (CTORS.some((C) => v instanceof C)) fields.push([k, v as TA]);
  }
  let total = 0;
  for (const [, a] of fields) total = (total + a.byteLength + 15) & ~15;
  let buf: ArrayBuffer;
  if (kind === 'wasm-memory') {
    const mem = new WebAssembly.Memory({ initial: Math.ceil(total / 65536) + 1 });
    buf = mem.buffer;
  } else {
    buf = new ArrayBuffer(total + 16);
  }
  let off = 0;
  for (const [k, a] of fields) {
    const C = a.constructor as new (b: ArrayBuffer, o: number, n: number) => TA;
    const view = new C(buf, off, a.length);
    view.set(a as never);
    (w as unknown as Record<string, unknown>)[k] = view;
    off = (off + a.byteLength + 15) & ~15;
  }
  return { bytes: total };
}
