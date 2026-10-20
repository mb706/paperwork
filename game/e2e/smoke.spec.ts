// @smoke (10 §10.5): the dev page loads in the browser: the main menu over the world canvas, the data stage's
// outputs, and sim.wasm compiled on the main thread; New game → Play hands it to a fresh sim worker that binds a
// world of this build's ABI, and the game screen shows. The M0 flow through the UI (walk, craft, place, open, save,
// load) is e2e/game.spec.ts.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { SIM_STATUS } from './status.ts';
import { openPage, uiState } from './ui-helpers.ts';

test('the dev page loads its data and the simulation module @smoke', async ({ page }, info) => {
  const problems = watchConsole(page);
  const render = info.project.name === 'firefox' ? 'none' : 'on-demand';
  await openPage(page, `test=1&render=${render}`);
  await expect(page).toHaveTitle('Paperwork');
  await expect(page.getByTestId('data-status')).toHaveText(
    /^m0: 3 items, 1 recipe, 2 entities, 1 resource, 6 tiles$/, // the chest and the engine's character
  );
  await expect(page.getByTestId('build-status')).toHaveText(/^m0 \(dev\) · [0-9a-f]{12}$/);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText(SIM_STATUS);
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await page.screenshot({ path: info.outputPath('smoke.png') });
  expect(problems).toEqual([]);
});
