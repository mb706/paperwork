// Helpers for the UI's Playwright specs: start a game on the real sim in test mode (10 §3.3: the clock stops,
// `__game.step(n)` runs ticks and resolves after their packet), read the UI's state (`__game.ui`) and the actions
// the real input layer encoded.
import { expect, type Page, test } from '@playwright/test';

export interface UiState {
  screen: string;
  window: string | null;
  gameMenu: boolean;
  altMode: boolean;
  hand: { key: number; count: number; origin: number };
  main: { key: number; count: number }[];
  queue: { recipe: number; count: number }[];
  selection: { kind: string; serial?: number } | null;
  camera: { x: number; y: number; zoom: number };
  flying: string[];
  messages: string[];
  problems: string[];
  applyMs: number;
  gen: number;
  present: boolean;
}

export interface Sent {
  seq: number;
  type: string;
  action: Record<string, unknown>;
  at: number;
}

/** `window.__game` as the specs use it (src/dev/game-hooks.ts, with the UI's and the renderer's hooks). */
export interface E2eGame {
  step(n: number): Promise<number>;
  tick(): number;
  hash(): Promise<string>;
  ui: {
    state(): UiState;
    sent(): Sent[];
    toScreen(x: number, y: number): { x: number; y: number };
    entities(): { serial: number; proto: number; name: string; x: number; y: number }[];
    resources(): { x: number; y: number; name: string }[];
    character(): { x: number; y: number } | null;
    perf(): { packet: number[]; frame: number[] };
  };
  render?: { frame(): void; settled(): Promise<void> };
}

/** The page's `__game` (evaluate callbacks run in the page: they read it through this cast). */
export const G = (): E2eGame => (window as unknown as { __game: E2eGame }).__game;

/**
 * Opens the page once the dev server's generators are idle: a request under /data/ is held until then, and every
 * generator run ends with a full page reload, which would abort a page that loaded earlier (and Firefox reports
 * each aborted module load as a console warning).
 */
export async function openPage(page: Page, query = 'test=1'): Promise<void> {
  // Headless Firefox here has no WebGL2: the world view keeps its model, camera and picking without drawing
  // (`?render=none`, as C4's specs run it there), rather than log the failed context.
  const firefox = test.info().project.name === 'firefox';
  const q = firefox && !query.includes('render=') ? `${query}${query ? '&' : ''}render=none` : query;
  // Readiness, not a delay (the M0 exit audit #10): a request under /data/ is held until no generator is scheduled or
  // running, and the generators run again only when their inputs change, so the page loaded after it is final once
  // its main menu shows. A reload that still lands meanwhile (an input changed) is seen and the page opened again.
  let loads = 0;
  const counted = (f: { parentFrame(): unknown }) => {
    if (f.parentFrame() === null) loads += 1;
  };
  page.on('framenavigated', counted);
  try {
    for (let attempt = 0; ; attempt++) {
      await page.request.get('/data/build-manifest.json');
      await page.request.get('/data/fake/build-manifest.json');
      const before = loads;
      await page.goto(`/?${q}`);
      try {
        await expect(page.getByTestId('main-menu')).toBeVisible();
      } catch (e) {
        if (loads === before + 1 || attempt >= 5) throw e;
        continue;
      }
      if (loads === before + 1) return;
      if (attempt >= 5) throw new Error('the page kept reloading: a generator keeps running');
    }
  } finally {
    page.off('framenavigated', counted);
  }
}

/**
 * Main menu → New game → Play; resolves when the character's projection has arrived. In test mode one tick runs
 * (the character joins in the world's first tick).
 */
export async function startGame(page: Page, query = 'test=1'): Promise<void> {
  await openPage(page, query);
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(async () => (await uiState(page))?.screen).toBe('game');
  if (query.includes('test=1')) await step(page, 1);
  await expect.poll(async () => (await uiState(page))?.present).toBe(true);
  await expect.poll(async () => (await uiState(page))?.main.length ?? 0).toBe(80);
}

export const uiState = (page: Page): Promise<UiState> =>
  page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.ui?.state() as UiState);

/** Actions sent after `since` (a seq). */
export const sentSince = (page: Page, since = 0): Promise<Sent[]> =>
  page.evaluate(
    (s) => ((window as unknown as { __game?: E2eGame }).__game?.ui?.sent() ?? []).filter((x) => x.seq > s),
    since,
  );

export const lastSeq = async (page: Page): Promise<number> =>
  (await page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.ui?.sent() ?? [])).at(-1)
    ?.seq ?? 0;

/**
 * Runs n ticks; resolves after their packet reached the page (C3-r1 12). Then one frame is drawn (test mode renders
 * on demand), so the camera follows the character and the view request follows the camera, as every frame does in
 * play: a click at `screenOf` then lands where the world is drawn.
 */
export async function step(page: Page, n: number): Promise<void> {
  await page.evaluate(async (k) => {
    const g = (window as unknown as { __game: E2eGame }).__game;
    await g.step(k);
    g.render?.frame();
  }, n);
}

/** The screen position of a world point (the camera the last frame was drawn with). */
export const screenOf = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(
    ([a, b]) =>
      (window as unknown as { __game?: E2eGame }).__game?.ui?.toScreen(a as number, b as number) ?? {
        x: 0,
        y: 0,
      },
    [x, y] as const,
  );

export const entities = (page: Page) =>
  page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.ui?.entities() ?? []);

export const characterPos = (page: Page) =>
  page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.ui?.character() ?? null);

/** Draws one frame (on-demand rendering in test mode), so the camera follows and a screenshot shows the world. */
export const frame = (page: Page) =>
  page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.render?.frame());

/** Waits for the world view's art (a screenshot with the real atlases), when there is a renderer. */
export const settled = (page: Page) =>
  page.evaluate(() => (window as unknown as { __game?: E2eGame }).__game?.render?.settled());
