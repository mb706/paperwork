// Golden hashes from the TS kernel for the Rust test (rust/tests/golden.rs): writes target/worlds/*.bin and
// target/golden.txt with lines "<world file> <ticks> <sleep|nosleep> <hash>".
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, params } from '../gen/generate.ts';
import { World } from '../ts/kernel.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../target/worlds');
mkdirSync(dir, { recursive: true });
const lines: string[] = [];
for (const regime of ['busy', 'typical', 'backed', 'starved']) {
  const blob = generate(params('tiny', regime, 1));
  const file = resolve(dir, `tiny-${regime}-s1.bin`);
  writeFileSync(file, new Uint8Array(blob));
  for (const mode of ['sleep', 'nosleep']) {
    const w = new World(blob);
    if (mode === 'nosleep') w.setNoSleep(true);
    for (const t of [1000, 4000]) {
      w.run(t - w.tick);
      lines.push(`${file} ${t} ${mode} ${w.hash().toString(16).padStart(8, '0')}`);
    }
  }
}
writeFileSync(resolve(here, '../target/golden.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
