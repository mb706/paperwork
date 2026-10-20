// SFX loops as the game will play them: decode the shipped Opus in Chrome, check the decoded audio is
// sample-aligned with the source WAV (encoder pre-skip handled), then loop it three times with
// loopStart/loopEnd and measure the jump at each seam against the loop's own sample-to-sample steps.
//   node design/audio/proto/render/looptest.mjs
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.local/lib/node_modules/playwright`);
const audioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(audioRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(audioRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = p.endsWith('demos') ? 200 : 404; res.end(); return; }
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome` });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/proto/render/render.html`);
for (const name of ['belt_loop', 'keypunch_loop']) {
  const r = await page.evaluate(async (name) => {
    const ctx = new OfflineAudioContext(1, 48000 * 16, 48000);
    const dec = await ctx.decodeAudioData(await (await fetch(`/demos/sfx/${name}.ogg`)).arrayBuffer());
    const wavBuf = await (await fetch(`/out/sfx/${name}.wav`)).arrayBuffer();
    const ref = await ctx.decodeAudioData(wavBuf);
    const a = dec.getChannelData(0), b = ref.getChannelData(0);
    // alignment: best lag in -2000..2000 samples by correlation over the first second
    let best = 0, bestC = -Infinity;
    for (let lag = -2000; lag <= 2000; lag += 1) {
      let c = 0;
      for (let i = 4000; i < 52000; i += 7) { const j = i + lag; if (j >= 0 && j < a.length) c += a[j] * b[i]; }
      if (c > bestC) { bestC = c; best = lag; }
    }
    // loop it: three periods
    const src = ctx.createBufferSource();
    src.buffer = dec; src.loop = true; src.loopStart = 0; src.loopEnd = ref.duration;
    src.connect(ctx.destination); src.start(0); src.stop(ref.duration * 3);
    const out = (await ctx.startRendering()).getChannelData(0);
    const L = Math.round(ref.duration * 48000);
    const steps = [];
    for (let i = 1; i < L * 3; i++) steps.push(Math.abs(out[i] - out[i - 1]));
    const sorted = steps.slice().sort((x, y) => x - y);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const seams = [L, 2 * L].map((s) => Math.max(...[-1, 0, 1].map((d) => Math.abs(out[s + d] - out[s + d - 1]))));
    return { decodedLen: a.length, sourceLen: b.length, lag: best, p99: +p99.toFixed(5), seams: seams.map((x) => +x.toFixed(5)) };
  }, name);
  console.log(name, JSON.stringify(r), r.lag === 0 && Math.max(...r.seams) <= r.p99 ? 'OK: aligned, seamless' : 'CHECK');
}
await browser.close();
server.close();
