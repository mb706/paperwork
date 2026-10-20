// @smoke (10 §10.5): the dev page loads in the browser: the main menu over the world canvas, the data stage's
// outputs, and sim.wasm compiled on the main thread and instantiated in a sim worker (the module probe). M0's full
// smoke (new game, walk, mine, craft, place, save, reload, hash) grows from e2e/ui.spec.ts once the sim runs worlds.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { openPage } from './ui-helpers.ts';

test('the dev page loads its data and the simulation module @smoke', async ({ page }, info) => {
  const problems = watchConsole(page);
  const render = info.project.name === 'firefox' ? 'none' : 'on-demand';
  await openPage(page, `test=1&render=${render}`);
  await expect(page).toHaveTitle('Paperwork');
  await expect(page.getByTestId('sim-status')).toHaveText(/^sim\.wasm ABI 0,/);
  await expect(page.getByTestId('data-status')).toHaveText(
    /^m0: 3 items, 1 recipe, 2 entities, 1 resource, 6 tiles$/, // the chest and the engine's character
  );
  await expect(page.getByTestId('build-status-probe')).toHaveText(/^m0 \(dev\) · [0-9a-f]{12}$/);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.screenshot({ path: info.outputPath('smoke.png') });
  expect(problems).toEqual([]);
});
