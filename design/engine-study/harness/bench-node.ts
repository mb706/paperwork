// Node 24 runner for one configuration: node harness/bench-node.ts <impl> <scale> <regime> [seed warmup ticks phaseTicks frames nosleep]
// Prints one JSON line. harness/run-node.ts spawns one process per configuration and repetition.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BenchCfg, type Impl, runBench } from './bench-core.ts';
import { cpuDelta, cpuSnap, hugePagesKb, numaPages } from './cpu.ts';

const here = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const cfg: BenchCfg = {
  impl: (a[0] ?? 'ts') as Impl,
  scale: a[1] ?? 'mid',
  regime: a[2] ?? 'busy',
  seed: Number(a[3] ?? 1),
  warmup: Number(a[4] ?? 6000),
  ticks: Number(a[5] ?? 3600),
  phaseTicks: Number(a[6] ?? 600),
  frames: Number(a[7] ?? 120),
  noSleep: a[8] === 'nosleep',
};
const wasmDir = resolve(here, '../target/wasm');
const c0 = cpuSnap();
const startedAt = Date.now();
const res = await runBench(cfg, {
  now: () => performance.now(),
  wasm: async (simd) => WebAssembly.compile(readFileSync(`${wasmDir}/${simd ? 'sim-simd' : 'sim'}.wasm`)),
});
console.log(JSON.stringify({ platform: 'node', version: process.version, startedAt, endedAt: Date.now(), load: cpuDelta(c0, cpuSnap()), numa: numaPages(), thpKb: hugePagesKb(), ...res }));
