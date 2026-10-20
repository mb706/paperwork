// Helpers for the UI's Playwright specs: start a game on the fake sim in test mode (10 §3.3: the clock stops,
// `__game.step(n)` runs ticks), read the UI's state and the actions the real input layer encoded.
import { expect, type Page } from '@playwright/test';

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
  problems: string[];
  applyMs: number;
}

export interface Sent {
  seq: number;
  type: string;
  action: Record<string, unknown>;
  at: number;
}

declare global {
  interface Window {
    __ui?: {
      state(): UiState;
      sent(): Sent[];
      toScreen(x: number, y: number): { x: number; y: number };
      entities(): { serial: number; proto: number; name: string; x: number; y: number }[];
      character(): { x: number; y: number } | null;
      perf(): { packet: number[]; frame: number[] };
    };
    __game?: { step(n: number): void; tick(): number; packets(): number };
  }
}

/**
 * Opens the page once the dev server's generators are idle: a request under /data/ is held until then, and every
 * generator run ends with a full page reload, which would abort a page that loaded earlier (and Firefox reports
 * each aborted module load as a console warning).
 */
export async function openPage(page: Page, query = 'test=1'): Promise<void> {
  await page.request.get('/data/build-manifest.json');
  await page.request.get('/data/fake/build-manifest.json');
  await page.goto(`/?${query}`);
}

/** Main menu → New game → Play, in test mode; resolves when the character's projection has arrived. */
export async function startGame(page: Page, query = 'test=1'): Promise<void> {
  await openPage(page, query);
  await page.getByTestId('menu-new-game').click();
  await page.getByTestId('new-game-play').click();
  await expect.poll(() => page.evaluate(() => window.__ui?.state().screen)).toBe('game');
  await expect.poll(() => page.evaluate(() => window.__ui?.state().main.length ?? 0)).toBe(80);
}

export const uiState = (page: Page): Promise<UiState> => page.evaluate(() => window.__ui?.state() as UiState);

/** Actions sent after `since` (a seq). */
export const sentSince = (page: Page, since = 0): Promise<Sent[]> =>
  page.evaluate((s) => (window.__ui?.sent() ?? []).filter((x) => x.seq > s), since);

export const lastSeq = async (page: Page): Promise<number> =>
  (await page.evaluate(() => window.__ui?.sent() ?? [])).at(-1)?.seq ?? 0;

/** Runs n ticks and waits for the packet that follows them. */
export async function step(page: Page, n: number): Promise<void> {
  const before = await page.evaluate(() => window.__game?.tick() ?? 0);
  await page.evaluate((k) => window.__game?.step(k), n);
  await expect.poll(() => page.evaluate(() => window.__game?.tick() ?? 0)).toBe(before + n);
}

/** The screen position of a world point. */
export const screenOf = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([a, b]) => window.__ui?.toScreen(a, b) ?? { x: 0, y: 0 }, [x, y] as const);
