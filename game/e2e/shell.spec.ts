// @smoke: the worker shell in the browser (C3; 10 §3.1–§3.6, §8.2, §15.9): SimHost with real module workers in
// Chrome and Firefox, on the stub modules of test/stubs (posted as WebAssembly.Modules to every fresh worker):
// the handshake, test-mode steps through `__game`, the worldgen pool answering before the commit tick, a save in
// OPFS through the IO worker, a load into a fresh worker (a new generation), and a dev panic: the trap, the
// bundle, and the recovery from the last save.
import { expect, type Page, test } from '@playwright/test';
// The page's globals (`window.__shellDev`, `window.__game`): types only.
import type {} from '../src/dev/game-hooks.ts';
import type {} from '../src/dev/shell.ts';
import { stubGenBytes, stubSimBytes } from '../test/helpers/stubs.ts';
import { watchConsole } from './console.ts';

/**
 * The bench page, once the dev server has settled. A fresh server's generators (the data stage, schema-gen, cargo)
 * reload connected pages when their first runs end, and those can cascade for a few seconds: the page is loaded
 * again until it has stayed one full second without a reload (the build manifest waits for the generators).
 */
async function bench(page: Page): Promise<void> {
  let loads = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) loads += 1;
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    expect((await page.request.get('/data/build-manifest.json')).ok()).toBe(true);
    await page.goto('/src/dev/shell.html');
    const seen = loads;
    await page.waitForTimeout(1000);
    if (loads === seen) return;
  }
  throw new Error('the dev server kept reloading the page');
}

test('the worker shell: handshake, steps, the worldgen pool, a save, a load and a trap recovery @smoke', async ({
  page,
}) => {
  const problems = watchConsole(page);
  const sim = Buffer.from(stubSimBytes()).toString('base64');
  const gen = Buffer.from(stubGenBytes()).toString('base64');
  await bench(page);
  const started = await page.evaluate(
    ([s, g]) => window.__shellDev?.start(s as string, g as string),
    [sim, gen],
  );
  expect(started).toMatchObject({ gen: 1, tick: 0, store: 'opfs' });

  // The new world asked the pool for four chunks committing at tick 2 (the stub's requests); the world is paused
  // (test mode), so the answers arrive first and are supplied between ticks (§15.8 call order).
  await page.waitForFunction(
    () => (window.__shellDev?.logs ?? []).filter((l) => l.includes('supplied for tick 2')).length === 4,
  );
  // Test mode (§3.3): step(n) runs n ticks and answers with the tick after them.
  expect(await page.evaluate(() => window.__game?.step(60))).toBe(60);
  const logs = await page.evaluate(() => window.__shellDev?.logs ?? []);
  expect(logs.filter((l) => l.includes('supplied at tick 2'))).toHaveLength(4);
  expect(logs.filter((l) => l.includes('generated inline'))).toHaveLength(0);

  // A save through the IO worker, then a load into a fresh worker: generation 2, the same state.
  const hash = await page.evaluate(() => window.__game?.hash());
  expect(await page.evaluate(() => window.__game?.save('e2e'))).toMatchObject({ t: 'saved' });
  const bound = await page.evaluate(() => window.__shellDev?.host?.loadSave('e2e'));
  expect(bound).toMatchObject({ gen: 2, tick: 60 });
  expect(await page.evaluate(() => window.__game?.hash())).toBe(hash);

  // The last autosave is the closure log's base (§8.5) and what a trap recovers (§3.6, §12 M0 exit).
  expect(await page.evaluate(() => window.__game?.step(2))).toBe(62);
  expect(await page.evaluate(() => window.__game?.save())).toMatchObject({ t: 'saved' });
  expect(await page.evaluate(() => window.__game?.step(3))).toBe(65);

  // The dev panic: the next tick traps; the IO worker keeps the bundle (the autosave and the log up to the
  // trap) under reports/<report>/ in OPFS; the autosave comes back in a fresh worker.
  await page.evaluate(() => window.__game?.panic());
  await page.evaluate(() => {
    void window.__game?.step(1).catch(() => {});
  });
  await page.waitForFunction(() => (window.__shellDev?.generations.length ?? 0) >= 3);
  const trap = await page.evaluate(() => window.__shellDev?.traps[0]);
  expect(trap).toMatchObject({ tick: 66 });
  expect(trap?.message).toMatch(/dev panic requested by debug_dump at tick 66/);
  expect(trap?.report).toBeTruthy();
  const report = await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('reports')).getDirectoryHandle(name as string);
    const size = async (f: string) => (await (await dir.getFileHandle(f)).getFile()).size;
    const meta = JSON.parse(await (await (await dir.getFileHandle('report.json')).getFile()).text()) as {
      base: { name?: string };
    };
    return { save: await size('save.save'), log: await size('closures.pwlog'), base: meta.base.name };
  }, trap?.report);
  expect(report.save).toBeGreaterThan(0);
  expect(report.log).toBeGreaterThan(116);
  expect(report.base).toBe('_autosave1');
  expect(await page.evaluate(() => window.__game?.tick())).toBe(62);
  expect(await page.evaluate(() => window.__game?.step(1))).toBe(63);
  expect(problems).toEqual([]);
});

test('one tab at a time (§8.2): the second tab is read-only until it takes over @smoke', async ({
  context,
}) => {
  const sim = Buffer.from(stubSimBytes()).toString('base64');
  const gen = Buffer.from(stubGenBytes()).toString('base64');
  const tab = async () => {
    const page = await context.newPage();
    const problems = watchConsole(page);
    await bench(page);
    await page.evaluate(([s, g]) => window.__shellDev?.start(s as string, g as string), [sim, gen]);
    return { page, problems };
  };
  const a = await tab();
  await a.page.waitForFunction(() => window.__shellDev?.owner === true);
  expect(await a.page.evaluate(() => window.__game?.step(5))).toBe(5);
  const b = await tab();
  await b.page.waitForFunction(() => window.__shellDev?.owner === false);
  expect(await b.page.evaluate(() => window.__game?.save())).toMatchObject({ t: 'saveFailed' });
  // Take over (Web Locks and a BroadcastChannel between the two IO workers): tab A saves and drops to read-only.
  await b.page.evaluate(() => window.__game?.takeOver());
  await b.page.waitForFunction(() => window.__shellDev?.owner === true);
  await a.page.waitForFunction(() => window.__shellDev?.owner === false);
  const saves = await b.page.evaluate(async () => {
    const r = await window.__shellDev?.host?.listSaves();
    return (r ?? []).map((s) => [s.name, s.tick]);
  });
  expect(saves).toEqual([['_autosave1', 5]]);
  expect(await a.page.evaluate(() => window.__game?.save())).toMatchObject({ t: 'saveFailed' });
  expect(await b.page.evaluate(() => window.__game?.save())).toMatchObject({ t: 'saved' });
  expect(a.problems).toEqual([]);
  expect(b.problems).toEqual([]);
});
