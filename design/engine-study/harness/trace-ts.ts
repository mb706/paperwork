// Activity shares over time (TS kernel, Node): chooses the warm-up and documents the regimes.
import { generate, params } from '../gen/generate.ts';
import { World } from '../ts/kernel.ts';

const scale = process.argv[2] ?? 'mid';
const ticks = Number(process.argv[3] ?? 12000);
const every = Number(process.argv[4] ?? 1200);
const regimes = (process.argv[5] ?? 'busy,typical,backed,starved').split(',');
for (const regime of regimes) {
  const w = new World(generate(params(scale, regime, 1)));
  let lastR = 0;
  let t0 = performance.now();
  for (let t = 1; t <= ticks; t++) {
    w.step();
    if (t % every === 0) {
      const s = w.stats();
      const ms = (performance.now() - t0) / every;
      t0 = performance.now();
      console.log(`${regime.padEnd(8)} t=${String(t).padStart(6)} ms/tick=${ms.toFixed(3)} lines ${(100 * s.linesActive / s.lines).toFixed(0)}% ins ${(100 * s.insActive / s.inserters).toFixed(0)}% (moving ${(100 * s.insMoving / s.inserters).toFixed(0)}%) mach ${(100 * s.machActive / s.machines).toFixed(0)}% crafting ${(100 * s.machCrafting / s.machines).toFixed(0)}% items ${s.beltItems} research/min ${((s.research - lastR) * 3600 / every).toFixed(0)} growths ${s.nodeGrowths}`);
      lastR = s.research;
    }
  }
}
