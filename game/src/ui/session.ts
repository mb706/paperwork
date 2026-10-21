// The game session over the host (10 §3.1–§3.4, §8.2–§8.4; C3's SimHost): what the menus' commands do. A new game
// or a load replaces the world through the host (a fresh worker in a new state generation); the loading screen
// shows until that world's first packet is shown, and a failure returns to the main menu with the reason. When a
// new generation is shown (a new game, a load, the host's trap recovery), everything the UI derived from the old
// world is dropped before the new world's first record (`generation`, C5-r1 11). Saves go through the host to the
// IO worker: "saved" is answered only once the save is written, checked and published, so every listed save can
// be loaded (C5-r1 12). Whether this tab owns the saves (§8.2 "One tab at a time") follows the host's `storage`.
import { createSignal } from 'solid-js';
import { NewWorldCodec } from '../shared/gen/abi.ts';
import type { SaveEntry, SessionApi } from './core/context.ts';
import type { UiHost } from './host.ts';
import { t } from './i18n/locale.ts';
import type { ActionEncoder } from './input/encoder.ts';
import type { GameStore } from './store/game.ts';
import type { UiState } from './store/ui.ts';

/** The local player in single player (§3.3). */
export const LOCAL_PLAYER = 0;

export interface SessionOptions {
  host: UiHost;
  ui: UiState;
  game: GameStore;
  encoder: ActionEncoder;
  /** A new world is shown (a new state generation): the input layer and the world overlay start over. */
  onGeneration?: (gen: number) => void;
  /** The world is gone (the menu, a failed start): the same, with nothing shown. */
  onLeave?: () => void;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class GameSession implements SessionApi {
  private readonly o: SessionOptions;
  /** Bumped by every start and exit: an older start that settles late changes nothing. */
  private attempt = 0;
  private seed = 0;
  private loadedName: string | null = null;
  private readonly ownerSignal = createSignal<boolean | null>(null);
  /** The shown generation (0: none). */
  gen = 0;

  constructor(o: SessionOptions) {
    this.o = o;
    this.ownerSignal[1](o.host.owner);
    o.host.on('storage', (s) => this.ownerSignal[1](s.owner));
    o.host.on('generation', (g) => this.generation(g));
    o.host.on('bound', () => {
      if (o.ui.screen[0]() === 'loading') o.ui.loadingProgress[1](0.7);
    });
    o.host.on('trap', (tr) => {
      // §3.6: the host keeps the bug bundle and reloads the last autosave into a fresh worker.
      if (o.ui.screen[0]() === 'game') o.ui.addMessage(t('notice.trap', String(tr.tick)), true);
    });
  }

  /** §3.4 step 3: the old world's derived state goes; the new world's actions and records start. */
  private generation(gen: number): void {
    this.gen = gen;
    this.o.encoder.bind(this.o.host);
    this.o.game.newGeneration();
    this.o.onGeneration?.(gen);
  }

  owner(): boolean | null {
    return this.ownerSignal[0]();
  }

  takeOver(): void {
    this.o.host.takeOver();
  }

  newGame(seed: number): void {
    this.seed = seed;
    this.loadedName = null;
    void this.enter(() => this.o.host.newGame({ ...NewWorldCodec.defaults(), seed }));
  }

  loadSave(name: string): void {
    void this.enter(() => this.o.host.loadSave(name), name);
  }

  /** A world replacement: the loading screen until its first packet is shown, or back to the menu. */
  private async enter(run: () => Promise<unknown>, name: string | null = null): Promise<void> {
    const { ui, game } = this.o;
    const attempt = ++this.attempt;
    this.leave();
    ui.resetGame();
    ui.notice[1](null);
    ui.screen[1]('loading');
    ui.loadingProgress[1](0.1);
    game.start(LOCAL_PLAYER);
    try {
      await run();
      if (attempt !== this.attempt) return;
      if (name !== null) this.loadedName = name;
      ui.loadingProgress[1](1);
      ui.screen[1]('game');
    } catch (e) {
      if (attempt !== this.attempt) return;
      this.leave();
      ui.screen[1]('menu');
      ui.menuPage[1]('main');
      ui.notice[1](t('loading.failed', message(e)));
    }
  }

  /** Everything of the world shown goes (its actions, subscriptions and stores). */
  private leave(): void {
    this.gen = 0;
    this.o.encoder.bind(null);
    this.o.game.end();
    this.o.onLeave?.();
  }

  exitToMenu(): void {
    this.attempt += 1;
    this.o.host.exit();
    this.leave();
    this.o.ui.resetGame();
    this.o.ui.screen[1]('menu');
    this.o.ui.menuPage[1]('main');
  }

  setMenuPause(paused: boolean): void {
    this.o.host.setMenuPause(paused);
  }

  suggestedName(): string {
    return this.loadedName ?? String(this.seed);
  }

  /**
   * The music program's seed for the game shown (the audio module's `startGame`, A4 §5.1): a new game's map seed, a
   * loaded save's name hashed (FNV-1a), so a game keeps its music across loads.
   */
  musicSeed(): number {
    if (this.loadedName === null) return this.seed >>> 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < this.loadedName.length; i++)
      h = Math.imul(h ^ this.loadedName.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  async saveGame(name: string): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const m = await this.o.host.save('manual', name);
      if (m.t === 'saved') {
        this.loadedName = name;
        return { ok: true };
      }
      return { ok: false, message: m.t === 'saveFailed' ? m.message : m.t };
    } catch (e) {
      return { ok: false, message: message(e) };
    }
  }

  async listSaves(): Promise<SaveEntry[]> {
    try {
      const list = await this.o.host.listSaves();
      return list.map((s) => ({
        id: s.name,
        name: s.name,
        tick: s.tick,
        date: Date.parse(s.savedAt) || 0,
        loadable: true,
      }));
    } catch {
      return [];
    }
  }

  async storage(): Promise<{ used: number; quota: number } | null> {
    const s = await this.o.host.storage().catch(() => null);
    return s ? { used: s.usage, quota: s.quota } : null;
  }
}
