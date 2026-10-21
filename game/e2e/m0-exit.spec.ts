// M0's exit through the real input layer on the real sim (10 §12 M0 exit; C8), in Chrome and in Firefox with
// `?render=none`. Every gesture is a keyboard or mouse event; the UI's input layer turns it into actions, the host
// hands them to the sim worker's LocalSequencer, and the sim runs them in closures (S2, S3):
//   1. the character walks on generated terrain at 60 UPS on the worker's own clock (not test mode), measured over
//      3-s windows of wall time (one of up to three must hold 60 ± 1.5);
//   2. a chest is crafted, placed, filled (Shift+LMB and Ctrl+LMB on slots, Ctrl+LMB on the chest in the world),
//      emptied and mined back by holding RMB; the chest window shows INVENTORY and the statistics window STATS,
//      both real projections (IMPL-1 rule 5): the ore mined by hand, the chest crafted, the plates it used;
//   3. save, load and the state hash agree natively and in the browser: the browser's autosave and closure log,
//      exported, hash and replay in `simtool` to the browser's own hashes (D18 e for an E2E session);
//   4. world replacement and trap recovery: the dev panic traps, the notice shows, the last autosave comes back
//      in a fresh worker with its hash, and the trap's bug report, sent to the dev server's `/__report`,
//      reproduces the panic natively (`simtool replay bench/reports/<id>`, a simcheck build).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { simtool } from './simtool.ts';
import {
  characterPos,
  type E2eGame,
  entities,
  openPage,
  screenOf,
  startGame,
  step,
  uiState,
} from './ui-helpers.ts';

const GAME = join(import.meta.dirname, '..');
/** `__game` with the shell's hooks this spec uses (src/dev/game-hooks.ts). */
interface Hooks extends E2eGame {
  digest(): Promise<{ tick: number; d: string; r: string }>;
  save(name?: string): Promise<unknown>;
  load(b: Uint8Array): Promise<unknown>;
  panic(): Promise<void>;
  exportBugBundle(): Promise<{ save: Uint8Array | null; log: Uint8Array }>;
  report(note?: string): Promise<{ dir: string; trap: boolean; files: string[] }>;
}
type W = { __game: Hooks };
const CHEST = 0; // item keys (golden prototypes' order, quality 0)
const ORE = 8;
const PLATE = 16;

const count = (main: { key: number; count: number }[], key: number) =>
  main.filter((s) => s.key === key).reduce((a, s) => a + s.count, 0);

/** Walks with WASD toward the centre of tile (tx, ty) until within `near` tiles, re-aiming every 4 ticks. */
async function walkTo(page: Page, tx: number, ty: number, near: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const c = (await characterPos(page)) as { x: number; y: number };
    const [dx, dy] = [tx + 0.5 - c.x, ty + 0.5 - c.y];
    if (Math.hypot(dx, dy) < near) return;
    const keys = [dx > 0.4 ? 'd' : dx < -0.4 ? 'a' : '', dy > 0.4 ? 's' : dy < -0.4 ? 'w' : ''].filter(
      Boolean,
    );
    for (const k of keys) await page.keyboard.down(k);
    await step(page, 4);
    for (const k of keys) await page.keyboard.up(k);
  }
  throw new Error(`could not reach (${tx}, ${ty})`);
}

/** The nearest resource tile of the view model to the character. */
async function nearestOre(page: Page): Promise<{ x: number; y: number }> {
  const c = (await characterPos(page)) as { x: number; y: number };
  const rs = await page.evaluate(() => (window as unknown as W).__game.ui.resources());
  const best = rs
    .filter((r) => r.name === 'iron-ore-patch')
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  if (!best) throw new Error('no iron ore in view');
  return { x: Math.floor(best.x), y: Math.floor(best.y) };
}

/** Holds a mouse button over world point (x, y) for n ticks. */
async function holdAt(page: Page, x: number, y: number, button: 'left' | 'right', n: number): Promise<void> {
  const p = await screenOf(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button });
  await step(page, n);
  await page.mouse.up({ button });
  await step(page, 1);
}

/**
 * The statistics window's rows on one side, as "<item> <total>": the total from the row, the item's name from its
 * tooltip (shown at once while Shift is held, I §4.0).
 */
async function statRows(page: Page, side: 'produced' | 'consumed'): Promise<string[]> {
  const rows = page.getByTestId(`stats-row-${side}`);
  const out: string[] = [];
  await page.keyboard.down('Shift');
  try {
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      await row.hover();
      const tip = page.getByTestId('tooltip');
      await expect(tip).toBeVisible();
      const name = ((await tip.locator('.tip-title').first().textContent()) ?? '').trim();
      out.push(`${name} ${((await row.locator('.count').textContent()) ?? '').trim()}`);
    }
  } finally {
    await page.keyboard.up('Shift');
  }
  return out;
}

test('the character walks on generated terrain at 60 UPS, through the LocalSequencer @smoke', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  // Not test mode: the sim worker's clock runs the world at 60 UPS (§3.3); Chrome draws continuously.
  const firefox = info.project.name === 'firefox';
  await openPage(page, firefox ? 'render=none' : '');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).present, { timeout: 30_000 }).toBe(true);
  const at = async () =>
    page.evaluate(async () => {
      const g = (window as unknown as W).__game;
      const d = (await g.digest()) as { tick: number };
      return { tick: d.tick, wall: performance.now() };
    });
  // Walk east, measuring the tick rate over windows of 3 s of wall time: the character crosses chunk borders,
  // whose neighbours generate as it goes. On a shared host a window can lose ticks to another process (the clock
  // rebases rather than spiral, §3.3), so up to three windows are measured and one must hold 60 UPS.
  const x0 = ((await characterPos(page)) as { x: number }).x;
  await page.keyboard.down('d');
  const windows: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = await at();
    await page.waitForTimeout(3000);
    const b = await at();
    windows.push(((b.tick - a.tick) * 1000) / (b.wall - a.wall));
    if (Math.abs((windows.at(-1) as number) - 60) < 1.5) break;
  }
  await page.keyboard.up('d');
  const ups = windows.at(-1) as number;
  await expect.poll(async () => ((await characterPos(page)) as { x: number }).x).toBeGreaterThan(x0 + 15);
  const x1 = ((await characterPos(page)) as { x: number }).x;
  console.log(
    `${info.project.name}: ${windows.map((u) => u.toFixed(2)).join(', ')} UPS over 3-s windows; walked ${(x1 - x0).toFixed(1)} tiles`,
  );
  writeFileSync(info.outputPath('ups.json'), JSON.stringify({ windows, walked: x1 - x0 }));
  expect(ups).toBeGreaterThan(58.5);
  expect(ups).toBeLessThan(61.5);
  expect(problems).toEqual([]);
});

test('a chest crafted, placed, filled and mined through the real input layer; INVENTORY and STATS @smoke', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await startGame(page);
  // Hand-mine three iron ore: walk next to the starting patch and hold RMB on a resource tile (120 ticks a unit).
  const ore = await nearestOre(page);
  await walkTo(page, ore.x, ore.y, 2.0);
  await holdAt(page, ore.x + 0.5, ore.y + 0.5, 'right', 3 * 120 + 2);
  expect(count((await uiState(page)).main, ORE)).toBe(3);

  // Craft the chest (the recipe slot), take it into the hand, place it two tiles east.
  await page.keyboard.press('e');
  await page.getByTestId('recipe-iron-chest').click();
  await step(page, 32);
  expect(count((await uiState(page)).main, CHEST)).toBe(1);
  expect(count((await uiState(page)).main, PLATE)).toBe(0);
  const k = (await uiState(page)).main.findIndex((s) => s.key === CHEST);
  await page.getByTestId(`inv-${k}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const c = (await characterPos(page)) as { x: number; y: number };
  const spot = { x: Math.floor(c.x) + 2.5, y: Math.floor(c.y) + 0.5 };
  const p = await screenOf(page, spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await step(page, 1);
  const chest = (await entities(page)).find((e) => e.name === 'iron-chest') as { serial: number };
  expect(chest).toBeTruthy();

  // Open it: INVENTORY says it is empty. Shift+LMB on the ore stack moves it in.
  await page.mouse.move(p.x + 1, p.y + 1);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('entity-window')).toBeVisible();
  await expect(page.getByTestId('chest-0')).toHaveAttribute('aria-label', '');
  const o = (await uiState(page)).main.findIndex((s) => s.key === ORE);
  await page.getByTestId(`inv-${o}`).click({ modifiers: ['Shift'] });
  await step(page, 1);
  await expect(page.getByTestId('chest-0')).toHaveAttribute('aria-label', 'Iron ore 3');
  expect(count((await uiState(page)).main, ORE)).toBe(0);
  // Ctrl+LMB on the chest's stack takes every stack of it back; Shift+LMB on it moves the stack again.
  await page.getByTestId('chest-0').click({ modifiers: ['Control'] });
  await step(page, 1);
  expect(count((await uiState(page)).main, ORE)).toBe(3);
  await expect(page.getByTestId('chest-0')).toHaveAttribute('aria-label', '');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('entity-window')).toHaveCount(0);
  // Ctrl+LMB on the chest in the world with the ore in the hand: fast transfer (I §3.8).
  await page.keyboard.press('e');
  const o2 = (await uiState(page)).main.findIndex((s) => s.key === ORE);
  await page.getByTestId(`inv-${o2}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  expect((await uiState(page)).hand.count).toBe(3);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  await step(page, 1);
  expect((await uiState(page)).hand.count).toBe(0);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('chest-0')).toHaveAttribute('aria-label', 'Iron ore 3');
  await page.keyboard.press('Escape');

  // Mine it back by holding RMB: the chest goes, its contents and the chest come back (I §3.7).
  await holdAt(page, spot.x, spot.y, 'right', 30);
  expect((await entities(page)).some((e) => e.serial === chest.serial)).toBe(false);
  const main = (await uiState(page)).main;
  expect([count(main, CHEST), count(main, ORE)]).toEqual([1, 3]);

  // Production statistics (P), from STATS: three ore and one chest produced; eight plates consumed.
  await page.keyboard.press('p');
  await expect(page.getByTestId('window-stats')).toBeVisible();
  await step(page, 60);
  await expect
    .poll(() => statRows(page, 'produced'))
    .toEqual(expect.arrayContaining(['Iron ore 3', 'Iron chest 1']));
  await expect.poll(() => statRows(page, 'consumed')).toEqual(expect.arrayContaining(['Iron plate 8']));
  expect(problems).toEqual([]);
});

test('save, load and the state hash agree natively and in the browser @smoke', async ({ page }, info) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await startGame(page);
  // Play a little through the input layer, autosave (the closure log's base), play on.
  await page.keyboard.down('s');
  await step(page, 40);
  await page.keyboard.up('s');
  await step(page, 1);
  await page.evaluate(() => (window as unknown as W).__game.save());
  const savedHash = (await page.evaluate(() => (window as unknown as W).__game.hash())) as string;
  const savedTick = (await page.evaluate(() => (window as unknown as W).__game.tick())) as number;
  await page.keyboard.down('a');
  await step(page, 50);
  await page.keyboard.up('a');
  await page.keyboard.press('e');
  await page.getByTestId('recipe-iron-chest').click();
  await step(page, 40);
  await page.keyboard.press('e');
  const endHash = (await page.evaluate(() => (window as unknown as W).__game.hash())) as string;
  const endTick = (await page.evaluate(() => (window as unknown as W).__game.tick())) as number;
  // The bundle: the autosave (a save container from the IO worker) and the closure log since it, with digests.
  const b = (await page.evaluate(async () => {
    const x = await (window as unknown as W).__game.exportBugBundle();
    const bundle = x as unknown as { save: Uint8Array; log: Uint8Array };
    return { save: Array.from(bundle.save), log: Array.from(bundle.log) };
  })) as { save: number[]; log: number[] };
  const dir = mkdtempSync(join(tmpdir(), 'pw-m0-exit-'));
  writeFileSync(join(dir, 'save.save'), new Uint8Array(b.save));
  writeFileSync(join(dir, 'closures.pwlog'), new Uint8Array(b.log));
  writeFileSync(info.outputPath('save.save'), new Uint8Array(b.save));
  writeFileSync(info.outputPath('closures.pwlog'), new Uint8Array(b.log));
  const tool = simtool(false);
  // Natively: the saved container hashes to the browser's hash at the save …
  const hashed = execFileSync(tool, ['hash', join(dir, 'save.save')], { cwd: GAME, encoding: 'utf8' });
  expect(hashed).toContain(`tick ${savedTick}`);
  expect(hashed).toContain(`hash ${savedHash}`);
  // … and the browser's closure log replays from it, every recorded digest equal, to the browser's end hash.
  const r = spawnSync(tool, ['replay', join(dir, 'save.save'), join(dir, 'closures.pwlog')], {
    cwd: GAME,
    encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toContain(`state ${endHash}`);
  expect(r.stderr).toMatch(new RegExp(`${endTick - savedTick} recorded digests match`));
  // In the browser: the save loads into a fresh worker with the same hash and tick.
  const loaded = await page.evaluate(async (bytes) => {
    const g = (window as unknown as W).__game;
    await g.load(new Uint8Array(bytes));
    return { hash: await g.hash(), tick: g.tick() };
  }, b.save);
  expect(loaded).toEqual({ hash: savedHash, tick: savedTick });
  console.log(
    `${info.project.name}: save at tick ${savedTick} hashes to ${savedHash} in the browser and in simtool; the browser's log replays natively to ${endHash} at tick ${endTick}`,
  );
  expect(problems).toEqual([]);
});

test('the dev panic: the trap notice, recovery from the last autosave, a report that reproduces it natively @smoke', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  // The trap is the point of this test: its error lines are expected, nothing else may be logged.
  const expected = (m: string) =>
    /trap|panic|stopped at tick|dev panic|debug_dump|unreachable|RuntimeError/i.test(m);
  await startGame(page);
  await page.keyboard.down('d');
  await step(page, 30);
  await page.keyboard.up('d');
  await step(page, 1);
  await page.evaluate(() => (window as unknown as W).__game.save());
  const saved = {
    hash: (await page.evaluate(() => (window as unknown as W).__game.hash())) as string,
    tick: (await page.evaluate(() => (window as unknown as W).__game.tick())) as number,
  };
  const gen0 = (await uiState(page)).gen;
  await step(page, 20);
  // Test mode: the panic is queued for the next tick, which the next step runs (and which never answers).
  await page.evaluate(() => (window as unknown as W).__game.panic());
  await page.evaluate(() => {
    void (window as unknown as W).__game.step(1).catch(() => {});
  });
  // The trap notice in the message log; a fresh worker with the autosave, a new state generation.
  await expect
    .poll(async () => (await uiState(page)).messages.some((m) => /simulation stopped at tick/i.test(m)), {
      timeout: 60_000,
    })
    .toBe(true);
  await expect.poll(async () => (await uiState(page)).gen, { timeout: 60_000 }).toBeGreaterThan(gen0);
  await expect.poll(async () => (await uiState(page)).present, { timeout: 30_000 }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__game.hash())).toBe(saved.hash);
  expect(await page.evaluate(() => (window as unknown as W).__game.tick())).toBe(saved.tick);
  // The report: the trap's bundle (the autosave, the log to the trapping tick, the digests) to /__report.
  const rep = (await page.evaluate(() => (window as unknown as W).__game.report('the M0 exit test'))) as {
    dir: string;
    trap: boolean;
    files: string[];
  };
  expect(rep.trap).toBe(true);
  expect(rep.files).toEqual(
    expect.arrayContaining(['save.save', 'closures.pwlog', 'digests.bin', 'console.txt']),
  );
  const r = spawnSync(simtool(true), ['replay', join(GAME, rep.dir)], { cwd: GAME, encoding: 'utf8' });
  writeFileSync(info.outputPath('replay.txt'), `${r.stdout}\n${r.stderr}`);
  // The autosave's tick, 20 steps, then the panic's tick: the same tick natively.
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(`trap at tick ${saved.tick + 21}`);
  expect(r.stderr).toContain('the dev panic');
  console.log(
    `${info.project.name}: ${rep.dir}: ${r.stderr.split('\n').find((l) => l.includes('trap at tick'))}`,
  );
  console.log(
    `${info.project.name}: the trap's own console lines: ${JSON.stringify(problems.filter(expected))}`,
  );
  expect(problems.filter((m) => !expected(m))).toEqual([]);
  // The bundle did its job: leave no report behind (a failing run keeps it for inspection).
  rmSync(join(GAME, rep.dir), { recursive: true, force: true });
});
