// Pure UI state (10 §7.6, S4): screens, windows, the game menu, alt-mode, tooltips and interface settings. None
// of it enters the sim. Window rules (I §4.0): one main window at a time; opening another replaces it and pushes
// the old one onto the browse history (Alt+← / Alt+→); small dialogs stack modally on top; windows remember their
// position per window type; E confirms, Esc cancels.
//
// Layers (I §1.4, §4.0; C5-r1 6): every window that E and Esc act on registers a layer with its stacking rank and
// its cancel (the [X]); its green buttons register into it. Esc cancels the top layer, E presses the top layer's
// newest enabled green button (or closes a layer that has none), so a page opened over the game menu (Settings)
// goes back to the menu, and a dialog over a window answers before the window does.
import { createSignal } from 'solid-js';

export type Screen = 'menu' | 'loading' | 'game';

/** The message log's line duration (I §4.20 "chat message duration"; 10 s assumed) and its length. */
export const MESSAGE_MS = 10_000;
const MESSAGES_MAX = 6;
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
  kind: 'item' | 'recipe' | 'text' | 'queue' | 'label';
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

/** Stacking ranks of the layers (higher is on top). */
export const LAYER = { menuPage: 5, window: 10, gameMenu: 20, gameMenuPage: 21, dialog: 30 } as const;

/** A window E and Esc act on (I §1.4). */
export interface Layer {
  readonly z: number;
  /** Esc, the [X] button. */
  cancel(): void;
  /** The layer's green buttons, oldest first; `press` returns false while the button is disabled. */
  readonly confirms: { press: () => boolean }[];
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
  /** The character screen's tab in the tabbed layout (I §4.4: F2 character, F3 crafting). */
  readonly charTab = createSignal<'character' | 'crafting'>('character');
  /** The message log at the bottom left (I §4.1 "Chat log"): the lines still showing, oldest first. */
  readonly messages = createSignal<{ id: number; text: string; error: boolean }[]>([]);
  private messageIds = 0;

  /**
   * A line in the message log (I §4.1: fully opaque, then fading during its last 2 s; `durationMs` is the chat
   * message duration setting). Repeats of the newest line replace it rather than stacking.
   */
  addMessage(text: string, error = false, durationMs = MESSAGE_MS): void {
    const [list, set] = this.messages;
    const id = ++this.messageIds;
    const kept = list().filter((m) => m.text !== text);
    set([...kept.slice(-(MESSAGES_MAX - 1)), { id, text, error }]);
    setTimeout(() => set(this.messages[0]().filter((m) => m.id !== id)), durationMs);
  }
  private readonly back: MainWindow[] = [];
  private readonly forward: MainWindow[] = [];
  private readonly layers: Layer[] = [];

  /** Registers a layer (a window E and Esc act on); returns it and the function that removes it. */
  pushLayer(z: number, cancel: () => void): { layer: Layer; remove: () => void } {
    const layer: Layer = { z, cancel, confirms: [] };
    this.layers.push(layer);
    return {
      layer,
      remove: () => {
        const i = this.layers.indexOf(layer);
        if (i >= 0) this.layers.splice(i, 1);
      },
    };
  }

  /** The top layer: the highest rank, the newest among equals. */
  topLayer(): Layer | null {
    let top: Layer | null = null;
    for (const l of this.layers) if (!top || l.z >= top.z) top = l;
    return top;
  }

  /** Esc (I §1.4): the top layer cancels; false when there is none. */
  cancelTop(): boolean {
    const l = this.topLayer();
    if (!l) return false;
    l.cancel();
    return true;
  }

  /**
   * E (I §1.4, FFF-362): the top layer's green button (the newest enabled one; nothing while they are all disabled),
   * else the layer closes; false when there is no layer.
   */
  confirmTop(): boolean {
    const l = this.topLayer();
    if (!l) return false;
    if (l.confirms.length === 0) l.cancel();
    else for (let i = l.confirms.length - 1; i >= 0; i--) if (l.confirms[i]?.press()) break;
    return true;
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
    this.messages[1]([]);
  }
}

/** Window positions per window type (I §4.0: remembered; default centred). Kept for the session. */
export const windowPositions = new Map<string, { x: number; y: number }>();
