// @smoke: the worker shell in the browser (C3; 10 §3.1–§3.6, §8.2, §15.9): SimHost with real module workers in
// Chrome and Firefox, on the stub modules of test/stubs (posted as WebAssembly.Modules to every fresh worker):
// the handshake, test-mode steps through `__game`, the worldgen pool answering before the commit tick, a save in
// OPFS through the IO worker, a load into a fresh worker (a new generation), and a dev panic: the trap, the
// bundle, and the recovery from the last save.
import { expect, test } from '@playwright/test';
// The page's globals (`window.__shellDev`, `window.__game`): types only.
import type {} from '../src/dev/game-hooks.ts';
import type {} from '../src/dev/shell.ts';
import { stubGenBytes, stubSimBytes } from '../test/helpers/stubs.ts';
import { watchConsole } from './console.ts';

test('the worker shell: handshake, steps, the worldgen pool, a save, a load and a trap recovery @smoke', async ({
  page,
}) => {
  const problems = watchConsole(page);
  const sim = Buffer.from(stubSimBytes()).toString('base64');
  const gen = Buffer.from(stubGenBytes()).toString('base64');
  await page.goto('/src/dev/shell.html');
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
  // Test mode (§3.3): step(n) runs n ticks and answers with the packet that follows.
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

  // The dev panic (§12 M0 exit): the next tick traps; the bundle holds the save and the log up to the trap; the
  // last save comes back in a fresh worker.
  expect(await page.evaluate(() => window.__game?.step(5))).toBe(65);
  await page.evaluate(() => window.__game?.panic());
  await page.evaluate(() => {
    void window.__game?.step(1);
  });
  await page.waitForFunction(() => (window.__shellDev?.generations.length ?? 0) >= 3);
  const trap = await page.evaluate(() => {
    const t = window.__shellDev?.traps[0];
    return {
      tick: t?.tick,
      message: t?.message,
      saveName: t?.bundle?.saveName,
      hasSave: (t?.bundle?.save?.length ?? 0) > 0,
      log: t?.bundle?.log.length ?? 0,
    };
  });
  expect(trap).toMatchObject({ tick: 66, saveName: 'e2e', hasSave: true });
  expect(trap.message).toMatch(/dev panic requested by debug_dump at tick 66/);
  expect(trap.log).toBeGreaterThan(116);
  expect(await page.evaluate(() => window.__game?.tick())).toBe(60);
  expect(await page.evaluate(() => window.__game?.step(1))).toBe(61);
  expect(problems).toEqual([]);
});
