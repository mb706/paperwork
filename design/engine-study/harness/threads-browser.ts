// Threads experiment driver: node harness/threads-browser.ts <chrome|firefox> <out.jsonl> [helpers=7] [iters=2000]
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: the global Playwright install has no type declarations here
import { chromium, firefox } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
import { cpuDelta, cpuSnap } from './cpu.ts';
import { serve } from './serve.ts';

const here = dirname(fileURLToPath(import.meta.url));
const [which = 'chrome', out = 'results/threads.jsonl', helpers = '7', iters = '2000'] = process.argv.slice(2);
const { server, port } = await serve(resolve(here, '../target/web'));
const browser =
  which === 'chrome' ? await chromium.launch({ executablePath: `${process.env.HOME}/.local/opt/chrome-current/chrome` }) : await firefox.launch();
const page = await (await browser.newContext()).newPage();
const errors: string[] = [];
page.on('console', (m: { type(): string; text(): string }) => {
  if (m.type() === 'error') errors.push(m.text());
});
const c0 = cpuSnap();
await page.goto(`http://127.0.0.1:${port}/threads.html?helpers=${helpers}&iters=${iters}`);
await page.waitForFunction(() => (window as unknown as { __result?: unknown }).__result, null, { timeout: 20 * 60 * 1000, polling: 500 });
const result = await page.evaluate(() => (window as unknown as { __result: unknown }).__result);
appendFileSync(out, `${JSON.stringify({ platform: which, browserVersion: browser.version(), load: cpuDelta(c0, cpuSnap()), consoleErrors: errors, ...(result as object) })}\n`);
console.error(`${which}: done, errors=${errors.length}`);
await browser.close();
server.close();
