// @bench (C4, 10 §6.12, §10.6): the renderer's main-thread cost per frame on this host's SwiftShader, at §6.12's
// scenes (a 1920×1080 window), against its budgets × the host factor 2.4 (10 §11: this host runs at about 0.42× the
// reference machine). The GPU time cannot be measured here (SwiftShader is software); the frames are drawn on demand,
// one at a time, with the GPU drained between them (a 1×1 readPixels: finish() does not wait in Chrome here), so the
// numbers are the main thread's own work: the upload pump,
// the scene build (culling, sorting, programs, belt expansion), the vertex upload and the GL calls.
// Also checks that steady-state frames allocate nothing (the heap after a GC does not grow).
//   taskset -c 0-7 npx playwright test e2e/render-bench.spec.ts --project chrome
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const GAME = join(import.meta.dirname, '..');
const HOST_FACTOR = 2.4;

test.skip(({ browserName }) => browserName !== 'chromium', 'headless Firefox here has no WebGL2');
test.skip(!existsSync(join(GAME, 'public', 'atlases', 'sprites.json')), 'run `npm run assets` first');
test.use({
  viewport: { width: 1920, height: 1080 },
  launchOptions: {
    executablePath: `${homedir()}/.local/opt/chrome-current/chrome`,
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  },
});

// the dev server reloads every page after its start-up WebAssembly build (10 §2.3): wait for it first
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/?test=1&render=none');
  await expect(page.getByTestId('sim-status')).toHaveText(/^sim\.wasm ABI/, { timeout: 120_000 });
  await page.waitForTimeout(500);
  await page.close();
});

interface Row {
  scene: string;
  zoom: number;
  sprites: number;
  beltItems: number;
  median: number;
  p95: number;
  build: number;
  submit: number;
  budget: number;
  heapGrowthKb: number;
}

async function measure(page: Page, query: string, frames: number): Promise<Omit<Row, 'scene' | 'budget'>> {
  await page.goto(`/src/dev/gallery.html?clean=1&scene=bench&${query}`);
  await page.waitForFunction(() => (window as unknown as { __gallery?: unknown }).__gallery !== undefined);
  await page.evaluate(() => (window as unknown as { __gallery: { ready: Promise<void> } }).__gallery.ready);
  return page.evaluate((n) => {
    type R = {
      __render: {
        renderer: { frame(): boolean; gl: WebGL2RenderingContext | null; camera: { zoom: number } };
        stats(): {
          frame: { total: number; build: number; submit: number; sprites: number; beltItems: number };
        };
      };
      gc?: () => void;
    };
    const w = window as unknown as R;
    const r = w.__render.renderer;
    const gl = r.gl as WebGL2RenderingContext;
    const totals: number[] = [];
    const builds: number[] = [];
    const submits: number[] = [];
    // drain the GPU: Chrome's finish() returns at once here, and SwiftShader's backlog would otherwise stall the
    // next frame's uploads (GPU time leaking into the main thread's); a 1×1 readPixels waits for the frame
    const px = new Uint8Array(4);
    const drain = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // warm up: JIT, buffers at their size
    for (let i = 0; i < 20; i++) {
      r.frame();
      drain();
    }
    w.gc?.();
    const heap0 = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    for (let i = 0; i < n; i++) {
      r.frame();
      const s = w.__render.stats().frame;
      totals.push(s.total);
      builds.push(s.build);
      submits.push(s.submit);
      drain(); // so the next frame's main-thread time is its own
    }
    w.gc?.();
    const heap1 = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    const sorted = [...totals].sort((a, b) => a - b);
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
    const s = w.__render.stats().frame;
    return {
      zoom: r.camera.zoom,
      sprites: s.sprites,
      beltItems: s.beltItems,
      median: med(totals),
      p95: sorted[Math.floor(sorted.length * 0.95)] as number,
      build: med(builds),
      submit: med(submits),
      heapGrowthKb: (heap1 - heap0) / 1024,
    };
  }, frames);
}

test('main-thread frame cost at 10 §6.12 scenes @bench', async ({ page }, info) => {
  test.setTimeout(300_000);
  const scenes: [string, string, number][] = [
    // §6.12 row: default zoom 1×, slice base (~2k sprites + 2k belt items): main thread ≤ 4 ms
    ['1× slice base', 'zoom=1&entities=700&items=2000&w=60&h=34', 4],
    // default zoom 1×, mid base (~8k sprites + 10k belt items): ≤ 6 ms
    ['1× mid base', 'zoom=1&entities=2040&items=8160&w=60&h=34', 6],
    // furthest world zoom 0.3×, late base (~25k sprites + 60k belt items): ≤ 12 ms
    ['0.3× late base', 'zoom=0.3&entities=8000&items=60000&w=200&h=113', 12],
  ];
  const rows: Row[] = [];
  for (const [scene, query, budget] of scenes) {
    const m = await measure(page, query, 60);
    rows.push({ scene, budget, ...m });
  }
  const table = rows
    .map(
      (r) =>
        `${r.scene.padEnd(16)} sprites ${String(r.sprites).padStart(6)}  belt items ${String(r.beltItems).padStart(6)}  ` +
        `median ${r.median.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  (build ${r.build.toFixed(2)}, GL ${r.submit.toFixed(2)})  ` +
        `budget ${r.budget} × ${HOST_FACTOR} = ${(r.budget * HOST_FACTOR).toFixed(1)} ms  heap +${r.heapGrowthKb.toFixed(0)} kB`,
    )
    .join('\n');
  console.log(`\n${table}\n`);
  writeFileSync(info.outputPath('bench.json'), `${JSON.stringify(rows, null, 1)}\n`);
  for (const r of rows) {
    expect(r.median, r.scene).toBeLessThanOrEqual(r.budget * HOST_FACTOR);
    // no per-frame allocation in steady state: 60 frames leave the heap where they found it (one GC's noise)
    expect(r.heapGrowthKb, r.scene).toBeLessThan(256);
  }
});
