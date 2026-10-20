// @smoke (10 §15.10): a new game runs the fake sim in its worker on the dev server's fake prototype build, every
// packet decodes on the main thread with the generated decoder, the UI's subscriptions answer (CHARACTER, HUD),
// test mode steps ticks deterministically, and a save completes with `saved`.
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { startGame, uiState } from './ui-helpers.ts';

test('a new game runs on the fake sim and its packets reach the UI @smoke', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  const tick = () => page.evaluate(() => window.__game?.tick() ?? -1);
  expect(await tick()).toBe(0);
  await page.evaluate(() => window.__game?.step(120));
  await expect.poll(tick).toBe(120);
  const s = await uiState(page);
  expect(s.screen).toBe('game');
  expect(s.main.filter((x) => x.count > 0).length).toBeGreaterThan(3);
  expect(s.problems).toEqual([]);
  // Esc → the game menu → Save game: the fake's own format, acknowledged with `saved`.
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu-save').click();
  await expect(page.getByTestId('game-menu-save')).toHaveText('Saved');
  expect(problems).toEqual([]);
});
