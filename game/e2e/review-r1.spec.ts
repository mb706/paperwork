// The codex C5-r1 findings that need a browser (pm/reviews/C5-r1.md; the rest are test/ui/review-r1.test.ts):
// Esc's layers through the real windows (6), Shift on a hovered slot (7), the queue tooltip's layout reads (14),
// keyboard navigation and modal focus (17), and windows after a viewport change (19). Each fails on the reviewed
// code (pm/reports/C5.md, "Review response").
import { expect, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { lastSeq, openPage, sentSince, startGame, step, uiState } from './ui-helpers.ts';

test('6: Esc in Game menu → Settings goes back to the menu, the next Esc closes it', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('game-menu-settings').click();
  await expect(page.getByTestId('window-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('window-settings')).toHaveCount(0);
  await expect(page.getByTestId('game-menu')).toBeVisible();
  expect((await uiState(page)).gameMenu).toBe(true);
  // E on the menu presses its green button (Continue); the page's green button answers E while it is open
  await page.getByTestId('game-menu-settings').click();
  await page.keyboard.press('e');
  await expect(page.getByTestId('window-settings')).toHaveCount(0); // Confirm applied and went back
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('7: Shift shows the tooltip of the slot under the pointer at once', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  await page.getByTestId('inv-0').hover();
  await page.keyboard.down('Shift');
  // The GUI tooltip delay is 0.4 s; with Shift held the tooltip does not wait for it.
  await expect(page.getByTestId('tooltip')).toBeVisible({ timeout: 200 });
  await page.keyboard.up('Shift');
  expect(problems).toEqual([]);
});

test('14: the crafting queue tooltip follows the time left without reading layout', async ({ page }) => {
  const problems = watchConsole(page);
  await startGame(page);
  await page.keyboard.press('e');
  await page.getByTestId('recipe-iron-chest').click();
  await step(page, 1);
  await page.keyboard.press('e');
  await page.getByTestId('queue-0').hover();
  const tooltip = page.getByTestId('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Remaining');
  await page.waitForTimeout(100); // the first placement (a ResizeObserver callback) is done
  await page.evaluate(() => {
    const w = window as unknown as { __rects: number };
    w.__rects = 0;
    const gbcr = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      w.__rects += 1;
      return gbcr.call(this);
    };
  });
  const texts = new Set<string>();
  for (let i = 0; i < 10; i++) {
    await step(page, 1);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    texts.add((await tooltip.textContent()) ?? '');
  }
  expect(texts.size).toBeGreaterThan(5); // the time left changed under the open tooltip
  expect(await page.evaluate(() => (window as unknown as { __rects: number }).__rects)).toBe(0);
  expect(problems).toEqual([]);
});

test('17: the keyboard reaches the menus, the slots and the dialogs', async ({ page }) => {
  const problems = watchConsole(page);
  await openPage(page);
  // Tab moves through the main menu; Enter presses the focused button.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('New game');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('window-new-game')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  // Slots: one tab stop per grid, the arrows move between slots, Enter is the left click.
  await page.keyboard.press('e');
  await page.getByTestId('inv-1').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'inv-0');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'inv-10');
  await page.keyboard.press('ArrowUp');
  const seq = await lastSeq(page);
  await page.keyboard.press('Enter');
  expect((await sentSince(page, seq)).map((x) => x.action)).toEqual([
    { type: 'cursor_transfer', slot: { owner: { a: 0, b: 0, tag: 0 }, inv: 1, slot: 0 } },
  ]);
  await step(page, 1);
  await page.keyboard.press('q');
  await page.keyboard.press('e');
  // A dialog takes the focus, keeps Tab inside, and gives it back when it closes.
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu-exit').click();
  const dialog = page.getByTestId('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid=dialog]') !== null))
    .toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid=dialog]') !== null)).toBe(
      true,
    );
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => document.activeElement?.closest('[data-testid=dialog]') ?? null),
  ).toBeNull();
  expect(problems).toEqual([]);
});

test('19: a window moved to the right stays reachable when the viewport shrinks', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await startGame(page);
  await page.keyboard.press('p');
  const win = page.getByTestId('window-stats');
  await expect(win).toBeVisible();
  const title = (await win.locator('.titlebar').boundingBox()) as { x: number; y: number };
  await page.mouse.move(title.x + 20, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 520, title.y + 208, { steps: 5 });
  await page.mouse.up();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => {
      const b = (await win.boundingBox()) as { x: number; y: number; width: number; height: number };
      return b.x >= 0 && b.y >= 0 && b.x + Math.min(b.width, 800) <= 800 && b.y + 30 <= 600;
    })
    .toBe(true);
  // The title bar is on screen: the window can be dragged and closed.
  const t2 = (await win.locator('.titlebar').boundingBox()) as { x: number; y: number; width: number };
  expect(t2.x + 10).toBeLessThan(800);
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  expect(problems).toEqual([]);
});
