// node harness/arena-node.ts <own|buffer|wasm-memory> <scale> <regime> [warmup ticks] → one JSON line
import { generate, params } from '../gen/generate.ts';
import { World } from '../ts/kernel.ts';
import { arenaize } from './arena.ts';

const [mode = 'own', scale = 'late', regime = 'busy', warm = '6000', ticks = '3600'] = process.argv.slice(2);
const w = new World(generate(params(scale, regime, 1)));
const info = mode === 'own' ? { bytes: 0 } : arenaize(w, mode as 'buffer' | 'wasm-memory');
w.run(Number(warm));
const t = new Float64Array(Number(ticks));
for (let k = 0; k < t.length; k++) {
  const a = performance.now();
  w.step();
  t[k] = performance.now() - a;
}
const s = Float64Array.from(t).sort();
const mean = t.reduce((x, y) => x + y, 0) / t.length;
console.log(JSON.stringify({ mode, scale, regime, arenaBytes: info.bytes, mean, p99: s[Math.floor(t.length * 0.99)], max: s[t.length - 1], hash: w.hash().toString(16).padStart(8, '0') }));
