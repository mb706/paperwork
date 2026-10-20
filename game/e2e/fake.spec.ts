// @smoke (10 §15.10): `?sim=fake` boots the fake sim in its worker on the dev server's fake prototype build,
// every packet it sends decodes on the main thread with the generated decoder, and every projection of M0's
// capability manifest arrives.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';

interface Status {
  tick: number;
  errors: string[];
  sections: string[];
  projections: string[];
  saves: { id: number; bytes: number; sha256: string }[];
}
type Fake = { step(n: number): void; save(): void; status(): Status };

test('the fake sim runs in its worker and its packets decode @smoke', async ({ page }) => {
  const problems = watchConsole(page);
  // The page draws the world since C4; this test is the fake sim's, so it runs without the renderer, which needs
  // `npm run assets` (e2e/render.spec.ts draws it) and WebGL2 (headless Firefox here has none).
  await page.goto('/?sim=fake&test=1&render=none');
  await expect(page.getByTestId('sim-status')).toHaveText(/^fake sim · tick 0 · /);
  await expect(page.getByTestId('data-status')).toHaveText(/^m1: /);
  await page.evaluate(() => (window as unknown as { __fake?: Fake }).__fake?.step(120));
  const status = () =>
    page.evaluate(() => (window as unknown as { __fake?: Fake }).__fake?.status() as Status);
  // The step's packet, and the targeted subscriptions (INVENTORY, ENTITY_PANEL, the hover) that follow the first
  // CHUNK_ENTITIES, arrive in either order.
  await expect.poll(async () => (await status()).tick).toBe(120);
  await expect
    .poll(async () => (await status()).projections)
    .toEqual(['CHARACTER', 'DEBUG', 'ENTITY_PANEL', 'HOVER', 'HUD', 'INVENTORY', 'STATS']);
  const s = await status();
  expect(s.errors).toEqual([]);
  expect(s.sections).toEqual(
    expect.arrayContaining([
      'AUDIO_WORKING',
      'BELT_GEOM',
      'BELT_ITEMS',
      'CHUNK_TILES',
      'DYN',
      'HANDS',
      'MOVERS',
      'UI',
    ]),
  );
  // A save completes with `saved` (the fake's own format, SHA-256 from the worker's crypto).
  await page.evaluate(() => (window as unknown as { __fake?: Fake }).__fake?.save());
  await expect.poll(async () => (await status()).saves.length).toBe(1);
  expect((await status()).saves[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(problems).toEqual([]);
});
