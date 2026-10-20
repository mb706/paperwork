// Realtime cost of the music engine in Chrome: plays a piece on a live AudioContext for N seconds and
// samples the CPU time of every renderer thread from /proc (the audio thread is the one that grows),
// plus the main-thread time spent scheduling.
//   taskset -c 8-15,24-31 node design/audio/proto/render/bench.mjs <config.json> [seconds]
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.local/lib/node_modules/playwright`);
const here = path.dirname(fileURLToPath(import.meta.url));
const audioRoot = path.resolve(here, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.opus': 'audio/ogg' };
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(audioRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(audioRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', TYPES[path.extname(p)] ?? 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const secs = Number(process.argv[3] ?? 30);
const HZ = 100; // clock ticks per second in /proc stat

function threads() {
  const out = new Map();
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('--type=renderer') && !cmd.includes('--type=utility')) continue;
    let tids;
    try { tids = fs.readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tids) {
      try {
        const st = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
        const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
        const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
        out.set(`${pid}/${tid}`, { name, cpu: Number(f[11]) + Number(f[12]), type: cmd.includes('--type=utility') ? 'utility' : 'renderer' });
      } catch {}
    }
  }
  return out;
}

const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome`, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const cfg of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/proto/render/render.html`);
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate((c) => window.play(c), cfg);
    await new Promise((r) => setTimeout(r, 3000)); // loading settles
    const a = threads();
    const ta = Date.now();
    const b0 = await page.evaluate(() => window.__bench());
    await new Promise((r) => setTimeout(r, secs * 1000));
    const b1 = await page.evaluate(() => window.__bench());
    const b = threads();
    const wall = (Date.now() - ta) / 1000;
    const rows = [];
    for (const [k, v] of b) {
      const d = (v.cpu - (a.get(k)?.cpu ?? v.cpu)) / HZ;
      if (d > 0.05) rows.push([v.type, v.name, d / wall]);
    }
    rows.sort((x, y) => y[2] - x[2]);
    const main = (b1.tickMs - b0.tickMs) / 1000 / wall;
    console.log(`${cfg.name}: ${wall.toFixed(0)} s live, ${b1.notes - b0.notes} notes (${b1.dropped} dropped); scheduler on the main thread ${(100 * main).toFixed(2)}% (max tick ${b1.maxTick.toFixed(1)} ms)`);
    for (const [type, name, u] of rows.slice(0, 6)) console.log(`  ${type.padEnd(8)} ${name.padEnd(24)} ${(100 * u).toFixed(1)}% of a core`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
