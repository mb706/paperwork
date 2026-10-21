// The M0 smoke screenshot set (10 §12 M0 exit: "the smoke screenshot has been reviewed"; C8): Chrome at 1920 × 1080,
// the real sim and renderer, test mode (frames drawn on demand, every file settled before a shot), through the real
// input layer: the main menu, a new game, walking, the character screen, a placed chest and its window, and the
// night (M0's sim has no day cycle, §5.7 is M1's: the renderer's daylight is set to 0 for the last frame, which is
// the cyanotype every later milestone shows). The PNGs go to pm/reports/C8/ (or SHOTS_DIR).
//   npx playwright test e2e/screenshots.spec.ts --project chrome
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { characterPos, entities, openPage, screenOf, step, uiState } from './ui-helpers.ts';

const OUT = process.env.SHOTS_DIR ?? join(import.meta.dirname, '..', '..', 'pm', 'reports', 'C8');
const ORE = 8;
const CHEST = 0;

test.skip(({ browserName }) => browserName !== 'chromium', 'headless Firefox here has no WebGL2');
test.use({ viewport: { width: 1920, height: 1080 } });

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    const g = (window as unknown as { __game: { render?: { frame(): void; settled(): Promise<void> } } })
      .__game;
    await g.render?.settled();
    g.render?.frame();
  });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test('the M0 smoke screenshots @shots', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const problems = watchConsole(page);
  // 1. The main menu, then a new game from it (in one tab: a second tab would be offered *Take over*).
  await openPage(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, '01-main-menu.png') });
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  // 2. The new game, at its first tick.
  await shot(page, '02-new-game');
  // 3. Walking north-east toward the starting patch, mid-stride.
  await page.keyboard.down('d');
  await page.keyboard.down('w');
  await step(page, 24);
  await shot(page, '03-walking');
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await step(page, 1);
  // Mine four ore on the way (RMB held on the nearest ore tile).
  const c = (await characterPos(page)) as { x: number; y: number };
  const rs = await page.evaluate(() =>
    (
      window as unknown as { __game: { ui: { resources(): { x: number; y: number; name: string }[] } } }
    ).__game.ui.resources(),
  );
  const near = rs
    .filter((r) => r.name === 'iron-ore-patch')
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0] as {
    x: number;
    y: number;
  };
  for (let i = 0; i < 60 && Math.hypot(near.x - c.x, near.y - c.y) > 2; i++) {
    const p = (await characterPos(page)) as { x: number; y: number };
    if (Math.hypot(near.x - p.x, near.y - p.y) < 2) break;
    const keys = [
      near.x - p.x > 0.4 ? 'd' : near.x - p.x < -0.4 ? 'a' : '',
      near.y - p.y > 0.4 ? 's' : near.y - p.y < -0.4 ? 'w' : '',
    ].filter(Boolean);
    for (const k of keys) await page.keyboard.down(k);
    await step(page, 4);
    for (const k of keys) await page.keyboard.up(k);
  }
  const o = await screenOf(page, near.x, near.y);
  await page.mouse.move(o.x, o.y);
  await page.mouse.down({ button: 'right' });
  await step(page, 4 * 120 + 2);
  await page.mouse.up({ button: 'right' });
  await step(page, 1);
  // 4. The character screen: the inventory, the crafting panel, the iron chest's recipe tooltip.
  await page.keyboard.press('e');
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await page.getByTestId('recipe-iron-chest').hover();
  await page.waitForTimeout(600);
  await shot(page, '04-character-screen');
  // Craft it, take it, place it two tiles east, fill it with the ore, open it.
  await page.getByTestId('recipe-iron-chest').click();
  await step(page, 32);
  const k = (await uiState(page)).main.findIndex((s) => s.key === CHEST);
  await page.getByTestId(`inv-${k}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const at = (await characterPos(page)) as { x: number; y: number };
  const spot = { x: Math.floor(at.x) + 2.5, y: Math.floor(at.y) + 0.5 };
  const p = await screenOf(page, spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await step(page, 1);
  expect((await entities(page)).some((e) => e.name === 'iron-chest')).toBe(true);
  await page.mouse.move(p.x + 3, p.y + 3);
  await step(page, 1);
  await shot(page, '05-chest-placed');
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('entity-window')).toBeVisible();
  const ore = (await uiState(page)).main.findIndex((s) => s.key === ORE);
  await page.getByTestId(`inv-${ore}`).click({ modifiers: ['Shift'] });
  await step(page, 1);
  await page.mouse.move(10, 10);
  await shot(page, '06-chest-opened');
  await page.keyboard.press('Escape');
  await step(page, 1);
  // 7. The night: the same world under the cyanotype grade (the sim's daylight forced to 0 in the renderer).
  await page.evaluate(() => {
    const r = (window as unknown as { __render: { renderer: { mirror: { daylight: number } } } }).__render;
    r.renderer.mirror.daylight = 0;
  });
  await shot(page, '07-night');
  expect(problems).toEqual([]);
});
