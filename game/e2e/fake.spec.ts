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
}
type Fake = { step(n: number): void; status(): Status };

test('the fake sim runs in its worker and its packets decode @smoke', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/?sim=fake&test=1');
  await expect(page.getByTestId('sim-status')).toHaveText(/^fake sim · tick 0 · /);
  await expect(page.getByTestId('data-status')).toHaveText(/^m1: /);
  await page.evaluate(() => (window as unknown as { __fake?: Fake }).__fake?.step(120));
  const status = () =>
    page.evaluate(() => (window as unknown as { __fake?: Fake }).__fake?.status() as Status);
  // The targeted subscriptions (INVENTORY, ENTITY_PANEL, the hover) follow the first CHUNK_ENTITIES.
  await expect
    .poll(async () => (await status()).projections)
    .toEqual(['CHARACTER', 'DEBUG', 'ENTITY_PANEL', 'HOVER', 'HUD', 'INVENTORY', 'STATS']);
  const s = await status();
  expect(s.tick).toBe(120);
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
  expect(problems).toEqual([]);
});
