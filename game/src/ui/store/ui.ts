// Pure UI state (10 §7.6, S4): screens, windows, the game menu, alt-mode, tooltips and interface settings. None
// of it enters the sim. Window rules (I §4.0): one main window at a time; opening another replaces it and pushes
// the old one onto the browse history (Alt+← / Alt+→); small dialogs stack modally on top; windows remember their
// position per window type; E confirms, Esc cancels.
import { createSignal } from 'solid-js';

export type Screen = 'menu' | 'loading' | 'game';
export type MenuPage = 'main' | 'new-game' | 'load' | 'settings';

export type MainWindow =
  | { kind: 'character' }
  | { kind: 'entity'; serial: number; proto: number }
  | { kind: 'stats' }
  | { kind: 'settings' };

export interface Dialog {
  title: string;
  text: string;
  confirm: string;
  cancel: string;
  /** A destructive confirm (red button, I §4.0). */
  red?: boolean;
  onConfirm: () => void;
}

/** What a tooltip shows; read reactively, so it follows the slot's contents while it stays open. */
export interface TipContent {
  kind: 'item' | 'recipe' | 'text' | 'queue';
  /** Item key or recipe id, by kind. */
  id: number;
  text?: string;
  /** A hotkey hint line (I §1.6). */
  hint?: string;
}

export interface TooltipState {
  /** The anchor's rectangle in viewport px (measured on hover, never in the frame loop). */
  x: number;
  y: number;
  w: number;
  h: number;
  content: () => TipContent | null;
}

export const sameWindow = (a: MainWindow | null, b: MainWindow | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    (a.kind !== 'entity' || (b.kind === 'entity' && a.serial === b.serial)));

export class UiState {
  readonly screen = createSignal<Screen>('menu');
  readonly menuPage = createSignal<MenuPage>('main');
  readonly window = createSignal<MainWindow | null>(null, { equals: sameWindow });
  readonly gameMenu = createSignal(false);
  readonly dialog = createSignal<Dialog | null>(null);
  readonly altMode = createSignal(false);
  readonly hideGui = createSignal(false);
  readonly tooltip = createSignal<TooltipState | null>(null);
  /** Shift held: tooltips show at once (`activate-tooltip`, I §2.3). */
  readonly tooltipNow = createSignal(false);
  /** A notice line for the loading screen and the menu (developer failures in M0). */
  readonly notice = createSignal<string | null>(null);
  readonly loadingProgress = createSignal(0);
  private readonly back: MainWindow[] = [];
  private readonly forward: MainWindow[] = [];
  /** The green buttons on screen, newest last: E presses the newest enabled one (I §1.4). */
  private readonly confirms: { press: () => boolean }[] = [];

  /** Registers a green button; `press` returns false while it is disabled. Returns the unregister function. */
  addConfirm(press: () => boolean): () => void {
    const entry = { press };
    this.confirms.push(entry);
    return () => {
      const i = this.confirms.indexOf(entry);
      if (i >= 0) this.confirms.splice(i, 1);
    };
  }

  /** Presses the newest enabled green button; false when there is none. */
  pressConfirm(): boolean {
    for (let i = this.confirms.length - 1; i >= 0; i--) if (this.confirms[i]?.press()) return true;
    return false;
  }

  /** Opens a main window (closing the current one into the browse history), or brings it back if open. */
  open(w: MainWindow): void {
    const [cur, set] = this.window;
    const now = cur();
    if (sameWindow(now, w)) return;
    if (now) this.back.push(now);
    if (this.back.length > 32) this.back.shift();
    this.forward.length = 0;
    set(w);
  }

  close(): void {
    this.window[1](null);
  }

  toggle(w: MainWindow): void {
    if (sameWindow(this.window[0](), w)) this.close();
    else this.open(w);
  }

  /** Alt+← (I §2.8, FFF-397): the previous window of the browse history. */
  goBack(): void {
    const prev = this.back.pop();
    if (!prev) return;
    const now = this.window[0]();
    if (now) this.forward.push(now);
    this.window[1](prev);
  }

  goForward(): void {
    const next = this.forward.pop();
    if (!next) return;
    const now = this.window[0]();
    if (now) this.back.push(now);
    this.window[1](next);
  }

  /** Drops windows that show an entity which is gone (§7.3 rule 4), from the history too. */
  forgetEntity(serial: number): void {
    const gone = (w: MainWindow) => w.kind === 'entity' && w.serial === serial;
    const cur = this.window[0]();
    if (cur && gone(cur)) this.close();
    for (const list of [this.back, this.forward])
      for (let i = list.length - 1; i >= 0; i--) if (gone(list[i] as MainWindow)) list.splice(i, 1);
  }

  resetGame(): void {
    this.window[1](null);
    this.back.length = 0;
    this.forward.length = 0;
    this.gameMenu[1](false);
    this.dialog[1](null);
    this.tooltip[1](null);
  }
}

/** Window positions per window type (I §4.0: remembered; default centred). Kept for the session. */
export const windowPositions = new Map<string, { x: number; y: number }>();
