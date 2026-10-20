// Cross-check: TS kernel (Node) vs native Rust (target/release/bench) on the same world files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { World } from '../ts/kernel.ts';

const warm = Number(process.argv[2] ?? 1000);
const ticks = Number(process.argv[3] ?? 2000);
const files = process.argv.slice(4);
for (const f of files) {
  const buf = readFileSync(f);
  for (const mode of ['sleep', 'nosleep']) {
    const w = new World(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (mode === 'nosleep') w.setNoSleep(true);
    w.run(warm + ticks);
    const ts = w.hash().toString(16).padStart(8, '0');
    const out = execFileSync('rust/target/release/bench', [f, String(warm), String(ticks), mode], { encoding: 'utf8' });
    const native = JSON.parse(out).hash;
    console.log(f.split('/').pop(), mode, 'ts', ts, 'native', native, ts === native ? 'MATCH' : 'MISMATCH');
  }
}
