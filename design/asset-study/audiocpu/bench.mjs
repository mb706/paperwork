// B2 audio CPU study (10 §9.4): play A4's engine live in headless Chrome with variants applied and measure the
// CPU time of every renderer and audio-service thread from /proc, A/B-interleaved over rounds.
//   taskset -c 0-7 node design/asset-study/audiocpu/bench.mjs <configs.json> [seconds=30] [rounds=2]
// A config: {name, piece, pack, variant: {irMax, fdn, noXfade, voiceCap}, duration, params, automation, offset}
// or a voice microbenchmark: {name, voices: N, mode: 'native'|'worklet', pan}.
// Writes design/audio/out/cpu/<configs basename>.json (gitignored).
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.local/lib/node_modules/playwright`);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const audio = path.join(root, 'design/audio');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.opus': 'audio/ogg' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let p = null;
  if (u === '/') p = path.join(here, 'play.html');
  else if (u.startsWith('/audio/')) p = path.normalize(path.join(audio, u.slice(7)));
  else if (u.startsWith('/study/')) p = path.normalize(path.join(here, u.slice(7)));
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', TYPES[path.extname(p)] ?? 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const cfgPath = process.argv[2];
const secs = Number(process.argv[3] ?? 30);
const rounds = Number(process.argv[4] ?? 2);
const HZ = 100;

function threads() {
  const out = new Map();
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('chrome') || !(cmd.includes('--type=renderer') || cmd.includes('--type=utility'))) continue;
    const type = cmd.includes('--type=renderer') ? 'renderer' : (cmd.includes('audio') ? 'audiosvc' : 'utility');
    let tids;
    try { tids = fs.readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tids) {
      try {
        const st = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
        const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
        const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
        out.set(`${pid}/${tid}`, { name, type, cpu: Number(f[11]) + Number(f[12]) });
      } catch {}
    }
  }
  return out;
}
const mhz = () => {
  const lines = fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n').filter((l) => l.startsWith('cpu MHz'));
  const v = lines.slice(0, 8).map((l) => Number(l.split(':')[1]));
  return v.reduce((a, b) => a + b, 0) / v.length;
};
const isAudio = (t) => t.type === 'audiosvc' || /audio|worklet|convolv|reverb/i.test(t.name);

const cfgs = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const results = [];
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome`,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? cfgs : [...cfgs].reverse();
    const r0 = r;
    for (const cfg of order) {
      const page = await browser.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.ready === true);
      if (cfg.mode === 'offline') {
        const r = await page.evaluate((c) => window.offline(c), cfg);
        const res = { round: r0, name: cfg.name, offlineLoadPct: +(100 * r.load).toFixed(2), seconds: r.seconds, ms: Math.round(r.ms), errors: (r.errors ?? []).slice(0, 2) };
        results.push(res);
        console.log(`${cfg.name.padEnd(34)} r${r0} offline render load ${res.offlineLoadPct}% of a core (${res.seconds} s in ${res.ms} ms)`);
        await page.close();
        continue;
      }
      const info = await page.evaluate((c) => ('voices' in c ? window.voices(c) : window.play(c)), cfg);
      await new Promise((res) => setTimeout(res, 4000));
      const a = threads();
      const m0 = mhz();
      const ta = Date.now();
      const b0 = await page.evaluate(() => window.__bench());
      // one sample per second: the audio threads' share in every 1 s window
      const perSec = [];
      let prev = a, prevT = Date.now();
      for (let i = 0; i < secs; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const cur = threads();
        const now = Date.now();
        let s = 0;
        for (const [k, v] of cur) if (isAudio(v)) s += (v.cpu - (prev.get(k)?.cpu ?? v.cpu)) / HZ;
        perSec.push(s / ((now - prevT) / 1000));
        prev = cur; prevT = now;
      }
      const b1 = await page.evaluate(() => window.__bench());
      const b = threads();
      const m1 = mhz();
      const wall = (Date.now() - ta) / 1000;
      const rows = [];
      let audioSum = 0;
      for (const [k, v] of b) {
        const d = (v.cpu - (a.get(k)?.cpu ?? v.cpu)) / HZ / wall;
        if (d > 0.002) rows.push({ type: v.type, name: v.name, pct: +(100 * d).toFixed(2) });
        if (isAudio(v)) audioSum += d;
      }
      rows.sort((x, y) => y.pct - x.pct);
      const main = (b1.tickMs - b0.tickMs) / 1000 / wall;
      const sorted = [...perSec].sort((x, y) => x - y);
      const res = { round: r, name: cfg.name, wall: +wall.toFixed(1), audioPct: +(100 * audioSum).toFixed(2),
        perSecMaxPct: +(100 * sorted[sorted.length - 1]).toFixed(1), perSecP95Pct: +(100 * sorted[Math.floor(0.95 * (sorted.length - 1))]).toFixed(1),
        mainSchedPct: +(100 * main).toFixed(3), maxTickMs: +b1.maxTick.toFixed(1), notes: b1.notes - b0.notes,
        dropped: b1.dropped, voicesMax: b1.voicesMax, voicesMean: b1.voicesMean ? +b1.voicesMean.toFixed(1) : undefined,
        stolen: b1.stolen, decodedMB: info?.decodedMB ? +info.decodedMB.toFixed(1) : undefined, mhz: Math.round((m0 + m1) / 2),
        threads: rows.slice(0, 8), errors: errs.slice(0, 3) };
      results.push(res);
      console.log(`${cfg.name.padEnd(34)} r${r} audio ${res.audioPct.toFixed(1)}% (1-s max ${res.perSecMaxPct}%, p95 ${res.perSecP95Pct}%)  main ${res.mainSchedPct}% (max tick ${res.maxTickMs} ms) notes ${res.notes} voices max ${res.voicesMax ?? '-'} mean ${res.voicesMean ?? '-'} stolen ${res.stolen ?? 0} decoded ${res.decodedMB ?? '-'} MB  ${res.mhz} MHz`);
      console.log('    ' + rows.slice(0, 5).map((t) => `${t.type}:${t.name} ${t.pct}%`).join(' | ') + (errs.length ? '  ERR ' + errs[0] : ''));
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const outDir = path.join(audio, 'out/cpu');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, path.basename(cfgPath)), JSON.stringify(results, null, 1));
