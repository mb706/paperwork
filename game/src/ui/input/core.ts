// The input core (I §1.2–§1.5, 10 §7.5): DOM events in, control presses and releases out.
//
// - Physical inputs (`KeyboardEvent.code`, mouse buttons, wheel notches) are matched against the live binding
//   table: press controls on an exact modifier match, hold controls with extra modifiers too (I §1.1).
// - OS auto-repeat is ignored for game controls; text fields keep it (I §1.3).
// - Hold controls stay active until their physical input goes up; `blur` and a hidden page release them all.
// - While a text field has focus only Esc, Enter, Tab and Ctrl+F reach the game (I §1.3).
// - The wheel is normalised to pixels and accumulated into notches of about 100 px (I §1.2); over a GUI panel it
//   scrolls the panel instead.
// - The capture layer (I §1.5, BEND-1) keeps the browser's defaults off the game's keys: Tab, Space, Alt (down
//   and up), Alt+letters and arrows, F1–F10, Ctrl+Z/Y/C/X/V/F, Backspace, Firefox's quick-find keys, Mouse4/5,
//   the context menu, middle-click autoscroll and Ctrl+Wheel; Keyboard Lock in fullscreen where it exists.
//   Tab and Space are captured only while the game has the focus (the page itself, I §1.5); on a focused button,
//   field or slot of the GUI they keep their browser meaning (focus traversal, activation), and on a slot Enter is
//   its left click and the arrows move between slots (C5-r1 17).
// - Every control fires on its input's keydown, Alt alone (`show-info`) too, as in Factorio (I §2.2, §3.14).
// - Keys that compose text (an IME's candidate selection: `isComposing`, keyCode 229, between compositionstart and
//   compositionend) belong to the text field and never reach the game (C5-r1 18).
//
// The handlers take the DOM events structurally (KeyLike, PointerLike, WheelLike), so Vitest drives them in Node.
import type { BindingTable, Match } from './bindings.ts';
import { ALT, CTRL, SHIFT } from './controls.ts';

export interface InputEvent {
  /** The input: a key code, 'Mouse0'…'Mouse4', 'WheelUp'/'WheelDown', or 'Ctrl'/'Shift'/'Alt' alone. */
  code: string;
  mods: number;
  /** The pointer, CSS px in the viewport, when the event happened. */
  x: number;
  y: number;
  /** The element under the pointer for mouse input; the focused element for keys. */
  target: Element | null;
}

/** What the input core drives: the resolver (I §1.4). */
export interface InputSink {
  /**
   * An input went down and matched these controls (exact matches first). Returns the control it acted on, or
   * null when nothing applied; a returned hold control is released when the input goes up.
   */
  press(matches: Match[], e: InputEvent): string | null;
  release(control: string, e: InputEvent): void;
  /** The pointer moved (hover, drag-building, sweeps). */
  move(x: number, y: number, target: Element | null): void;
  /** Every held control was dropped (blur, hidden page). */
  releaseAll(): void;
  /** A key while a text field has focus: Esc, Enter, Tab or Ctrl+F; true when the game used it. */
  textKey(code: string, mods: number, target: Element): boolean;
}

interface ModsLike {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}
export interface KeyLike extends ModsLike {
  code: string;
  repeat: boolean;
  /** An IME composition is in progress (the key belongs to it). */
  isComposing?: boolean;
  /** 229 while an IME processes the key (Safari's committing Enter among them). */
  keyCode?: number;
}
export interface PointerLike extends ModsLike {
  button: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}
export interface WheelLike extends PointerLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

/** Pixels per notch (I §1.2). */
export const NOTCH_PX = 100;
/** Line-mode wheels (Firefox) report 3 lines per notch. */
const LINE_PX = NOTCH_PX / 3;

const MODIFIER_CODES: Record<string, string> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
};
const MOD_BIT: Record<string, number> = { Ctrl: CTRL, Shift: SHIFT, Alt: ALT };

/** Browser defaults the capture layer stops on keydown even when no control is bound (I §1.5). */
const ALWAYS_CAPTURED = new Set([
  'Tab',
  'Space',
  'Backspace',
  'Quote',
  'Slash',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
const CTRL_CAPTURED = new Set([
  'KeyZ',
  'KeyY',
  'KeyC',
  'KeyX',
  'KeyV',
  'KeyF',
  'NumpadAdd',
  'NumpadSubtract',
  'Numpad0',
]);
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'range', 'color', 'submit', 'reset']);
/** Keys a focused GUI control keeps (focus traversal and activation). */
const NAVIGATION = new Set([
  'Tab',
  'Space',
  'Enter',
  'NumpadEnter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ContextMenu',
]);
/** Captured only while a game runs and has the focus (the map and shoot keys, I §1.5). */
const GAME_ONLY = new Set(['Tab', 'Space']);

/** Whether a key event is part of an IME composition (C5-r1 18). */
export const composing = (e: { isComposing?: boolean; keyCode?: number }): boolean =>
  e.isComposing === true || e.keyCode === 229;

/** The game has the focus: nothing, the page itself, or the world canvas (I §1.5). */
export function gameFocus(el: Element | null | undefined): boolean {
  if (!el) return true;
  const tag = el.tagName;
  return tag === 'BODY' || tag === 'HTML' || tag === 'CANVAS';
}

/** A text field: game controls are suspended while one has focus (I §1.3). */
export function isTextField(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NOT_TEXT.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}

export interface InputCoreOptions {
  mac?: boolean;
  /** Whether a wheel event over this element belongs to the GUI (scrolls it) rather than the world. */
  isGui?: (el: Element | null) => boolean;
  /** The focused element (default: `document.activeElement`). */
  focused?: () => Element | null;
  /** A focused slot's keyboard use (Enter: its left-click controls; the arrows: the next slot). */
  slotKey?: (el: Element, code: string, mods: number) => boolean;
  /** Whether a game is shown (Tab and Space are the game's only then; in the menus they navigate). */
  inGame?: () => boolean;
}

export class InputCore {
  private table: BindingTable;
  private readonly sink: InputSink;
  private readonly mac: boolean;
  private readonly isGui: (el: Element | null) => boolean;
  private readonly focused: () => Element | null;
  private readonly slotKey: (el: Element, code: string, mods: number) => boolean;
  private readonly inGame: () => boolean;
  /** Physical inputs down now, with the hold control each started (or null). */
  private readonly down = new Map<string, string | null>();
  private wheelAcc = 0;
  private x = 0;
  private y = 0;
  private overEl: Element | null = null;
  /** Between compositionstart and compositionend. */
  private composition = false;
  private readonly off: (() => void)[] = [];
  private enabled = true;

  constructor(table: BindingTable, sink: InputSink, opts: InputCoreOptions = {}) {
    this.table = table;
    this.sink = sink;
    this.mac = opts.mac ?? false;
    this.isGui = opts.isGui ?? (() => false);
    this.focused = opts.focused ?? (() => globalThis.document?.activeElement ?? null);
    this.slotKey = opts.slotKey ?? (() => false);
    this.inGame = opts.inGame ?? (() => true);
  }

  setTable(table: BindingTable): void {
    this.table = table;
  }

  /** Suspends game input (the rebinding prompt reads raw keys); holds are released. */
  setEnabled(on: boolean): void {
    if (!on) this.releaseAll();
    this.enabled = on;
  }

  pointer(): { x: number; y: number; target: Element | null } {
    return { x: this.x, y: this.y, target: this.overEl };
  }

  /** Whether a physical input is down ('Shift', 'Mouse0', 'KeyW' …). */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  attach(win: Window): void {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      f: (e: WindowEventMap[K]) => void,
      opts: AddEventListenerOptions = { capture: true },
    ) => {
      win.addEventListener(type, f as EventListener, opts);
      this.off.push(() => win.removeEventListener(type, f as EventListener, opts));
    };
    on('keydown', (e) => this.keydown(e));
    on('keyup', (e) => this.keyup(e));
    on('pointerdown', (e) => this.pointerdown(e));
    on('pointerup', (e) => this.pointerup(e));
    on('pointermove', (e) => this.pointermove(e));
    on('wheel', (e) => this.wheel(e), { capture: true, passive: false });
    on('contextmenu', (e) => {
      if (!isTextField(e.target as Element)) e.preventDefault();
    });
    on('auxclick', (e) => {
      if (e.button !== 0) e.preventDefault();
    });
    on('mouseup', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    // A button pressed with the mouse does not take the focus (the keyboard's Space and Enter stay the game's);
    // fields and lists do. Tab reaches every control.
    on('mousedown', (e) => {
      const t = e.target as Element | null;
      if (t?.closest?.('button') && !t.closest('select, input, textarea, label')) e.preventDefault();
    });
    on('dragstart', (e) => {
      if (!isTextField(e.target as Element)) e.preventDefault();
    });
    on('blur', () => this.releaseAll(), {});
    on('compositionstart', () => {
      this.composition = true;
    });
    on('compositionend', () => {
      this.composition = false;
    });
    const doc = win.document;
    const vis = () => {
      if (doc.visibilityState === 'hidden') this.releaseAll();
    };
    doc.addEventListener('visibilitychange', vis);
    this.off.push(() => doc.removeEventListener('visibilitychange', vis));
    const fs = () => {
      const kb = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
      if (doc.fullscreenElement && kb?.lock) kb.lock().catch(() => undefined);
    };
    doc.addEventListener('fullscreenchange', fs);
    this.off.push(() => doc.removeEventListener('fullscreenchange', fs));
  }

  detach(): void {
    for (const f of this.off.splice(0)) f();
  }

  /** Releases every held control (blur, a hidden page, a disabled core). */
  releaseAll(): void {
    const ev = this.event('', 0, null);
    for (const [code, control] of this.down)
      if (control !== null) this.sink.release(control, { ...ev, code });
    this.down.clear();
    this.wheelAcc = 0;
    this.sink.releaseAll();
  }

  private modsOf(e: ModsLike): number {
    let m = 0;
    if (e.ctrlKey || (this.mac && e.metaKey)) m |= CTRL;
    if (e.shiftKey) m |= SHIFT;
    if (e.altKey) m |= ALT;
    return m;
  }

  private event(code: string, mods: number, target: Element | null): InputEvent {
    return { code, mods, x: this.x, y: this.y, target };
  }

  /** The key's code in the bindings' namespace and its modifiers without its own bit. */
  private keyCode(e: KeyLike): { code: string; mods: number } {
    let code = MODIFIER_CODES[e.code] ?? e.code;
    let mods = this.modsOf(e);
    if (code === 'Meta') code = this.mac ? 'Ctrl' : 'Meta';
    const bit = MOD_BIT[code];
    if (bit !== undefined) mods &= ~bit;
    return { code, mods };
  }

  /** Presses an input: the sink acts on the first control that applies; a hold stays active until release. */
  private pressInput(code: string, mods: number, matches: Match[], target: Element | null): void {
    const chosen = matches.length > 0 ? this.sink.press(matches, this.event(code, mods, target)) : null;
    const hold = chosen !== null && matches.some((m) => m.control.id === chosen && m.control.hold);
    this.down.set(code, hold ? chosen : null);
  }

  keydown(e: KeyLike): void {
    // An IME's keys (candidate selection, its committing Enter) are the text field's alone.
    if (this.composition || composing(e)) return;
    const { code, mods } = this.keyCode(e);
    const focused = this.focused();
    if (isTextField(focused)) {
      const passes =
        code === 'Escape' ||
        code === 'Enter' ||
        code === 'NumpadEnter' ||
        code === 'Tab' ||
        (code === 'KeyF' && mods === CTRL);
      if (passes && !e.repeat && this.enabled && this.sink.textKey(code, mods, focused)) e.preventDefault();
      return;
    }
    // A focused GUI control keeps the keys of keyboard navigation; a slot answers Enter and the arrows.
    if (!gameFocus(focused) && focused && NAVIGATION.has(code)) {
      if (this.enabled && !e.repeat && focused.closest('[data-slot]') && this.slotKey(focused, code, mods))
        e.preventDefault();
      return;
    }
    const matches = this.table.match(code, mods);
    this.capture(e, code, mods, matches.length > 0);
    if (!this.enabled || e.repeat) return;
    if (this.down.has(code)) return;
    this.pressInput(code, mods, matches, focused);
  }

  private capture(e: KeyLike, code: string, mods: number, bound: boolean): void {
    if (code === 'F11' || code === 'F12') return; // fullscreen and devtools stay the browser's
    if (GAME_ONLY.has(code) && mods === 0 && !this.inGame()) return; // the menus' focus traversal
    if (
      bound ||
      ALWAYS_CAPTURED.has(code) ||
      code === 'Alt' ||
      (mods & ALT) !== 0 ||
      ((mods & CTRL) !== 0 && CTRL_CAPTURED.has(code))
    )
      e.preventDefault();
  }

  keyup(e: KeyLike): void {
    const { code, mods } = this.keyCode(e);
    if (code === 'Alt') e.preventDefault(); // Firefox's menu bar shows on Alt's keyup (I §1.5)
    const held = this.down.get(code);
    this.down.delete(code);
    if (!this.enabled) return;
    if (held) this.sink.release(held, this.event(code, mods, this.focused()));
  }

  pointerdown(e: PointerLike): void {
    this.x = e.clientX;
    this.y = e.clientY;
    this.overEl = e.target as Element | null;
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault(); // autoscroll, X11 paste, history
    if (!this.enabled) return;
    const code = `Mouse${e.button}`;
    if (this.down.has(code)) return;
    // Buttons, tabs and fields of the GUI handle their own clicks; slots and the world go through the bindings.
    const mods = this.modsOf(e);
    this.pressInput(code, mods, this.table.match(code, mods), this.overEl);
  }

  pointerup(e: PointerLike): void {
    this.x = e.clientX;
    this.y = e.clientY;
    const code = `Mouse${e.button}`;
    const held = this.down.get(code);
    this.down.delete(code);
    if (held && this.enabled)
      this.sink.release(held, this.event(code, this.modsOf(e), e.target as Element | null));
  }

  pointermove(e: PointerLike): void {
    this.x = e.clientX;
    this.y = e.clientY;
    this.overEl = e.target as Element | null;
    if (this.enabled) this.sink.move(this.x, this.y, this.overEl);
  }

  wheel(e: WheelLike): void {
    const target = e.target as Element | null;
    const ctrl = e.ctrlKey || (this.mac && e.metaKey);
    if (this.isGui(target)) {
      if (ctrl) e.preventDefault(); // never the browser's zoom
      return; // a scroll pane scrolls; the GUI has no wheel controls in M0
    }
    e.preventDefault();
    if (!this.enabled) return;
    this.x = e.clientX;
    this.y = e.clientY;
    const page = (globalThis as { innerHeight?: number }).innerHeight ?? 800;
    const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? page : 1;
    const dy = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) || !e.shiftKey ? e.deltaY : e.deltaX) * scale;
    if (this.wheelAcc !== 0 && Math.sign(dy) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelAcc += dy;
    // A trackpad pinch arrives as Ctrl+Wheel: it zooms like the plain wheel unless Ctrl+Wheel is bound (I §1.5).
    let mods = this.modsOf(e);
    while (Math.abs(this.wheelAcc) >= NOTCH_PX) {
      const code = this.wheelAcc < 0 ? 'WheelUp' : 'WheelDown';
      this.wheelAcc -= Math.sign(this.wheelAcc) * NOTCH_PX;
      let matches = this.table.match(code, mods);
      if (matches.length === 0 && ctrl) {
        mods &= ~CTRL;
        matches = this.table.match(code, mods);
      }
      if (matches.length > 0) this.sink.press(matches, this.event(code, mods, target));
    }
  }
}
