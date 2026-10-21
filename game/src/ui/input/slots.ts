// What a GUI element under the pointer is, for the resolver's GUI context (I §1.4): inventory, recipe, crafting
// queue and quickbar slots register a descriptor on their element; any other element inside a panel is plain GUI
// (its own click handlers act). Slot clicks go through the binding table, so the inventory and crafting controls
// (`pick-item`, `stack-transfer`, `craft-5` …) are rebindable like every other control.
import type { EntityRef } from '../../shared/gen/types.ts';

export type SlotRef =
  | {
      kind: 'inventory';
      /** Tag 0: the acting player's own main inventory. */
      owner: EntityRef;
      inv: number;
      index: number;
      /** The window's other inventory for Shift/Ctrl transfers (I §3.8), or null when there is none. */
      other: EntityRef | null;
      /** The slot's item key now (pipette, tooltips), 0xFFFF when empty. */
      key: () => number;
    }
  | { kind: 'recipe'; recipe: number }
  /** `index` is read when the slot is used: a queue slot's position moves as entries before it finish. */
  | { kind: 'queue'; readonly index: number }
  /** `index` follows the row's page (Shift+1…0 changes it under the same element, C5-r1 4). */
  | { kind: 'quickbar'; readonly index: number; key: () => number };

/**
 * A quickbar slot's descriptor (I §4.2): slot `i` of the row that shows page `page()` now. The row's page changes
 * under the same element (Shift+1…0, X), so the index is read when the slot is used (C5-r1 4).
 */
export function quickbarRef(page: () => number, i: number, key: () => number): SlotRef {
  return {
    kind: 'quickbar',
    get index() {
      return page() * 10 + i;
    },
    key,
  };
}

/** A crafting queue slot's descriptor: its position now (entries before it finish and leave). */
export function queueRef(index: () => number): SlotRef {
  return {
    kind: 'queue',
    get index() {
      return index();
    },
  };
}

const refs = new WeakMap<Element, SlotRef>();

export function registerSlot(el: Element, ref: SlotRef): void {
  refs.set(el, ref);
}

/** The slot descriptor of the element under the pointer (or of its slot ancestor). */
export function slotAt(el: Element | null): SlotRef | null {
  const s = el?.closest('[data-slot]');
  return s ? (refs.get(s) ?? null) : null;
}

/** Whether an element belongs to the GUI (a window, the HUD, a menu) rather than the world view. */
export function isGui(el: Element | null): boolean {
  return el?.closest('[data-gui]') != null;
}

/**
 * Moves the keyboard focus from a slot to its neighbour (C5-r1 17): left and right through the grid's order, up and
 * down to the slot nearest in the row above or below (geometry, so ragged recipe rows work), Home and End to the
 * row's ends. The slots of one grid share a `[data-slot-grid]` ancestor (else their parent). The focused slot is
 * the grid's tab stop (a roving tabindex). A layout read per key press, never in a frame.
 */
export function gridMove(el: Element, code: string): boolean {
  const grid = el.closest('[data-slot-grid]') ?? el.parentElement;
  if (!grid) return false;
  const slots = [...grid.querySelectorAll<HTMLElement>('[data-slot]')];
  const i = slots.indexOf(el as HTMLElement);
  if (i < 0) return false;
  const rects = slots.map((x) => x.getBoundingClientRect());
  const me = rects[i] as DOMRect;
  const cy = me.top + me.height / 2;
  const sameRow = (r: DOMRect) => Math.abs(r.top + r.height / 2 - cy) < me.height / 2;
  let j = -1;
  if (code === 'ArrowLeft') j = i - 1;
  else if (code === 'ArrowRight') j = i + 1;
  else if (code === 'Home' || code === 'End') {
    const row = slots.map((_, k) => k).filter((k) => sameRow(rects[k] as DOMRect));
    j = code === 'Home' ? (row[0] ?? i) : (row[row.length - 1] ?? i);
  } else if (code === 'ArrowUp' || code === 'ArrowDown') {
    const down = code === 'ArrowDown';
    let best = Number.POSITIVE_INFINITY;
    rects.forEach((r, k) => {
      const dy = r.top + r.height / 2 - cy;
      if (down ? dy < me.height / 2 : dy > -me.height / 2) return;
      const d = Math.abs(dy) * 1000 + Math.abs(r.left - me.left);
      if (d < best) {
        best = d;
        j = k;
      }
    });
  } else return false;
  const next = slots[j];
  if (next) {
    (el as HTMLElement).tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }
  return true;
}

export const NONE_REF: EntityRef = { a: 0, b: 0, tag: 0 };
export const serialRef = (serial: number): EntityRef => ({ a: serial, b: 0, tag: 1 });
