// @smoke (10 §10.5): the dev page loads in the browser, with the data stage's outputs and sim.wasm
// compiled on the main thread and instantiated in the sim worker. M0's full smoke (new game, walk, mine,
// craft, place, save, reload, hash) replaces it once the game exists.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';

test('the dev page loads its data and the simulation module @smoke', async ({ page }, info) => {
  const problems = watchConsole(page);
  const render = info.project.name === 'firefox' ? 'none' : 'on-demand';
  await page.goto(`/?test=1&render=${render}`);
  await expect(page).toHaveTitle('Paperwork');
  await expect(page.getByTestId('sim-status')).toHaveText(/^sim\.wasm ABI 0,/);
  await expect(page.getByTestId('data-status')).toHaveText(
    /^m0: 3 items, 1 recipe, 1 entity, 1 resource, 6 tiles$/,
  );
  await expect(page.getByTestId('build-status')).toHaveText(/^m0 \(dev\) · [0-9a-f]{12}$/);
  await page.screenshot({ path: info.outputPath('smoke.png') });
  expect(problems).toEqual([]);
});
