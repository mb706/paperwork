// QC screenshots (Chrome for Testing via Playwright; SwiftShader WebGL2 here).
//
//   node game/scripts/assets/shoot.mjs <page> <out.png> [--dpr 1] [--size 1280x720] [--wait 300]
//
// Serves .cache/assets/qc/www/ (the QC pages) over game/public/ (the build's outputs) on an ephemeral 127.0.0.1
// port (the Playwright MCP blocks file://, and SVG <use> of an external sprite needs http), loads the page, waits
// for fonts, prints console errors, and saves the screenshot.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(join(homedir(), '.local/lib/node_modules/playwright/index.mjs'));
const ROOTS = [
  fileURLToPath(new URL('../../.cache/assets/qc/www/', import.meta.url)),
  fileURLToPath(new URL('../../public/', import.meta.url)),
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
};

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const [page, out] = args;
const dpr = Number(opt('dpr', '1'));
const [w, h] = opt('size', '1280x720').split('x').map(Number);
const wait = Number(opt('wait', '300'));

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  const file = ROOTS.map((r) => join(r, path)).find((f, i) => f.startsWith(ROOTS[i]) && existsSync(f));
  if (!file || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${port}/${page}`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(wait);
await p.screenshot({ path: out });
await browser.close();
server.close();
console.log(`[qc] ${out} (${w}x${h} at dpr ${dpr}); console errors: ${errors.length}`);
for (const e of errors) console.log(`[qc]   ${e}`);
if (errors.length) process.exitCode = 1;
