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
  | { kind: 'queue'; index: number }
  | { kind: 'quickbar'; index: number; key: () => number };

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

export const NONE_REF: EntityRef = { a: 0, b: 0, tag: 0 };
export const serialRef = (serial: number): EntityRef => ({ a: serial, b: 0, tag: 1 });
