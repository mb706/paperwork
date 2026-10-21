// The game page's sound (C9: C7's runtime on the App through src/app/attach-audio.ts; 10 §9.4, §15.6), in Chrome:
// headless Firefox here has no audio device, so its realtime contexts never leave 'suspended' (C7). Nothing here
// skips: without the audio build (public/audio) the page has no sounds and the spec fails (the M0 exit audit #4).
//   1. the first gesture starts the context and the main menu plays the charter piece's recording; a menu button's
//      click sounds; a new game starts its music program;
//   2. walking, hand mining, crafting and building sound, each by name (footstep-grass, mine-ore, ui-click,
//      build-small), the game menu's pause closes the world's sounds, and the Sound tab's sliders reach the mixer
//      at once: Back restores them, Confirm keeps them across a reload;
//   3. that session's audio inputs, recorded, render offline over Era I's piece through the real engine: the SFX
//      sound, and the mix has a sane loudness, no clipping and no non-finite or denormal samples.
import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { watchConsole } from './console.ts';
import { characterPos, type E2eGame, openPage, screenOf, step, uiState } from './ui-helpers.ts';

interface AudioHooks {
  status(): Promise<{
    state: string;
    mode: string;
    piece: string | null;
    recording: string | null;
    world: boolean;
    sfxReady: boolean;
    errors: string[];
    sfx: { played: number; limited: number; historical: number; unmapped: number };
  }>;
  played(): string[];
  record(): void;
  stop(): unknown;
  system: { settings: { volume: Record<string, number>; muted: Record<string, boolean> } };
}
type W = { __game: E2eGame & { audio: AudioHooks } };

const status = (page: Page) => page.evaluate(() => (window as unknown as W).__game.audio.status());
const played = (page: Page) => page.evaluate(() => (window as unknown as W).__game.audio.played());
const volumes = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as W).__game.audio.system.settings;
    return { volume: { ...s.volume }, muted: { ...s.muted } };
  });

test.skip(({ browserName }) => browserName !== 'chromium', 'headless Firefox here has no audio device (C7)');
test.describe.configure({ mode: 'serial' });

/** The first test's recorded session, rendered by the second (serial: one worker, in order). */
let recorded: { events: { t: number; packet?: number[]; sound?: unknown }[]; entitySizes: number[] } | null =
  null;

/** Walks toward tile (tx, ty) in steps of 4 ticks until within `near` tiles. */
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

async function nearestOre(page: Page): Promise<{ x: number; y: number }> {
  const c = (await characterPos(page)) as { x: number; y: number };
  const rs = await page.evaluate(() => (window as unknown as W).__game.ui.resources());
  const best = rs
    .filter((r) => r.name === 'iron-ore-patch')
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  if (!best) throw new Error('no iron ore in view');
  return { x: Math.floor(best.x), y: Math.floor(best.y) };
}

test('the game page sounds: the menu, building, mining, crafting, GUI clicks and the Sound tab @smoke', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await openPage(page);
  // 1. The first gesture (a click on the menu's paper) starts the context; the menu loop is the charter recording.
  await page.mouse.click(8, 8);
  await expect.poll(async () => (await status(page)).state, { timeout: 20_000 }).toBe('running');
  await expect.poll(async () => (await status(page)).recording, { timeout: 20_000 }).toBe('charter');
  expect((await status(page)).mode).toBe('full');
  await expect.poll(async () => (await status(page)).sfxReady, { timeout: 20_000 }).toBe(true);
  // A menu button's click sounds; New game → Play starts the program (the charter recording fades out).
  await page.getByTestId('menu-new-game').click();
  await expect.poll(() => played(page)).toContain('ui-click');
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).screen).toBe('game');
  await step(page, 1);
  await expect.poll(async () => (await uiState(page)).present).toBe(true);
  await expect.poll(async () => (await status(page)).piece, { timeout: 20_000 }).not.toBeNull();

  await page.evaluate(() => (window as unknown as W).__game.audio.record());
  // 2. Walking: footsteps on the run cycle.
  const ore = await nearestOre(page);
  await walkTo(page, ore.x, ore.y, 2.0);
  expect(await played(page)).toContain('footstep-grass');
  // Hand mining: the hammer's strikes, one a swing (a second), while RMB is held; 20 ticks a packet.
  const p = await screenOf(page, ore.x + 0.5, ore.y + 0.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 9; i++) await step(page, 20);
  await page.mouse.up({ button: 'right' });
  await step(page, 1);
  expect((await played(page)).filter((n) => n === 'mine-ore').length).toBeGreaterThanOrEqual(2);
  // Crafting: the recipe's click, and the completion (item_crafted: the GUI click until M1c's craft-finished).
  await page.keyboard.press('e');
  const clicks = (await played(page)).filter((n) => n === 'ui-click').length;
  await page.getByTestId('recipe-iron-chest').click();
  // the craft takes 30 ticks once its action is applied (0.5 s, GM1)
  for (let i = 0; i < 10 && !(await uiState(page)).main.some((x) => x.key === 0); i++) await step(page, 10);
  expect((await played(page)).filter((n) => n === 'ui-click').length).toBeGreaterThanOrEqual(clicks + 2);
  // Building: the chest into the hand, placed two tiles east: build-small (a 1 × 1 footprint).
  const k = (await uiState(page)).main.findIndex((s) => s.key === 0);
  await page.getByTestId(`inv-${k}`).click();
  await step(page, 1);
  await page.keyboard.press('e');
  const c = (await characterPos(page)) as { x: number; y: number };
  const spot = await screenOf(page, Math.floor(c.x) + 2.5, Math.floor(c.y) + 0.5);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);
  await step(page, 2);
  expect(await played(page)).toContain('build-small');
  recorded = (await page.evaluate(() => (window as unknown as W).__game.audio.stop())) as typeof recorded;
  writeFileSync(info.outputPath('session.json'), JSON.stringify(recorded));

  // The game menu pauses single player: the world's sounds close (UI and music go on), and open again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  // test mode's worlds are paused by design (stepped), so the gate follows the menu only outside test mode; here
  // it stays open, and the status says so
  expect((await status(page)).world).toBe(true);

  // The Sound tab: a slider reaches the mixer at once; Back restores; Confirm keeps it, across a reload.
  await page.getByTestId('game-menu-settings').click();
  await page.getByTestId('settings-tab-sound').click();
  await page.getByTestId('sound-volume-master').fill('0');
  await expect.poll(async () => (await volumes(page)).volume.master).toBe(0);
  await page.getByTestId('sound-mute-music').click();
  await expect.poll(async () => (await volumes(page)).muted.music).toBe(true);
  await page.getByTestId('settings-back').click();
  await expect.poll(async () => (await volumes(page)).volume.master).toBe(1);
  expect((await volumes(page)).muted.music).toBe(false);
  await page.getByTestId('game-menu-settings').click();
  await page.getByTestId('settings-tab-sound').click();
  await page.getByTestId('sound-volume-music').fill('35');
  await page.getByTestId('settings-confirm').click();
  await expect.poll(async () => (await volumes(page)).volume.music).toBeCloseTo(0.35, 5);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('paperwork.settings') ?? '{}'));
  expect(stored.sound.volume.music).toBeCloseTo(0.35, 5);
  await openPage(page);
  await expect.poll(async () => (await volumes(page)).volume.music).toBeCloseTo(0.35, 5);

  const s = await status(page);
  expect(s.errors, 'audio errors').toEqual([]);
  expect(problems).toEqual([]);
});

test("the session's sounds over Era I, rendered offline: loudness, no clipping @smoke", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  const script = recorded;
  if (!script) throw new Error('the first test recorded no session');
  expect(script.events.filter((e) => e.sound || e.packet).length).toBeGreaterThan(5);
  const seconds = Math.ceil((script.events.at(-1)?.t ?? 0) + 2);
  await page.goto('/src/dev/audio.html');
  await page.waitForFunction(
    () => 'render' in ((window as unknown as { __audioDev?: object }).__audioDev ?? {}),
  );
  const r = await page.evaluate(
    ([sc, d]) =>
      (
        window as unknown as {
          __audioDev: {
            render(c: unknown): Promise<{
              lufs: number;
              peak: number;
              denormals: number;
              nonFinite: number;
              errors: string[];
              script: { played: number; limited: number; historical: number; unmapped: number } | null;
              seconds: number;
            }>;
          };
        }
      ).__audioDev.render({
        piece: 'era1',
        params: { seed: 1945 },
        duration: d,
        tail: 2,
        activity: 0.5,
        // BS.1770's K-weighting coefficients are 48 kHz's (the masters' rate; the engine resamples)
        sampleRate: 48000,
        script: sc,
      }),
    [script, seconds] as const,
  );
  console.log(
    `session render: ${r.seconds.toFixed(1)} s, ${r.lufs.toFixed(1)} LUFS, peak ${(20 * Math.log10(r.peak)).toFixed(1)} dBFS, SFX ${JSON.stringify(r.script)}`,
  );
  writeFileSync(info.outputPath('render.json'), JSON.stringify(r));
  expect(r.errors).toEqual([]);
  expect(r.script?.played ?? 0, 'the SFX sounded').toBeGreaterThan(5);
  expect(r.script?.unmapped).toBe(0);
  expect(r.nonFinite).toBe(0);
  expect(r.denormals).toBe(0);
  // the master's limiter holds −1 dBTP: no sample reaches full scale
  expect(r.peak).toBeLessThan(0.95);
  // music at 100 % sits at −18 LUFS over a whole piece (A4 §8); an opening with the session's sounds stays near it
  expect(r.lufs).toBeGreaterThan(-30);
  expect(r.lufs).toBeLessThan(-12);
  expect(problems).toEqual([]);
});

test("the game menu's pause closes the world's sounds; music and the GUI go on (§9.4) @smoke", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  // real time, not test mode: the menu's pause is the world's pause
  await openPage(page, '');
  await page.mouse.click(8, 8);
  await expect.poll(async () => (await status(page)).state, { timeout: 20_000 }).toBe('running');
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page)).present, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await status(page)).world).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await expect.poll(async () => (await status(page)).world).toBe(false);
  // the GUI still sounds under the menu
  const before = (await played(page)).length;
  await page.getByTestId('game-menu-settings').click();
  await expect.poll(async () => (await played(page)).length).toBeGreaterThan(before);
  await page.getByTestId('settings-back').click();
  await page.getByTestId('game-menu-continue').click();
  await expect.poll(async () => (await status(page)).world).toBe(true);
  expect((await status(page)).errors).toEqual([]);
  expect(problems).toEqual([]);
});
