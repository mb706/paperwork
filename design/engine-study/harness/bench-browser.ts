// Playwright driver: node harness/bench-browser.ts <chrome|firefox> <out.jsonl> <impl,..> <scale,..> <regime,..> [reps] [extra query string]
// One fresh page (and therefore one fresh Worker) per run. Appends one JSON line per run.
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: the global Playwright install has no type declarations here
import { chromium, firefox } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
import { cpuDelta, cpuSnap } from './cpu.ts';
import { serve } from './serve.ts';

const here = dirname(fileURLToPath(import.meta.url));
const [which = 'chrome', out = 'results/browser.jsonl', impls = 'ts', scales = 'mid', regimes = 'busy', reps = '1', extra = ''] = process.argv.slice(2);
const { server, port } = await serve(resolve(here, '../target/web'));

const browser =
  which === 'chrome'
    ? await chromium.launch({
        executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome`,
        args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
      })
    : await firefox.launch();
const version = browser.version();
console.error(`${which} ${version} on port ${port}`);

for (let rep = 0; rep < Number(reps); rep++) {
  for (const scale of scales.split(',')) {
    for (const regime of regimes.split(',')) {
      for (const impl of impls.split(',')) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('console', (m: { type(): string; text(): string }) => {
          if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
        });
        page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
        const url = `http://127.0.0.1:${port}/?impl=${impl}&scale=${scale}&regime=${regime}${extra ? `&${extra}` : ''}`;
        const t0 = Date.now();
        const startedAt = t0;
        const c0 = cpuSnap();
        await page.goto(url);
        await page.waitForFunction(() => (window as unknown as { __result?: unknown }).__result, null, { timeout: 30 * 60 * 1000, polling: 500 });
        const result = await page.evaluate(() => (window as unknown as { __result: unknown }).__result);
        let queries = null;
        if (!(result as { error?: string }).error && /queries=1/.test(extra)) {
          queries = await page.evaluate(() => (window as unknown as { __queryLatency: () => Promise<unknown> }).__queryLatency());
        }
        const line = { platform: which, browserVersion: version, rep, startedAt, endedAt: Date.now(), wallMs: Date.now() - t0, load: cpuDelta(c0, cpuSnap()), consoleErrors: errors, ...(result as object), queries };
        appendFileSync(out, `${JSON.stringify(line)}\n`);
        const r = line as unknown as { tick?: { mean: number; p99: number }; hash?: string; error?: string };
        console.error(`${which} ${impl} ${scale}/${regime} rep${rep}: ${r.error ?? `mean ${r.tick?.mean.toFixed(3)} p99 ${r.tick?.p99.toFixed(3)} hash ${r.hash}`} errors=${errors.length}`);
        await ctx.close();
      }
    }
  }
}
await browser.close();
server.close();
