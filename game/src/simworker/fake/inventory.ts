// The fake sim's inventories (10 §4.5, §5.1; I §3.2, §3.8): the same item-moving rules as the golden set's
// reference model (test/golden/model/inventory.ts), over the fake's plain slot arrays. The model is the
// authority; these are its rules restated, so the UI learns the real semantics from the fake.

/** A slot: an item key ((id << 3) | quality) and a count; an empty slot is `{key: none, count: 0}`. */
export interface Slot {
  key: number;
  count: number;
}

export const NO_ITEM = 0xffff;

/** An inventory as the rules see it: its slots, its limit bar and the slot reserved for the hand. */
export interface Inv {
  slots: Slot[];
  /** Slots from `bar` on are limited (set_inventory_bar); `slots.length` when unlimited. */
  bar: number;
  /** The hand's origin slot (I §3.2): incoming items and auto-sort skip it; −1 for none. */
  origin: number;
}

export function emptySlots(n: number): Slot[] {
  return Array.from({ length: n }, () => ({ key: NO_ITEM, count: 0 }));
}

export function clear(s: Slot): void {
  s.key = NO_ITEM;
  s.count = 0;
}

/** How many of `key` the inventory holds (every slot, the origin slot included). */
export function count(inv: Inv, key: number): number {
  let n = 0;
  for (const s of inv.slots) if (s.key === key) n += s.count;
  return n;
}

/** The keys the inventory holds, ascending. */
export function keys(inv: Inv): number[] {
  const ks = new Set<number>();
  for (const s of inv.slots) if (s.count > 0) ks.add(s.key);
  return [...ks].sort((a, b) => a - b);
}

/**
 * How many of `n` items `insert` would place: partial stacks of the key first, then empty slots, both in
 * ascending slot order, below `limit` (the bar, or the size when the bar does not apply) and never in the
 * origin slot.
 */
export function room(inv: Inv, key: number, n: number, stack: number, limit = inv.bar): number {
  let left = n;
  for (let i = 0; i < limit && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = inv.slots[i] as Slot;
    if (s.key === key && s.count > 0 && s.count < stack) left -= Math.min(left, stack - s.count);
  }
  for (let i = 0; i < limit && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = inv.slots[i] as Slot;
    if (s.count === 0) left -= Math.min(left, stack);
  }
  return n - left;
}

/** Inserts up to `n` items of `key` in `room`'s order; returns how many it placed. */
export function insert(inv: Inv, key: number, n: number, stack: number, limit = inv.bar): number {
  let left = n;
  for (let i = 0; i < limit && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = inv.slots[i] as Slot;
    if (s.key === key && s.count > 0 && s.count < stack) {
      const k = Math.min(left, stack - s.count);
      s.count += k;
      left -= k;
    }
  }
  for (let i = 0; i < limit && left > 0; i++) {
    if (i === inv.origin) continue;
    const s = inv.slots[i] as Slot;
    if (s.count === 0) {
      const k = Math.min(left, stack);
      s.key = key;
      s.count = k;
      left -= k;
    }
  }
  return n - left;
}

/** Removes up to `n` items of `key` from the highest slot down (limited and origin slots included). */
export function remove(inv: Inv, key: number, n: number): number {
  let left = n;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i] as Slot;
    if (s.key !== key || s.count === 0) continue;
    const k = Math.min(left, s.count);
    s.count -= k;
    left -= k;
    if (s.count === 0) clear(s);
  }
  return n - left;
}

/** Whether every one of `items` fits at once (tried on a copy; nothing changes). */
export function fitsAll(
  inv: Inv,
  items: readonly { key: number; n: number }[],
  stack: (key: number) => number,
): boolean {
  const copy: Inv = { slots: inv.slots.map((s) => ({ ...s })), bar: inv.bar, origin: inv.origin };
  for (const it of items) if (insert(copy, it.key, it.n, stack(it.key)) < it.n) return false;
  return true;
}

/**
 * Auto-sort (I §3.8; D11): every slot but the hand's origin slot becomes the item totals in ascending item
 * key, full stacks first and at most one partial stack per key, packed from slot 0, skipping the origin slot.
 */
export function sortSlots(inv: Inv, stack: (key: number) => number): void {
  const totals = new Map<number, number>();
  inv.slots.forEach((s, i) => {
    if (i === inv.origin) return;
    if (s.count > 0) totals.set(s.key, (totals.get(s.key) ?? 0) + s.count);
    clear(s);
  });
  let i = 0;
  for (const key of [...totals.keys()].sort((a, b) => a - b)) {
    let n = totals.get(key) as number;
    const size = stack(key);
    while (n > 0) {
      if (i === inv.origin) i++;
      const s = inv.slots[i] as Slot;
      s.key = key;
      s.count = Math.min(n, size);
      n -= s.count;
      i++;
    }
  }
}
