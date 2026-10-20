// The UI and input layer against the fake sim (C5; 10 §7, §15.3, §15.5): Playwright drives the real input layer
// (keys and mouse through the browser), and each test checks the actions the encoder sent and what came back in
// the projections. Test mode stops the clock; `step(n)` runs ticks. Screenshots of the main menu and the
// character screen land in the test output (`test-results/dev/`).
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { lastSeq, openPage, screenOf, sentSince, startGame, step, uiState } from './ui-helpers.ts';

const MAIN = 1; // InventoryType.main
const CHEST = 2; // InventoryType.chest

/** The nearest chest to the character, and its screen position. */
async function nearestChest(page: Page) {
  // The chunks arrive with the packet that answers the first view request.
  await expect
    .poll(() => page.evaluate(() => window.__ui?.entities().some((e) => e.name.endsWith('chest')) ?? false))
    .toBe(true);
  const found = await page.evaluate(() => {
    const ui = window.__ui;
    const c = ui?.character();
    if (!ui || !c) return null;
    const chests = ui
      .entities()
      .filter((e) => e.name.endsWith('chest'))
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    return chests[0] ?? null;
  });
  if (!found) throw new Error('no chest near the character');
  return { ...found, screen: await screenOf(page, found.x, found.y) };
}

const slot = (page: Page, testid: string) => page.getByTestId(testid);

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
  await expect(page.getByTestId('build-status')).toHaveText(/^build m0 \(dev\)/);
  await page.screenshot({ path: info.outputPath('main-menu.png') });
  // Esc backs out of a menu page (I §1.4); E presses the green button (Play).
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
  const s = await uiState(page);
  const first = s.main[0] as { key: number; count: number };
  await expect(slot(page, 'inv-0').locator('.count')).toHaveText(String(first.count));
  await expect(page.locator('[data-testid=recipe-grid] [data-slot]').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath('character-screen.png') });
  await slot(page, 'inv-4').hover();
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
  const before = (await uiState(page)).main[1] as { key: number; count: number };
  let seq = await lastSeq(page);
  // LMB picks up the whole stack: cursor_transfer; the origin slot keeps the hand marker (I §3.2).
  await slot(page, 'inv-1').click();
  let sent = await sentSince(page, seq);
  expect(sent.map((x) => x.action)).toEqual([
    { type: 'cursor_transfer', slot: { owner: { a: 0, b: 0, tag: 0 }, inv: MAIN, slot: 1 } },
  ]);
  await step(page, 1);
  await expect
    .poll(async () => (await uiState(page)).hand)
    .toEqual({ key: before.key, count: before.count, origin: 1 });
  await expect(slot(page, 'inv-1')).toHaveClass(/slot-hand/);
  await expect(page.getByTestId('cursor-stack').locator('.count')).toHaveText(String(before.count));
  // RMB on an empty slot puts one down: cursor_split (auto-sort then files it with its kind, I §3.8).
  seq = await lastSeq(page);
  await slot(page, 'inv-30').click({ button: 'right' });
  await step(page, 1);
  const carried = async () => {
    const s = await uiState(page);
    return {
      hand: s.hand.count,
      placed: s.main.filter((x) => x.key === before.key).reduce((n, x) => n + x.count, 0),
    };
  };
  await expect.poll(carried).toEqual({ hand: before.count - 1, placed: 1 });
  // Q returns the rest to its origin slot: clear_cursor.
  await page.keyboard.press('q');
  await step(page, 1);
  sent = await sentSince(page, seq);
  expect(sent.map((x) => x.type)).toEqual(['cursor_split', 'clear_cursor']);
  await expect.poll(async () => (await uiState(page)).hand.count).toBe(0);
  expect(problems).toEqual([]);
});

test('crafting: LMB, RMB and Shift+LMB queue 1, 5 and all; the queue cancels through the same bindings', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  const recipe = slot(page, 'recipe-iron-chest');
  await expect(recipe).toBeVisible();
  const seq = await lastSeq(page);
  await recipe.click();
  await recipe.click({ button: 'right' });
  await recipe.click({ modifiers: ['Shift'] });
  const sent = await sentSince(page, seq);
  expect(sent.map((x) => x.action.count)).toEqual([1, 5, 0]);
  expect(new Set(sent.map((x) => x.type))).toEqual(new Set(['craft']));
  await step(page, 1);
  await expect(page.getByTestId('crafting-queue')).toBeVisible();
  const queued = (await uiState(page)).queue;
  expect(queued.length).toBe(1); // the same recipe merges into one entry (I §3.9)
  const n = (queued[0] as { count: number }).count;
  expect(n).toBeGreaterThan(5);
  await page.getByTestId('queue-0').click();
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).queue[0]?.count).toBe(n - 1);
  // A craft completes: 0.5 s is 30 ticks (golden rule 22); the flying text names the product and the total.
  await step(page, 30);
  await expect
    .poll(async () => (await uiState(page)).flying.some((t) => /^\+1 .+ \(\d+\)$/.test(t)))
    .toBe(true);
  expect(problems).toEqual([]);
});

test('the chest window: LMB opens it within reach, Shift+LMB moves a stack, Ctrl+LMB fast-transfers', async ({
  page,
}, info) => {
  const problems = watchConsole(page);
  await startGame(page);
  const chest = await nearestChest(page);
  await page.mouse.move(chest.screen.x, chest.screen.y);
  await expect.poll(async () => (await uiState(page)).selection?.serial).toBe(chest.serial);
  await expect(page.getByTestId('docked-info')).toBeVisible();
  await page.mouse.click(chest.screen.x, chest.screen.y);
  await expect(page.getByTestId('entity-window')).toBeVisible();
  expect((await uiState(page)).window).toBe(`entity:${chest.serial}`);
  let seq = await lastSeq(page);
  await slot(page, 'inv-0').click({ modifiers: ['Shift'] });
  const sent = await sentSince(page, seq);
  expect(sent.map((x) => x.action)).toEqual([
    {
      type: 'stack_transfer',
      from: { owner: { a: 0, b: 0, tag: 0 }, inv: MAIN, slot: 0 },
      to: { a: chest.serial, b: 0, tag: 1 },
    },
  ]);
  await step(page, 1);
  await expect(page.locator('[data-testid=entity-inventory] .count').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath('chest-window.png') });
  // Shift+LMB on a chest slot moves it back (to the player's main inventory: EntityRef tag 0).
  seq = await lastSeq(page);
  await slot(page, 'chest-0').click({ modifiers: ['Shift'] });
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    {
      type: 'stack_transfer',
      from: { owner: { a: chest.serial, b: 0, tag: 1 }, inv: CHEST, slot: 0 },
      to: { a: 0, b: 0, tag: 0 },
    },
  ]);
  // Ctrl+LMB on the chest in the world: fast_entity_transfer (the window closes first with Esc).
  await page.keyboard.press('Escape');
  seq = await lastSeq(page);
  await page.keyboard.down('Control');
  await page.mouse.click(chest.screen.x, chest.screen.y);
  await page.keyboard.up('Control');
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    { type: 'fast_entity_transfer', target: { a: chest.serial, b: 0, tag: 1 } },
  ]);
  expect(problems).toEqual([]);
});

test('walking with WASD and mining with RMB held, through the real input layer', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  const start = await page.evaluate(() => window.__ui?.character());
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
  const moved = await page.evaluate(() => window.__ui?.character());
  expect(moved?.y).toBeLessThan((start?.y ?? 0) - 1);
  expect(moved?.x).toBeGreaterThan((start?.x ?? 0) + 1);
  // Mine the nearest chest: hold RMB (begin_mining), the mining bar fills, the chest goes (I §3.7).
  const chest = await nearestChest(page);
  seq = await lastSeq(page);
  await page.mouse.move(chest.screen.x, chest.screen.y);
  await page.mouse.down({ button: 'right' });
  await step(page, 4);
  await expect(page.getByTestId('mining-bar')).toBeVisible();
  await step(page, 60);
  await page.mouse.up({ button: 'right' });
  await step(page, 1);
  const mine = await sentSince(page, seq);
  expect(mine.map((x) => x.type)).toEqual(['begin_mining', 'stop_mining']);
  expect(mine[0]?.action.target).toEqual({ a: chest.serial, b: 0, tag: 1 });
  await expect
    .poll(() => page.evaluate((s) => window.__ui?.entities().some((e) => e.serial === s), chest.serial))
    .toBe(false);
  expect(problems).toEqual([]);
});

test('building: LMB places the held chest, a drag lays a line with one drag id (I §3.3–§3.4)', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await startGame(page);
  // Take the iron chests into the hand from the character screen, then close it (the hand persists, I §3.2).
  await page.keyboard.press('e');
  const s = await uiState(page);
  const chests = s.main.findIndex((x) => x.count > 0 && x.count <= 10);
  await slot(page, `inv-${chests}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const hand = (await uiState(page)).hand;
  expect(hand.count).toBeGreaterThan(3);
  // Four tiles south of the character, then drag three tiles west.
  const c = (await page.evaluate(() => window.__ui?.character())) as { x: number; y: number };
  const tx = Math.floor(c.x);
  const ty = Math.floor(c.y) + 4;
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
  expect(sent.at(-1)?.type).toBe('stop_drag_build');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).hand.count).toBe(hand.count - 4);
  const built = await page.evaluate(
    (y) => window.__ui?.entities().filter((e) => e.name === 'iron-chest' && e.y === y + 0.5).length ?? 0,
    ty,
  );
  expect(built).toBe(4);
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
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(() => uiState(page).then((s) => s?.screen)).toBe('game');
  await expect.poll(() => uiState(page).then((s) => s?.main.length ?? 0)).toBe(80);
  const chest = await nearestChest(page);
  await page.mouse.move(chest.screen.x, chest.screen.y);
  await expect.poll(async () => (await uiState(page)).selection?.serial).toBe(chest.serial);
  const seq = await lastSeq(page);
  await page.keyboard.press('t');
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    { type: 'rotate_entity', target: { a: chest.serial, b: 0, tag: 1 }, reverse: false },
  ]);
  expect(problems).toEqual([]);
});
