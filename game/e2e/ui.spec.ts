// The UI and input layer on the real sim (C5; 10 §7, §15.3, §15.5): Playwright drives the real input layer (keys
// and mouse through the browser), and each test checks the actions the encoder sent and what came back in the
// projections. Test mode stops the clock; `step(n)` runs ticks. M0's world: the character starts with 8 iron plates
// (one iron chest's recipe), an iron-ore patch nearby. Screenshots land in the test output (`test-results/dev/`).
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import {
  characterPos,
  type E2eGame,
  entities,
  lastSeq,
  openPage,
  screenOf,
  sentSince,
  startGame,
  step,
  uiState,
} from './ui-helpers.ts';

const MAIN = 1; // InventoryType.main
const CHEST = 2; // InventoryType.chest
const PLATE = 2 * 8; // iron-plate's key (id 2, normal quality)
const ORE = 1 * 8;
const CHEST_ITEM = 0;
type W = { __game: E2eGame };

const slot = (page: Page, testid: string) => page.getByTestId(testid);

/** Holds the movement keys toward (x, y) until the character is within `near` tiles (I §2.1: 8 directions). */
async function walkTo(page: Page, x: number, y: number, near = 1.5): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const c = await characterPos(page);
    if (!c) throw new Error('no character');
    const dx = x - c.x;
    const dy = y - c.y;
    if (Math.hypot(dx, dy) <= near) return;
    const keys = [
      ...(dx > 0.5 ? ['d'] : dx < -0.5 ? ['a'] : []),
      ...(dy > 0.5 ? ['s'] : dy < -0.5 ? ['w'] : []),
    ];
    for (const k of keys) await page.keyboard.down(k);
    await step(page, 4);
    for (const k of keys) await page.keyboard.up(k);
    await step(page, 1);
  }
  throw new Error(`could not walk to ${x}, ${y}`);
}

/** The ore tile nearest the character (the view model's resource tiles). */
async function nearestOre(page: Page): Promise<{ x: number; y: number }> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__game.ui.resources().length))
    .toBeGreaterThan(0);
  return page.evaluate(() => {
    const ui = (window as unknown as W).__game.ui;
    const c = ui.character() ?? { x: 0, y: 0 };
    const all = ui
      .resources()
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    return all[0] as { x: number; y: number };
  });
}

/** Crafts the iron chest from the 8 starting plates (0.5 s: 30 ticks) and closes the character screen. */
async function craftChest(page: Page): Promise<void> {
  await page.keyboard.press('e');
  await slot(page, 'recipe-iron-chest').click();
  await step(page, 32);
  await expect
    .poll(async () => (await uiState(page)).main.find((s) => s.key === CHEST_ITEM)?.count ?? 0)
    .toBe(1);
  await page.keyboard.press('e');
}

/** Takes the crafted chest into the hand and builds it at world (x, y); returns its serial. */
async function placeChest(page: Page, x: number, y: number): Promise<number> {
  await page.keyboard.press('e');
  const at = (await uiState(page)).main.findIndex((s) => s.key === CHEST_ITEM && s.count > 0);
  await slot(page, `inv-${at}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const p = await screenOf(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await step(page, 1);
  await expect.poll(async () => (await entities(page)).some((e) => e.name === 'iron-chest')).toBe(true);
  return (await entities(page)).find((e) => e.name === 'iron-chest')?.serial as number;
}

test('the main menu: wordmark, tagline, M0 entries, footer', async ({ page }, info) => {
  const problems = watchConsole(page);
  await openPage(page);
  await expect(page.getByTestId('wordmark')).toHaveText('Paperwork');
  await expect(page.locator('.tagline')).toHaveText('Information is physical.');
  await expect(page.getByTestId('menu-continue')).toHaveCount(0); // no save yet (07 §18)
  for (const id of ['menu-new-game', 'menu-load-game', 'menu-settings'])
    await expect(page.getByTestId(id)).toBeEnabled();
  for (const id of ['menu-tips', 'menu-credits', 'menu-changelog'])
    await expect(page.getByTestId(id)).toBeDisabled();
  await expect(page.getByTestId('menu-build')).toHaveText(/^build m0 \(dev\)/);
  await page.screenshot({ path: info.outputPath('main-menu.png') });
  // Esc backs out of a menu page (I §1.4); E presses the page's green button (Play).
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('window-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-buttons')).toBeVisible();
  await page.getByTestId('menu-new-game').click();
  await page.keyboard.press('e');
  await expect.poll(() => uiState(page).then((s) => s?.screen)).toBe('game');
  expect(problems).toEqual([]);
});

test('E opens the character screen on the CHARACTER projection; E closes it', async ({ page }, info) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  const screen = page.getByTestId('character-screen');
  await expect(screen).toBeVisible();
  await expect(page.locator('[data-testid=main-inventory] [data-slot]')).toHaveCount(80);
  await expect(slot(page, 'inv-0').locator('.count')).toHaveText('8');
  await expect(slot(page, 'inv-0')).toHaveAttribute('aria-label', 'Iron plate 8');
  await expect(page.locator('[data-testid=recipe-grid] [data-slot]').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath('character-screen.png') });
  await slot(page, 'inv-0').hover();
  await expect(page.getByTestId('tooltip')).toBeVisible();
  await page.screenshot({ path: info.outputPath('character-screen-tooltip.png') });
  // Dragging the title bar moves the window; the position is remembered per window type (I §4.0).
  const title = (await screen.locator('.titlebar .title').first().boundingBox()) as { x: number; y: number };
  const before = (await screen.boundingBox()) as { x: number; y: number };
  await page.mouse.move(title.x + 5, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x - 60, title.y + 40, { steps: 4 });
  await page.mouse.up();
  const moved = (await screen.boundingBox()) as { x: number; y: number };
  expect([Math.round(moved.x - before.x), Math.round(moved.y - before.y)]).toEqual([-65, 35]);
  await page.keyboard.press('e');
  await expect(screen).toHaveCount(0);
  await page.keyboard.press('e');
  const reopened = (await screen.boundingBox()) as { x: number; y: number };
  expect([reopened.x, reopened.y]).toEqual([moved.x, moved.y]);
  await page.keyboard.press('e');
  await expect(screen).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('slot clicks encode I §3.8 actions and the hand comes back in the projection @smoke', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  let seq = await lastSeq(page);
  // LMB picks up the whole stack: cursor_transfer; the origin slot keeps the hand marker (I §3.2).
  await slot(page, 'inv-0').click();
  let sent = await sentSince(page, seq);
  expect(sent.map((x) => x.action)).toEqual([
    { type: 'cursor_transfer', slot: { owner: { a: 0, b: 0, tag: 0 }, inv: MAIN, slot: 0 } },
  ]);
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).hand).toEqual({ key: PLATE, count: 8, origin: 0 });
  await expect(slot(page, 'inv-0')).toHaveClass(/slot-hand/);
  await expect(page.getByTestId('cursor-stack').locator('.count')).toHaveText('8');
  // RMB on an empty slot puts one down: cursor_split (auto-sort then files it with its kind, I §3.8).
  seq = await lastSeq(page);
  await slot(page, 'inv-30').click({ button: 'right' });
  await step(page, 1);
  const carried = async () => {
    const s = await uiState(page);
    return {
      hand: s.hand.count,
      placed: s.main.filter((x) => x.key === PLATE).reduce((n, x) => n + x.count, 0),
    };
  };
  await expect.poll(carried).toEqual({ hand: 7, placed: 1 });
  // Q returns the rest to its origin slot: clear_cursor.
  await page.keyboard.press('q');
  await step(page, 1);
  sent = await sentSince(page, seq);
  expect(sent.map((x) => x.type)).toEqual(['cursor_split', 'clear_cursor']);
  await expect.poll(async () => (await uiState(page)).hand.count).toBe(0);
  await expect.poll(carried).toEqual({ hand: 0, placed: 8 });
  expect(problems).toEqual([]);
});

test('crafting: LMB, RMB and Shift+LMB queue 1, 5 and all; the queue cancels through the same bindings', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  const recipe = slot(page, 'recipe-iron-chest');
  await expect(recipe.locator('.count')).toHaveText('1'); // 8 plates: one chest
  const seq = await lastSeq(page);
  await recipe.click();
  await recipe.click({ button: 'right' });
  await recipe.click({ modifiers: ['Shift'] });
  const sent = await sentSince(page, seq);
  expect(sent.map((x) => x.action.count)).toEqual([1, 5, 0]);
  expect(new Set(sent.map((x) => x.type))).toEqual(new Set(['craft']));
  await step(page, 1);
  await expect(page.getByTestId('crafting-queue')).toBeVisible();
  expect((await uiState(page)).queue).toEqual([{ recipe: 0, count: 1 }]); // the plates make one, the rest is refused
  // The queue's slot cancels with the cancel bindings: the plates come back.
  await page.getByTestId('queue-0').click();
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).queue.length).toBe(0);
  await expect(recipe.locator('.count')).toHaveText('1');
  // Crafted: 0.5 s is 30 ticks; the flying text names the product and the total.
  await recipe.click();
  await step(page, 32);
  await expect
    .poll(async () => (await uiState(page)).flying.some((t) => /^\+1 Iron chest \(1\)$/.test(t)))
    .toBe(true);
  expect(problems).toEqual([]);
});

test('walking with WASD and hand mining with RMB held, through the real input layer', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  const start = await characterPos(page);
  let seq = await lastSeq(page);
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await step(page, 20);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  const walk = await sentSince(page, seq);
  expect(walk.map((x) => x.action)).toEqual([
    { type: 'start_walking', input_gen: 0, dir: 0 },
    { type: 'start_walking', input_gen: 0, dir: 2 },
    { type: 'start_walking', input_gen: 0, dir: 4 },
    { type: 'stop_walking', input_gen: 0 },
  ]);
  await step(page, 1);
  const moved = await characterPos(page);
  expect(moved?.y).toBeLessThan((start?.y ?? 0) - 1);
  expect(moved?.x).toBeGreaterThan((start?.x ?? 0) + 1);
  // Walk to the ore and mine a tile: hold RMB (begin_mining_terrain), the mining bar fills, ore arrives (I §3.7).
  const ore = await nearestOre(page);
  await walkTo(page, ore.x, ore.y, 2);
  seq = await lastSeq(page);
  const p = await screenOf(page, ore.x, ore.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'right' });
  await step(page, 10);
  await expect(page.getByTestId('mining-bar')).toBeVisible();
  await step(page, 140);
  await page.mouse.up({ button: 'right' });
  await step(page, 1);
  const mine = await sentSince(page, seq);
  expect(mine.map((x) => x.type)).toEqual(['begin_mining_terrain', 'stop_mining']);
  await expect
    .poll(async () => (await uiState(page)).main.some((s) => s.key === ORE && s.count > 0))
    .toBe(true);
  expect(problems).toEqual([]);
});

test('the chest window: LMB opens it within reach, Shift+LMB moves a stack, Ctrl+LMB fast-transfers', async ({
  page,
}, info) => {
  const problems = watchConsole(page);
  await startGame(page);
  await craftChest(page);
  const c = (await characterPos(page)) as { x: number; y: number };
  const serial = await placeChest(page, Math.floor(c.x) + 2.5, Math.floor(c.y) + 0.5);
  const chest = (await entities(page)).find((e) => e.serial === serial) as { x: number; y: number };
  // Mine ore to put into it: the ore is the only item M0's start leaves after the chest.
  const ore = await nearestOre(page);
  await walkTo(page, ore.x, ore.y, 2);
  const op = await screenOf(page, ore.x, ore.y);
  await page.mouse.move(op.x, op.y);
  await page.mouse.down({ button: 'right' });
  await step(page, 150);
  await page.mouse.up({ button: 'right' });
  await step(page, 1);
  await walkTo(page, chest.x, chest.y, 3);
  const screen = await screenOf(page, chest.x, chest.y);
  await page.mouse.move(screen.x, screen.y);
  await expect.poll(async () => (await uiState(page)).selection?.serial).toBe(serial);
  await expect(page.getByTestId('docked-info')).toBeVisible();
  await page.mouse.click(screen.x, screen.y);
  await expect(page.getByTestId('entity-window')).toBeVisible();
  expect((await uiState(page)).window).toBe(`entity:${serial}`);
  const oreSlot = (await uiState(page)).main.findIndex((s) => s.key === ORE);
  let seq = await lastSeq(page);
  await slot(page, `inv-${oreSlot}`).click({ modifiers: ['Shift'] });
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    {
      type: 'stack_transfer',
      from: { owner: { a: 0, b: 0, tag: 0 }, inv: MAIN, slot: oreSlot },
      to: { a: serial, b: 0, tag: 1 },
    },
  ]);
  await step(page, 1);
  await expect(page.locator('[data-testid=entity-inventory] .count').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath('chest-window.png') });
  // Shift+LMB on the chest's slot moves it back (to the player's main inventory: EntityRef tag 0).
  seq = await lastSeq(page);
  await slot(page, 'chest-0').click({ modifiers: ['Shift'] });
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    {
      type: 'stack_transfer',
      from: { owner: { a: serial, b: 0, tag: 1 }, inv: CHEST, slot: 0 },
      to: { a: 0, b: 0, tag: 0 },
    },
  ]);
  // Ctrl+LMB on the chest in the world: fast_entity_transfer (the window closes first with Esc).
  await page.keyboard.press('Escape');
  seq = await lastSeq(page);
  await page.keyboard.down('Control');
  await page.mouse.click(screen.x, screen.y);
  await page.keyboard.up('Control');
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    { type: 'fast_entity_transfer', target: { a: serial, b: 0, tag: 1 } },
  ]);
  expect(problems).toEqual([]);
});

test('building: LMB places the held chest, a drag lays a line with one drag id (I §3.3–§3.4)', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await startGame(page);
  await craftChest(page);
  await page.keyboard.press('e');
  const at0 = (await uiState(page)).main.findIndex((s) => s.key === CHEST_ITEM && s.count > 0);
  await slot(page, `inv-${at0}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  expect((await uiState(page)).hand.count).toBe(1);
  // Three tiles south of the character, then drag three tiles west: four builds of one drag (only the first has
  // an item: the sim refuses the rest, no item in the hand).
  const c = (await characterPos(page)) as { x: number; y: number };
  const tx = Math.floor(c.x);
  const ty = Math.floor(c.y) + 3;
  const at = (x: number) => screenOf(page, x + 0.5, ty + 0.5);
  const seq = await lastSeq(page);
  const p0 = await at(tx);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const dx of [-1, -2, -3]) {
    const p = await at(tx + dx);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  const sent = await sentSince(page, seq);
  const builds = sent.filter((x) => x.type === 'build');
  expect(builds.map((x) => (x.action.pos as { x2: number }).x2)).toEqual([
    2 * tx + 1,
    2 * tx - 1,
    2 * tx - 3,
    2 * tx - 5,
  ]);
  expect(new Set(builds.map((x) => x.action.drag_id)).size).toBe(1);
  expect(new Set(builds.map((x) => x.action.mode))).toEqual(new Set([0]));
  expect(sent.at(-1)?.type).toBe('stop_drag_build');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).hand.count).toBe(0);
  const built = (await entities(page)).filter((e) => e.name === 'iron-chest' && e.y === ty + 0.5);
  expect(built.map((e) => e.x)).toEqual([tx + 0.5]);
  expect(problems).toEqual([]);
});

test('Esc opens the game menu; Exit to main menu asks first; E confirms', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('game-menu-exit').click();
  await expect(page.getByTestId('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog')).toHaveCount(0);
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('game-menu-exit').click();
  await page.keyboard.press('e');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(problems).toEqual([]);
});

test('rebinding: rotate on T is saved, its conflict is listed, and T rotates the selection (F28)', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await openPage(page);
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('controls-search').fill('rotate');
  await page.getByTestId('bind-rotate-primary').click();
  await expect(page.getByTestId('bind-rotate-primary')).toHaveText('Press a key or button');
  await page.keyboard.press('t');
  await expect(page.getByTestId('bind-rotate-primary')).toHaveText('T');
  await page.getByTestId('controls-search').fill('');
  await expect(page.getByTestId('conflict-rotate')).toContainText('Technologies');
  await page.getByTestId('settings-confirm').click();
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(() => uiState(page).then((s) => s?.screen)).toBe('game');
  await step(page, 1);
  await expect.poll(() => uiState(page).then((s) => s?.main.length ?? 0)).toBe(80);
  await craftChest(page);
  const c = (await characterPos(page)) as { x: number; y: number };
  const serial = await placeChest(page, Math.floor(c.x) + 2.5, Math.floor(c.y) + 0.5);
  const e = (await entities(page)).find((x) => x.serial === serial) as { x: number; y: number };
  const p = await screenOf(page, e.x, e.y);
  await page.mouse.move(p.x + 1, p.y + 1);
  await expect.poll(async () => (await uiState(page)).selection?.serial).toBe(serial);
  const seq = await lastSeq(page);
  await page.keyboard.press('t');
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    { type: 'rotate_entity', target: { a: serial, b: 0, tag: 1 }, reverse: false },
  ]);
  expect(problems).toEqual([]);
});
