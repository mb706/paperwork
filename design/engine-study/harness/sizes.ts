// Bundle sizes and cold start-up (WP A1 question 5): the TS kernel as a minified ES module vs the wasm builds.
// node harness/sizes.ts  → results/sizes.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'target/sizes');
mkdirSync(out, { recursive: true });
await build({
  configFile: false,
  logLevel: 'warn',
  build: { lib: { entry: resolve(root, 'ts/kernel.ts'), formats: ['es'], fileName: 'kernel' }, outDir: out, emptyOutDir: true, target: 'es2024', minify: true },
});
const size = (p: string) => {
  const b = readFileSync(p);
  return {
    file: p.replace(`${root}/`, ''),
    raw: b.length,
    gzip: gzipSync(b, { level: 9 }).length,
    brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
};
const files = [resolve(out, 'kernel.js'), ...['sim.raw.wasm', 'sim.wasm', 'sim-simd.raw.wasm', 'sim-simd.wasm'].map((f) => resolve(root, 'target/wasm', f))];
const sizes = files.map(size);

// cold start-up, each in a fresh Node process (5 runs): wasm compile + instantiate, and the JS module import
const coldWasm = (f: string) =>
  JSON.parse(
    execFileSync('node', ['-e', `const fs=require('fs');const b=fs.readFileSync('${f}');let t=performance.now();WebAssembly.compile(b).then(async m=>{const c=performance.now()-t;t=performance.now();await WebAssembly.instantiate(m,{env:{now:()=>0}});console.log(JSON.stringify({compile:c,instantiate:performance.now()-t}))})`], { encoding: 'utf8' }),
  );
const coldJs = () =>
  JSON.parse(execFileSync('node', ['--input-type=module', '-e', `const t=performance.now();await import('${resolve(out, 'kernel.js')}');console.log(JSON.stringify({import:performance.now()-t}))`], { encoding: 'utf8' }));
const runs = (fn: () => Record<string, number>) => Array.from({ length: 5 }, fn);
const startup = {
  wasm: runs(() => coldWasm(resolve(root, 'target/wasm/sim.wasm'))),
  wasmSimd: runs(() => coldWasm(resolve(root, 'target/wasm/sim-simd.wasm'))),
  tsImport: runs(coldJs),
};
const res = { sizes, startup };
writeFileSync(resolve(root, 'results/sizes.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
