// The interface both kernels implement (ts/kernel.ts, and ts/wasm-world.ts around the Rust build).
// Kept free of DOM and WebAssembly types, so the sim layer compiles with lib es2024 only (spec 10 §2.2).

export interface SimLike {
  step(): void;
  run(n: number): void;
  hash(): number;
  stats(): Record<string, number>;
  setNoSleep(v: boolean): void;
  setTiming(v: boolean): void;
  phaseMs(): number[];
  resetPhaseMs(): void;
  // render extraction: returns the record count; outBytes(n) views the 16-byte records
  extract(x0: number, y0: number, x1: number, y1: number, full: boolean): number;
  outBytes(n: number): Uint8Array;
}
