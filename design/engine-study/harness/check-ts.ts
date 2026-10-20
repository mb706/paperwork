// Quick correctness check of the TS kernel: sleep vs NO_SLEEP hash equality, per regime.
import { generate, params } from '../gen/generate.ts';
import { World } from '../ts/kernel.ts';

const scale = process.argv[2] ?? 'tiny';
const ticks = Number(process.argv[3] ?? 3000);
for (const regime of ['busy', 'typical', 'backed', 'starved']) {
  const blob = generate(params(scale, regime, 1));
  const a = new World(blob);
  const b = new World(blob);
  b.setNoSleep(true);
  let firstBad = -1;
  for (let t = 1; t <= ticks; t++) {
    a.step();
    b.step();
    if (t % 100 === 0 || t === ticks) {
      if (a.hash() !== b.hash()) { firstBad = t; break; }
    }
  }
  console.log(regime, 'hash', a.hash().toString(16), 'nosleep', b.hash().toString(16), firstBad < 0 ? 'EQUAL' : `DIVERGED by tick ${firstBad}`, JSON.stringify(a.stats()));
}
