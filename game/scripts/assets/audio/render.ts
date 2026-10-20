// Offline renders through the game's own audio engine in headless Chrome (10 §9.4; A4 §6.3): the dev page
// src/dev/audio.html served by a plugin-free Vite server, driven through `window.__audioDev`.
//
//   node scripts/assets/audio/render.ts <configs.json> [--out DIR]        (from game/)
//   node scripts/assets/audio/render.ts --checks                          decode and loop-seam checks
//
// A config is the dev page's RenderConfig plus `name`: {"name": "era1", "piece": "era1", "duration": 140,
// "params": {"seed": 1945}, "activity": 0.6, "sampleRate": 48000, "stems": true}. Writes <name>.wav (float)
// and <name>.notes.json to --out (default .cache/assets/audio/renders) and prints the render's numbers.
// Heavy: pin it (`taskset -c 8-15,24-31`; benchmarks use socket 0, `taskset -c 0-7`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

export const GAME = resolve(import.meta.dirname, '../../..');

/** The dev page's hooks as the tools see them (src/dev/audio.ts; this config has no DOM lib). */
export interface AudioDev {
  render(cfg: unknown): Promise<{
    seconds: number;
    sampleRate: number;
    ms: number;
    decodeMs: number;
    perSecondMs: number[];
    notes: number;
    dropped: number;
    stems: string[];
    peak: number;
    denormals: number;
    nonFinite: number;
    errors: string[];
  }>;
  decodeCheck(
    codec: string,
  ): Promise<{ file: string; len: number; decoded: number; offset: number; ok: boolean }[]>;
  loopTest(codec: string): Promise<Record<string, unknown>[]>;
  play(cfg: unknown): Promise<{ sampleRate: number; baseLatency: number }>;
  liveStats(): Promise<{
    scheduler: { ticks: number; ms: number; maxMs: number };
    dropped: number;
    bank: Record<string, number>;
    audioTime: number;
  } | null>;
  stop(): Promise<void>;
}
/** The page's hooks, inside page.evaluate. */
export const dev = (): AudioDev => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev;

export async function devServer(): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    configFile: false,
    root: GAME,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null, hmr: false },
    worker: { format: 'es' },
    // only the dev page: no scan of the game's entries (they import the cargo plugin's virtual modules)
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  return { server, url: `http://127.0.0.1:${addr.port}/src/dev/audio.html` };
}

export async function openPage(
  url: string,
  args: string[] = [],
): Promise<{ page: Page; close: () => Promise<void>; errors: string[] }> {
  const browser = await chromium.launch({
    executablePath: `${homedir()}/.local/opt/chrome-current/chrome`,
    args: ['--autoplay-policy=no-user-gesture-required', ...args],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(
    () => typeof (globalThis as unknown as { __audioDev?: unknown }).__audioDev === 'object',
  );
  return { page, close: () => browser.close(), errors };
}

/** Receives files from the page in base64 chunks (window.__save). */
export async function exposeSave(page: Page, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const parts = new Map<string, Buffer[]>();
  await page.exposeFunction('__save', (name: string, chunk: string, last: boolean) => {
    const list = parts.get(name) ?? [];
    list.push(Buffer.from(chunk, 'base64'));
    parts.set(name, list);
    if (last) {
      writeFileSync(join(dir, name.replace(/[^\w.-]/g, '_')), Buffer.concat(list));
      parts.delete(name);
    }
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? resolve(args[outIdx + 1] as string) : join(GAME, '.cache/assets/audio/renders');
  const { server, url } = await devServer();
  const { page, close, errors } = await openPage(url);
  try {
    await exposeSave(page, out);
    if (args.includes('--checks')) {
      for (const codec of ['ogg', 'm4a'] as const) {
        const rows = await page.evaluate(
          (c) => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.decodeCheck(c),
          codec,
        );
        const bad = rows.filter((r) => !r.ok);
        const offsets = [...new Set(rows.map((r) => r.offset))];
        const extra = [...new Set(rows.map((r) => r.decoded - r.len))];
        console.log(
          `decode ${codec}: ${rows.length} files, ${bad.length} failed; decoded − canonical: ${extra.join(', ')}; fingerprint offsets: ${offsets.join(', ')}`,
        );
        const loops = await page.evaluate(
          (c) => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.loopTest(c),
          codec,
        );
        for (const l of loops) console.log(`loop ${codec} ${JSON.stringify(l)}`);
      }
    }
    const cfgPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
    if (cfgPath) {
      const cfgs = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>[];
      for (const cfg of Array.isArray(cfgs) ? cfgs : [cfgs]) {
        const r = await page.evaluate(
          (c) => (globalThis as unknown as { __audioDev: AudioDev }).__audioDev.render(c),
          cfg,
        );
        const realtime = r.seconds / (r.ms / 1000);
        console.log(
          `${cfg.name}: ${r.notes} notes, ${r.seconds.toFixed(0)} s at ${r.sampleRate} Hz in ${(r.ms / 1000).toFixed(1)} s ` +
            `(${realtime.toFixed(1)}× real time; load ${((100 * r.ms) / 1000 / r.seconds).toFixed(2)} %, worst second ` +
            `${(Math.max(...r.perSecondMs) / 10).toFixed(2)} %), decode ${(r.decodeMs / 1000).toFixed(1)} s, peak ${r.peak.toFixed(3)}, ` +
            `dropped ${r.dropped}, denormals ${r.denormals}, non-finite ${r.nonFinite}${r.errors.length ? `, errors ${r.errors.join('; ')}` : ''}`,
        );
      }
    }
  } finally {
    if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
    await close();
    await server.close();
  }
}

if (import.meta.main) await main();
