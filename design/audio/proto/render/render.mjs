// Render a piece of the Paperwork music engine offline in headless Chrome (the real WebAudio),
// so the demos are what the game will play.
//
//   taskset -c 8-15,24-31 node design/audio/proto/render/render.mjs <config.json> [more.json ...]
//
// A config: {"name": "era1-demo", "piece": "era1", "duration": 140, "params": {"seed": 1945},
//            "automation": [[0, {"activity": 0.6}]], "solo": ["piano"]}
// Output: design/audio/out/renders/<name>.wav (float32) and <name>.notes.json (every note played).

import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.local/lib/node_modules/playwright`);

const here = path.dirname(fileURLToPath(import.meta.url));
const audioRoot = path.resolve(here, '../..'); // design/audio
const outDir = path.join(audioRoot, 'out', 'renders');
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.opus': 'audio/ogg', '.wav': 'audio/wav' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = path.basename(url.searchParams.get('name') ?? '');
    if (!/^[\w.-]+$/.test(name)) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(outDir, name), Buffer.concat(chunks));
      res.end('ok');
    });
    return;
  }
  const p = path.normalize(path.join(audioRoot, decodeURIComponent(url.pathname)));
  if (!p.startsWith(audioRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('content-type', TYPES[path.extname(p)] ?? 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome` });
try {
  for (const cfgPath of process.argv.slice(2)) {
    const cfgs = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    for (const cfg of Array.isArray(cfgs) ? cfgs : [cfgs]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/proto/render/render.html`);
      await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
      const r = await page.evaluate((c) => window.render(c), cfg);
      console.log(`${cfg.name}: ${r.notes} notes, ${r.seconds.toFixed(0)} s rendered in ${(r.ms / 1000).toFixed(1)} s (${r.realtime.toFixed(2)}x real time)`);
      if (r.stemLoudness) {
        const mixI = r.stemLoudness.mix.I;
        for (const [k, v] of Object.entries(r.stemLoudness)) console.log(`  ${k.padEnd(16)} I ${String(v.I).padStart(7)} LUFS  peak ${String(v.peakDb).padStart(7)} dBFS  rel ${(v.I - mixI).toFixed(1).padStart(6)} LU`);
      }
      if (r.errors?.length) errors.push(...r.errors);
      if (errors.length) console.log(`  errors:\n  ${errors.join('\n  ')}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
