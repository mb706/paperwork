// B2 texture-format study, step 3: decode/transcode/upload timings in headless Chrome and Firefox.
//   taskset -c 0-7 node design/asset-study/texfmt/bench.mjs [reps=5] [pages=colour-high,colour-normal,icons]
// Serves design/art/out/texfmt/enc/ and the Basis Universal v2.50 transcoder (~/.local/opt/basisu-current/webgl/
// transcoder) on 127.0.0.1; writes design/art/out/texfmt/bench-<browser>.json.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pw = require(`${process.env.HOME}/.local/lib/node_modules/playwright`);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const enc = path.join(root, 'design/art/out/texfmt/enc');
const basis = path.join(process.env.HOME, '.local/opt/basisu-current/webgl/transcoder');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let p;
  if (u === '/') p = path.join(here, 'bench.html');
  else if (u.startsWith('/basis/')) p = path.join(basis, u.slice(7));
  else if (u.startsWith('/enc/')) p = path.join(enc, u.slice(5));
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', TYPES[path.extname(p)] ?? 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const reps = Number(process.argv[2] ?? 5);
const pages = (process.argv[3] ?? 'colour-high,colour-normal,icons').split(',');
const list = [];
for (const page of pages) {
  for (const f of fs.readdirSync(path.join(enc, page)).sort()) {
    const m = f.match(/^([\w-]+)\.(png|webp|ktx2)$/);
    if (!m || f.endsWith('.dec.png')) continue;
    list.push({ page, variant: m[1], kind: m[2], url: `/enc/${page}/${f}` });
  }
}
const browsers = [
  ['chrome', () => pw.chromium.launch({ executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome` })],
  ['firefox', () => pw.firefox.launch()],
];
try {
  for (const [name, launch] of browsers) {
    const b = await launch();
    const page = await b.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console error: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready === true && typeof BASIS === 'function');
    const out = await page.evaluate(([l, r]) => window.run(l, r), [list, reps]);
    out.version = b.version();
    fs.writeFileSync(path.join(enc, `../bench-${name}.json`), JSON.stringify(out, null, 1));
    console.log(name, out.version, 'webgl2', out.webgl2, out.renderer ?? '', JSON.stringify(out.ext), 'probe', JSON.stringify(out.probe ?? {}), 'init', out.transcoderInitMs.toFixed(1), 'ms');
    for (const r of out.rows) console.log(`  ${r.page.padEnd(14)} ${r.variant.padEnd(12)} ${r.op.padEnd(18)} ${Number.isNaN(r.ms) ? 'n/a' : r.ms.toFixed(1)} ms`);
    await b.close();
  }
} finally {
  server.close();
}
