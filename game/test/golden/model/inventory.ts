// Inventories (10 §4.5, §5.1; I §3.2, §3.8): views over slot-heap blocks and the rules that move items.
// Every rule here is a model decision where I §3.8 leaves the detail open; README.md ("Rules the golden set
// fixes") lists them.
import type { EntityTableRow } from '../../../src/shared/gen/pools.ts';
import type { Hand, Player } from '../../../src/shared/gen/state.ts';
import type { Slot } from '../../../src/shared/gen/types.ts';
import { NO_ITEM, NONE16, type World } from './world.ts';

/** An inventory as the rules see it: a block, its size, its limit bar and the slot reserved for the hand. */
export interface Inv {
  ref: number;
  size: number;
  /** Slots from `bar` on are locked: nothing is inserted there by any means (model decision). */
  bar: number;
  /** The hand's origin slot (I §3.2): incoming items and auto-sort skip it; −1 for none. */
  origin: number;
}

export const EMPTY_HAND: Readonly<Hand> = { key: NO_ITEM, ghost: false, origin: NONE16, count: 0 };

export function emptyHand(): Hand {
  return { ...EMPTY_HAND };
}

/** The hand's origin slot while it holds a stack picked from the main inventory, else −1. */
export function handOrigin(p: Player): number {
  return p.hand.count > 0 && !p.hand.ghost && p.hand.origin !== NONE16 ? p.hand.origin : -1;
}

export function mainInv(w: World, p: Player): Inv {
  return { ref: p.main, size: w.mainSize(), bar: w.mainSize(), origin: handOrigin(p) };
}

export function chestInv(w: World, e: EntityTableRow): Inv {
  const size = (w.protos.entity[e.proto] as { inventory_slots: number }).inventory_slots;
  const ref = w.container(e).inv;
  return { ref, size, bar: w.heap.bar(ref, size), origin: -1 };
}

/** An item key's stack size (items.stack; the key is (item id << 3) | quality, §4.3). */
export function stackSize(w: World, key: number): number {
  const item = w.protos.item[key >> 3];
  if (!item) throw new Error(`no item for key ${key}`);
  return item.stack_size;
}

export function slots(w: World, inv: Inv): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < inv.size; i++) out.push(w.heap.slot(inv.ref, i));
  return out;
}

/** How many of `key` the inventory holds (every slot, the origin slot included). */
export function count(w: World, inv: Inv, key: number): number {
  let n = 0;
  for (const s of slots(w, inv)) if (s.key === key) n += s.count;
  return n;
}

/** The keys the inventory holds, ascending. */
export function keys(w: World, inv: Inv): number[] {
  const ks = new Set<number>();
  for (const s of slots(w, inv)) if (s.count > 0) ks.add(s.key);
  return [...ks].sort((a, b) => a - b);
}

/** Empties a slot (an empty slot is `{key: none, count: 0}`). */
export function clear(s: Slot): void {
  s.key = NO_ITEM;
  s.count = 0;
}

/**
 * How many of `n` items `insert` would place: partial stacks of the key first, then empty slots, both in
 * ascending slot order, below the bar and never in the origin slot (model decision; I §3.2, §3.8).
 */
export function room(w: World, inv: Inv, key: number, n: number): number {
  const stack = stackSize(w, key);
  let left = n;
  for (let i = 0; i < inv.bar && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = w.heap.slot(inv.ref, i);
    if (s.key === key && s.count < stack) left -= Math.min(left, stack - s.count);
  }
  for (let i = 0; i < inv.bar && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = w.heap.slot(inv.ref, i);
    if (s.count === 0) left -= Math.min(left, stack);
  }
  return n - left;
}

/** Inserts up to `n` items of `key` (the order of `room`); returns how many it placed. */
export function insert(w: World, inv: Inv, key: number, n: number): number {
  const stack = stackSize(w, key);
  let left = n;
  for (let i = 0; i < inv.bar && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = w.heap.slot(inv.ref, i);
    if (s.key === key && s.count < stack) {
      const k = Math.min(left, stack - s.count);
      s.count += k;
      left -= k;
    }
  }
  for (let i = 0; i < inv.bar && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = w.heap.slot(inv.ref, i);
    if (s.count === 0) {
      const k = Math.min(left, stack);
      s.key = key;
      s.count = k;
      left -= k;
    }
  }
  return n - left;
}

/**
 * Removes up to `n` items of `key`, from the highest slot down (model decision: full stacks stay, partial
 * ones go first in a sorted inventory); locked and origin slots included. Returns how many it removed.
 */
export function remove(w: World, inv: Inv, key: number, n: number): number {
  let left = n;
  for (let i = inv.size - 1; i >= 0 && left > 0; i--) {
    const s = w.heap.slot(inv.ref, i);
    if (s.key !== key || s.count === 0) continue;
    const k = Math.min(left, s.count);
    s.count -= k;
    left -= k;
    if (s.count === 0) clear(s);
  }
  return n - left;
}

/**
 * Auto-sort (I §3.8; D11: the player's own setting): every slot but the hand's origin slot is rewritten as
 * the item totals in ascending item key (the data stage's dense ids already follow group, subgroup and
 * order, C1a decision 19), full stacks first and at most one partial stack per key, packed from slot 0 and
 * skipping the origin slot, which keeps its place and content.
 */
export function sortMain(w: World, p: Player): void {
  if (!p.auto_sort) return;
  const inv = mainInv(w, p);
  const totals = new Map<number, number>();
  for (let i = 0; i < inv.size; i++) {
    if (i === inv.origin) continue;
    const s = w.heap.slot(inv.ref, i);
    if (s.count > 0) totals.set(s.key, (totals.get(s.key) ?? 0) + s.count);
    clear(s);
  }
  let i = 0;
  for (const key of [...totals.keys()].sort((a, b) => a - b)) {
    const stack = stackSize(w, key);
    let n = totals.get(key) as number;
    while (n > 0) {
      if (i === inv.origin) i++;
      const s = w.heap.slot(inv.ref, i);
      s.key = key;
      s.count = Math.min(n, stack);
      n -= s.count;
      i++;
    }
  }
}

/** A snapshot of the main inventory and the hand, to tell whether a step changed them (§4.8). */
export function fingerprint(w: World, p: Player): string {
  const inv = mainInv(w, p);
  const parts = [`${p.hand.key},${p.hand.ghost},${p.hand.origin},${p.hand.count}`];
  for (let i = 0; i < inv.size; i++) {
    const s = w.heap.slot(inv.ref, i);
    parts.push(`${s.key}:${s.count}`);
  }
  return parts.join(' ');
}
