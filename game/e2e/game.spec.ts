// @smoke: M0 through the UI on the real sim (C5-r1; 10 §12's M0 flow): the main menu → New game → walk → the
// character screen → craft → place a chest → open it → save → load, the loaded world's state hash equal to the
// saved one's, and Continue from the main menu loading the same save again. Saves go through the IO worker (OPFS
// or IndexedDB) and are loadable (C5-r1 12). Chrome draws the world (C4's renderer, frames on demand in test
// mode); each step's screenshot lands in the test output. Firefox runs the same flow with `?render=none`.
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import {
  characterPos,
  type E2eGame,
  entities,
  openPage,
  screenOf,
  settled,
  step,
  uiState,
} from './ui-helpers.ts';

type W = { __game: E2eGame };
const CHEST_ITEM = 0;

const hash = (page: Page) => page.evaluate(() => (window as unknown as W).__game.hash());

test('the M0 flow: new game, walk, craft, place, open, save, load, continue @smoke', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  const chrome = info.project.name === 'chrome';
  const shot = async (name: string) => {
    if (!chrome) return;
    await page.evaluate(() => (window as unknown as W).__game.render?.frame());
    await settled(page);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
  };
  await openPage(page);
  await shot('01-main-menu');

  // New game: the world binds, the character joins in its first tick.
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  await shot('02-new-game');

  // Walk east and a little south for half a second.
  const start = (await characterPos(page)) as { x: number; y: number };
  await page.keyboard.down('d');
  await step(page, 30);
  await page.keyboard.up('d');
  await step(page, 1);
  const walked = (await characterPos(page)) as { x: number; y: number };
  expect(walked.x).toBeGreaterThan(start.x + 2);
  await shot('03-walked');

  // The character screen, and the iron chest crafted from the 8 starting plates.
  await page.keyboard.press('e');
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect(page.getByTestId('inv-0').locator('.count')).toHaveText('8');
  await shot('04-character-screen');
  await page.getByTestId('recipe-iron-chest').click();
  await step(page, 1);
  await expect(page.getByTestId('crafting-queue')).toBeVisible();
  await step(page, 31);
  await expect
    .poll(async () => (await uiState(page)).main.find((s) => s.key === CHEST_ITEM)?.count ?? 0)
    .toBe(1);
  await shot('05-crafted');

  // Into the hand, the window closed, the build preview two tiles east, then placed.
  const at = (await uiState(page)).main.findIndex((s) => s.key === CHEST_ITEM && s.count > 0);
  await page.getByTestId(`inv-${at}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const spot = { x: Math.floor(walked.x) + 2.5, y: Math.floor(walked.y) + 0.5 };
  const p = await screenOf(page, spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await shot('06-build-preview');
  await page.mouse.click(p.x, p.y);
  await step(page, 1);
  await expect.poll(async () => (await entities(page)).filter((e) => e.name === 'iron-chest').length).toBe(1);
  const chest = (await entities(page)).find((e) => e.name === 'iron-chest') as {
    serial: number;
    x: number;
    y: number;
  };
  expect([chest.x, chest.y]).toEqual([spot.x, spot.y]);
  await page.mouse.move(p.x + 2, p.y + 2);
  await step(page, 1);
  await expect(page.getByTestId('docked-info')).toBeVisible();
  await shot('07-placed');

  // Open it.
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('entity-window')).toBeVisible();
  expect((await uiState(page)).window).toBe(`entity:${chest.serial}`);
  await shot('08-chest-window');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('entity-window')).toHaveCount(0);

  // Save from the game menu: the dialog closes once the save is stored and checked.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('game-menu-save').click();
  await page.getByTestId('save-name').fill('m0-flow');
  await shot('09-save-dialog');
  await page.getByTestId('save-confirm').click();
  await expect(page.getByTestId('window-save-game')).toHaveCount(0);
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  const saved = await hash(page);
  const savedTick = await page.evaluate(() => (window as unknown as W).__game.tick());

  // Change the world, then load the save: the state hash is the saved one's again, the chest is back.
  await page.keyboard.down('s');
  await step(page, 40);
  await page.keyboard.up('s');
  await step(page, 1);
  expect(await hash(page)).not.toBe(saved);
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu-load').click();
  await expect(page.getByTestId('save-m0-flow')).toBeVisible();
  await shot('10-load-list');
  await page.getByTestId('save-m0-flow').click();
  await page.getByTestId('load-confirm').click();
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  expect(await hash(page)).toBe(saved);
  expect(await page.evaluate(() => (window as unknown as W).__game.tick())).toBe(savedTick);
  await expect.poll(async () => (await entities(page)).some((e) => e.serial === chest.serial)).toBe(true);
  await shot('11-loaded');

  // Exit to the main menu: Continue loads the newest save.
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu-exit').click();
  await page.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-continue')).toBeVisible();
  await shot('12-menu-continue');
  await page.getByTestId('menu-continue').click();
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  expect(await hash(page)).toBe(saved);
  expect(problems).toEqual([]);
});
