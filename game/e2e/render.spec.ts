// The renderer in Chrome (SwiftShader WebGL2), on the gallery (src/dev/gallery.html) and the fake sim (C4, 10 §10.5).
//   @smoke   the golden packets with the tiny atlas at 1× and 0.3×, dpr 1 and 2, and pixel-exact placement
//   @render  the Survey atlas (needs `npm run assets`; without it these fail, never skip: the M0 exit audit #4, C9):
//            the preview scene by day and at night, the fake sim's factory, format fallbacks, context loss, the
//            debug overlays; the preview scene at 1× is @smoke at both device pixel ratios (and at night at 1)
//   @bench   the main thread's frame cost on SwiftShader against 10 §6.12 × the host factor 2.4
// Firefox here has no WebGL2 (playwright.config.ts): the renderer's tests run in Chrome; the fake spec covers the
// render=none path in both. Screenshots go to test-results/dev/ and are reviewed by eye (pm/reports/C4.md).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { rgba8Levels } from '../src/assets/worker/ktx2.ts';
import { watchConsole } from './console.ts';

const GAME = join(import.meta.dirname, '..');
const REAL = existsSync(join(GAME, 'public', 'atlases', 'sprites.json'));

test.skip(({ browserName }) => browserName !== 'chromium', 'headless Firefox here has no WebGL2');

// The dev server builds the simulation's WebAssembly at start-up and then reloads every open page (10 §2.3): wait
// for that (the placeholder page shows the module's ABI once it is built) before the first scene.
test.beforeAll(async ({ browser, browserName }) => {
  if (browserName !== 'chromium') return;
  const page = await browser.newPage();
  await page.goto('/?test=1&render=none');
  await expect(page.getByTestId('sim-status')).toHaveText(/^sim\.wasm ABI/, { timeout: 120_000 });
  await page.waitForTimeout(500);
  await page.close();
});

/**
 * Opens a gallery scene and waits until it is final (pages, level 0 where wanted, shore textures). The dev server's
 * cargo plugin reloads every page once its start-up build finishes (10 §2.3), which can land mid-test: then the
 * scene is opened again.
 */
async function gallery(page: Page, query: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`/src/dev/gallery.html?clean=1&${query}`);
      await page.waitForFunction(
        () => (window as unknown as { __gallery?: unknown }).__gallery !== undefined,
      );
      const err = await page.evaluate(async () => {
        const g = (window as unknown as { __gallery: { ready: Promise<void>; error?: string } }).__gallery;
        await g.ready;
        return g.error ?? null;
      });
      expect(err).toBeNull();
      return;
    } catch (e) {
      const reloaded = /Execution context was destroyed|ERR_ABORTED|frame was detached/.test(String(e));
      if (attempt >= 2 || !reloaded) throw e;
    }
  }
}

async function shot(page: Page, path: string): Promise<PNG> {
  return PNG.sync.read(await page.screenshot({ path }));
}

function px(png: PNG, x: number, y: number): [number, number, number] {
  const o = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[o] as number, png.data[o + 1] as number, png.data[o + 2] as number];
}

const near = (a: readonly number[], b: readonly number[], tol: number) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) <= tol);
const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

test.describe('the golden packets with the tiny atlas @smoke', () => {
  for (const [zoom, dpr] of [
    [1, 1],
    [0.3, 1],
    [1, 2],
    [0.3, 2],
  ] as const)
    test(`at ${zoom}×, dpr ${dpr}`, async ({ browser }, info) => {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const problems = watchConsole(page);
      await gallery(page, `scene=golden&zoom=${zoom}`);
      const png = await shot(page, info.outputPath(`golden-z${zoom}-dpr${dpr}.png`));
      expect(png.width).toBe(960 * dpr);
      // the grass wash of the golden world's open ground (the fixture atlas has no materials: a flat wash)
      expect(near(px(png, 10 * dpr, 10 * dpr), hex('#e2e6c6'), 6)).toBe(true);
      // the map's east edge at x = 48 tiles (camera x 40): out of map east of it, an inked kerb on it
      const edge = 480 * dpr + 8 * 32 * zoom * dpr;
      expect(near(px(png, edge + 6 * dpr, 30 * dpr), px(png, 10 * dpr, 30 * dpr), 6)).toBe(false);
      const stats = await page.evaluate(() =>
        (window as unknown as { __render: { stats(): unknown } }).__render.stats(),
      );
      expect(stats).toMatchObject({ frame: { greyboxed: 0 }, mirror: { chunks: 12, tick: 600 } });
      expect(problems).toEqual([]);
      await ctx.close();
    });

  // even and odd backing sizes (C4-r1 11)
  for (const [W, H, dpr] of [
    [400, 300, 1],
    [400, 300, 2],
    [401, 301, 1],
    [401, 301, 2],
  ] as const)
    test(`places a sprite pixel-exactly where 10 §15.7 puts it (k = 1, ${W} × ${H}, dpr ${dpr})`, async ({
      browser,
    }, info) => {
      // one tiny-atlas chest at tile (0, 0); zoom so that k = S ÷ P = 1 (the fixture's colour array is 8 px per tile)
      const zoom = 8 / 32 / dpr;
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const problems = watchConsole(page);
      await gallery(page, `scene=single&zoom=${zoom}&x=0.5&y=0.5`);
      const png = await shot(page, info.outputPath(`single-${W}x${H}-dpr${dpr}.png`));
      const m = JSON.parse(readFileSync(join(GAME, 'test', 'fixtures', 'sprites', 'manifest.json'), 'utf8'));
      const f = m.sets['entity/iron-chest'].parts.base.table[0][0] as number;
      const [, , x, y, w, h, ax, ay] = m.frames[f] as number[];
      const page0 = rgba8Levels(
        new Uint8Array(readFileSync(join(GAME, 'test', 'fixtures', 'sprites', 'colour-core-0.h.ktx2'))),
        0,
      )[0];
      // the anchor sits at the canvas centre (whole device px): the frame's texel (i, j) is device pixel (cx − ax + i, cy − ay + j)
      const cx = Math.floor(Math.round(W * dpr) / 2);
      const cy = Math.floor(Math.round(H * dpr) / 2);
      let opaque = 0;
      for (let j = 0; j < (h as number); j++)
        for (let i = 0; i < (w as number); i++) {
          const o = (((y as number) + j) * 512 + (x as number) + i) * 4;
          if (page0?.data[o + 3] !== 255) continue;
          const want = [page0.data[o] as number, page0.data[o + 1] as number, page0.data[o + 2] as number];
          // positions exact; values within 1 (the compositor's readback rounds), so a one-pixel shift still fails
          const got = px(png, cx - (ax as number) + i, cy - (ay as number) + j);
          expect(near(got, want, 1), `texel ${i}, ${j}: ${got} vs ${want}`).toBe(true);
          opaque++;
        }
      expect(opaque).toBeGreaterThan(20);
      expect(problems).toEqual([]);
      await ctx.close();
    });
});

test.describe('the Survey atlas @render', () => {
  test.beforeEach(() => {
    if (!REAL)
      throw new Error('public/atlases is missing: run `npm run assets` (the art is part of the acceptance)');
  });

  // the 1× day and night pictures are the M0 smoke screenshots (10 §12 exit): Survey's look, reviewed by eye
  for (const [zoom, dpr, night] of [
    [1, 1, false],
    [0.3, 1, false],
    [1, 2, false],
    [1, 1, true],
    [0.3, 1, true],
  ] as const)
    test(`the preview scene at ${zoom}×, dpr ${dpr}${night ? ', at night' : ''}${zoom === 1 && (dpr === 1 || !night) ? ' @smoke' : ''}`, async ({
      browser,
    }, info) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
      });
      const page = await ctx.newPage();
      const problems = watchConsole(page);
      await gallery(page, `scene=survey&zoom=${zoom}${night ? '&night=1' : ''}`);
      const png = await shot(page, info.outputPath(`survey-z${zoom}-dpr${dpr}${night ? '-night' : ''}.png`));
      const ground = px(png, 40 * dpr, 680 * dpr);
      if (!night) {
        // the grass wash on buff paper (A3 §3.1): light, warm, never white
        expect(ground[0]).toBeGreaterThan(200);
        expect(ground[0]).toBeLessThan(250);
      } else {
        // the cyanotype: Prussian blue paper
        expect(ground[2]).toBeGreaterThan(ground[0] + 30);
        expect(ground[0]).toBeLessThan(90);
      }
      const s = await page.evaluate(() =>
        (window as unknown as { __render: { stats(): { frame: { greyboxed: number } } } }).__render.stats(),
      );
      expect(s.frame.greyboxed).toBe(0);
      expect(problems).toEqual([]);
      await ctx.close();
    });

  test('the lit keypunch stains warm by day and reveals its colours at night', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await gallery(page, 'scene=survey&night=1');
    // the working keypunch's firebox (x2 14, y2 −8 → (7, −4) tiles; camera (0.5, −0.5)): warm light at night
    const lit = PNG.sync.read(await page.screenshot());
    let warm = 0;
    for (let y = 200; y < 260; y++)
      for (let x = 800; x < 860; x++) {
        const [r, , b] = px(lit, x, y);
        if (r > b + 40) warm++;
      }
    expect(warm).toBeGreaterThan(20);
    // the idle one beside it stays a cyanotype
    let cold = 0;
    for (let y = 200; y < 260; y++)
      for (let x = 900; x < 960; x++) {
        const [r, , b] = px(lit, x, y);
        if (r > b + 40) cold++;
      }
    expect(cold).toBe(0);
    await ctx.close();
  });

  test('the fake sim factory at 1× and 0.3×, animated', async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await page.goto('/?sim=fake');
    await page.waitForFunction(() => (window as unknown as { __render?: unknown }).__render !== undefined);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('main')) (el as HTMLElement).style.display = 'none';
    });
    type R = {
      __render: {
        settled(): Promise<void>;
        camera(x: number, y: number, z?: number): void;
        stats(): { frame: { frame: number; greyboxed: number; sprites: number } };
      };
    };
    for (const zoom of [1, 0.3]) {
      await page.evaluate((z) => (window as unknown as R).__render.camera(14, 0, z), zoom);
      await page.waitForTimeout(500);
      await page.evaluate(() => (window as unknown as R).__render.settled());
      await page.screenshot({ path: info.outputPath(`fake-z${zoom}.png`) });
    }
    // continuous rendering: frames advance, and the factory moves between two screenshots
    const a = await page.evaluate(() => (window as unknown as R).__render.stats().frame);
    await page.evaluate(() => (window as unknown as R).__render.camera(14, 0, 1));
    await page.waitForTimeout(400);
    const one = PNG.sync.read(await page.screenshot());
    await page.waitForTimeout(700);
    const two = PNG.sync.read(await page.screenshot());
    const b = await page.evaluate(() => (window as unknown as R).__render.stats().frame);
    expect(b.frame).toBeGreaterThan(a.frame);
    expect(b.sprites).toBeGreaterThan(100);
    const diff = pixelmatch(one.data, two.data, undefined, one.width, one.height, { threshold: 0.1 });
    expect(diff).toBeGreaterThan(50);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('every format fallback draws the same scene (BC3 + R8, then RGBA8)', async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    const shots: PNG[] = [];
    for (const deny of ['', 'bc7,astc,bc4', 'bc7,astc,bc3,etc2,bc4,eac_r11']) {
      await gallery(page, `scene=survey${deny ? `&deny=${deny}` : ''}`);
      const st = await page.evaluate(
        () =>
          (
            window as unknown as { __render: { stats(): { probe: { colour: string; shadow: string } } } }
          ).__render.stats().probe,
      );
      if (deny === 'bc7,astc,bc4') expect(st).toMatchObject({ colour: 'bc3', shadow: 'r8' });
      if (deny.includes('etc2')) expect(st).toMatchObject({ colour: 'rgba8', shadow: 'r8' });
      shots.push(await shot(page, info.outputPath(`fallback-${deny || 'bc7'}.png`)));
    }
    const [bc7, bc3, rgba] = shots as [PNG, PNG, PNG];
    const n = bc7.width * bc7.height;
    // RGBA8 decodes the same BC7-encoded content (§9.2: "RGBA8, the same decoded blocks"); BC3 is coarser
    expect(
      pixelmatch(bc7.data, rgba.data, undefined, bc7.width, bc7.height, { threshold: 0.05 }) / n,
    ).toBeLessThan(0.002);
    expect(
      pixelmatch(bc7.data, bc3.data, undefined, bc7.width, bc7.height, { threshold: 0.2 }) / n,
    ).toBeLessThan(0.02);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('a lost context comes back: restored, or after 5 s on a new canvas', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await gallery(page, 'scene=survey');
    const before = PNG.sync.read(await page.screenshot());
    type R = {
      __render: {
        loseContext(ms?: number): Promise<void>;
        settled(): Promise<void>;
        frame(): void;
        renderer: { lost: boolean; canvas: HTMLCanvasElement };
      };
    };
    await page.evaluate(() => (window as unknown as R).__render.loseContext(200));
    await page.waitForFunction(() => !(window as unknown as R).__render.renderer.lost);
    await page.evaluate(() => (window as unknown as R).__render.settled());
    const after = PNG.sync.read(await page.screenshot());
    expect(
      pixelmatch(before.data, after.data, undefined, before.width, before.height, { threshold: 0.02 }),
    ).toBe(0);
    // no restore: after 5 s the renderer takes a new canvas and context and draws the same picture again
    await page.evaluate(() => {
      const r = (window as unknown as R).__render.renderer as unknown as { gl: WebGL2RenderingContext };
      r.gl.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await page.waitForFunction(() => !(window as unknown as R).__render.renderer.lost, null, {
      timeout: 15_000,
    });
    await page.evaluate(() => (window as unknown as R).__render.settled());
    const again = PNG.sync.read(await page.screenshot());
    expect(
      pixelmatch(before.data, again.data, undefined, before.width, before.height, { threshold: 0.02 }),
    ).toBe(0);
    expect(await page.locator('canvas[data-testid=world]').count()).toBe(1);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('F4 cycles the debug overlays and F5 shows the timings HUD (I §4.21)', async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await gallery(page, 'scene=survey');
    const plain = PNG.sync.read(await page.screenshot());
    await page.keyboard.press('F4');
    await page.keyboard.press('F4');
    await page.keyboard.press('F5');
    await page.evaluate(() => (window as unknown as { __render: { frame(): void } }).__render.frame());
    await page.waitForTimeout(100);
    const debug = PNG.sync.read(await page.screenshot({ path: info.outputPath('debug-overlays.png') }));
    expect(
      pixelmatch(plain.data, debug.data, undefined, plain.width, plain.height, { threshold: 0.1 }),
    ).toBeGreaterThan(500);
    await expect(page.locator('pre')).toContainText('sprites');
    expect(problems).toEqual([]);
    await ctx.close();
  });
});

// ------------------------------------------------------------------ codex C4-r1 (pm/reviews/C4-r1.md), in the browser

type World = {
  __render: {
    world: {
      camera: {
        cx: number;
        cy: number;
        toScreen(x: number, y: number): { x: number; y: number };
        toWorld(x: number, y: number): { x: number; y: number };
      };
      pickAt(x: number, y: number): { kind: string; serial?: number; tx?: number; ty?: number } | null;
      active(): boolean;
    };
    ready(): Promise<void>;
    settled(): Promise<void>;
  };
};

test.describe('C4-r1 11: odd backing heights', () => {
  test.skip(!REAL, 'public/atlases is missing: run `npm run assets`');
  for (const night of [false, true])
    test(`shadows and lights stay on their sprites at an odd height${night ? ', at night' : ''}`, async ({
      browser,
    }, info) => {
      // the same scene at 540 and 541 px: the centre row (270) is the same, so the top 540 rows must be too; the
      // half-resolution shadow mask and light target were one device pixel off at an odd height
      const shots: PNG[] = [];
      for (const height of [540, 541]) {
        const ctx = await browser.newContext({ viewport: { width: 960, height } });
        const page = await ctx.newPage();
        const problems = watchConsole(page);
        await gallery(page, `scene=survey${night ? '&night=1' : ''}`);
        shots.push(
          PNG.sync.read(
            await page.screenshot({
              clip: { x: 0, y: 0, width: 960, height: 540 },
              path: info.outputPath(`odd-${height}${night ? '-night' : ''}.png`),
            }),
          ),
        );
        expect(problems).toEqual([]);
        await ctx.close();
      }
      const [a, b] = shots as [PNG, PNG];
      const diff = pixelmatch(a.data, b.data, undefined, 960, 540, { threshold: 0.1 });
      expect(diff).toBeLessThan(20);
    });
});

test.describe('C4-r1 12: the world view the UI attaches to', () => {
  for (const dpr of [1, 2])
    test(`picks what it draws, through the camera it drew with (dpr ${dpr})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 641, height: 361 }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const problems = watchConsole(page);
      // one iron chest (serial 2) on tile (0, 0)
      await gallery(page, 'scene=single');
      const r = await page.evaluate(() => {
        const w = (window as unknown as World).__render.world;
        const at = w.camera.toScreen(0.5, 0.5);
        const back = w.camera.toWorld(at.x, at.y);
        const s = w.camera.toScreen(3.5, 2.5);
        return {
          active: w.active(),
          back,
          chest: w.pickAt(at.x, at.y),
          tile: w.pickAt(s.x, s.y),
          outside: w.pickAt(-100000, -100000),
        };
      });
      expect(r.active).toBe(true);
      expect(r.back.x).toBeCloseTo(0.5, 6);
      expect(r.back.y).toBeCloseTo(0.5, 6);
      expect(r.chest).toMatchObject({ kind: 'entity', serial: 2 });
      expect(r.tile).toMatchObject({ kind: 'tile', tx: 3, ty: 2 });
      expect(r.outside).toBeNull();
      expect(problems).toEqual([]);
      await ctx.close();
    });
});

test.describe('C4-r1 4: readiness', () => {
  test.skip(!REAL, 'public/atlases is missing: run `npm run assets`');
  test('an optional file that never arrives holds neither the first frame nor a settled picture', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    // every High level 0 answers 404: at 2× the frames ask for them (k > 0.5)
    await page.route(/\.h\.[0-9a-f]+\.ktx2$|\.h\.ktx2$/, (route) => route.fulfill({ status: 404, body: '' }));
    await gallery(page, 'scene=survey&zoom=2');
    const t0 = Date.now();
    await page.evaluate(() => (window as unknown as World).__render.ready());
    await page.evaluate(() => (window as unknown as World).__render.settled());
    expect(Date.now() - t0).toBeLessThan(5000);
    await ctx.close();
  });

  test('a core file that fails four times shows the error, and Retry recovers', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const fail = /shadow-core-[^/]*\.ktx2$/;
    await page.route(fail, (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/src/dev/gallery.html?clean=1&scene=survey');
    // 1, 2 and 4 s between the attempts: the fourth failure comes after about 7 s
    await expect(page.getByTestId('art-error')).toBeVisible({ timeout: 20_000 });
    const rejected = await page.evaluate(() =>
      (window as unknown as World).__render.ready().then(
        () => false,
        () => true,
      ),
    );
    expect(rejected).toBe(true);
    await page.unroute(fail);
    await page.getByTestId('art-error').getByRole('button', { name: 'Retry' }).click();
    await page.evaluate(() => (window as unknown as World).__render.ready());
    await expect(page.getByTestId('art-error')).toHaveCount(0);
    await ctx.close();
  });
});
