//! Inventories (10 §4.5, §5.1; I §3.2, §3.8): views over slot-heap blocks and the rules that move items
//! (golden README rules 15–17). Free functions over the heap and the prototypes, so a rule can hold the
//! World's other fields while it moves items.
//!
//! - **Insertion** fills partial stacks of the key first, then empty slots, both in ascending slot order,
//!   below the inventory's limit bar and never into the hand's origin slot (rule 17).
//! - **Removal** takes from the highest slot down, past the bar and the origin slot too.
//! - **Auto-sort** rewrites every slot but the origin slot as the item totals in ascending key, full stacks
//!   first and at most one partial stack per key, packed from slot 0 (D11: the owner's own setting).
//!
//! Counts are `i64` here (a request can ask for 65,535 crafts of 8 ingredients); a slot holds at most a stack,
//! which fits its `i32`.

use crate::r#gen::Hand;
use crate::heap::{EMPTY_SLOT, SlotHeap};
use schema::{InvRef, ItemKey, Protos, Slot};

/// The `u16` "none" of slot indexes and prototype ids.
pub const NONE16: u16 = 0xFFFF;

/// The empty hand (types.yaml `Hand`): no key, no ghost, no origin, nothing held.
pub const EMPTY_HAND: Hand = Hand { key: ItemKey(0xFFFF), ghost: false, origin: NONE16, count: 0 };

/// An inventory as the rules see it: a block, its size, its limit bar and the slot reserved for the hand.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Inv {
    pub r: InvRef,
    pub size: u32,
    /// Slots from `bar` on take nothing by bulk means (rule 16); `size` when unlimited.
    pub bar: u32,
    /// The hand's origin slot (I §3.2): insertion and auto-sort skip it.
    pub origin: Option<u32>,
}

/// The hand's origin slot while it holds a stack picked from the main inventory.
pub fn hand_origin(h: &Hand) -> Option<u32> {
    (h.count > 0 && !h.ghost && h.origin != NONE16).then_some(u32::from(h.origin))
}

/// An item key's stack size (items.stack; the key is `(item id << 3) | quality`, §4.3).
pub fn stack_size(protos: &Protos, key: ItemKey) -> i64 {
    let item = usize::from(key.0 >> 3);
    let s = protos.item.stack_size.get(item).unwrap_or_else(|| panic!("no item for key {}", key.0));
    i64::from(*s)
}

/// The item key of item `id` at quality 0.
pub const fn key_of(id: u16) -> ItemKey {
    ItemKey(id << 3)
}

/// How many of `key` the inventory holds (every slot, the origin slot included).
pub fn count(heap: &SlotHeap, inv: &Inv, key: ItemKey) -> i64 {
    heap.block(inv.r)[..inv.size as usize].iter().filter(|s| s.key == key).map(|s| i64::from(s.count)).sum()
}

/// The smallest key above `after` (from the start for `None`) that a non-empty slot holds.
pub fn next_key(heap: &SlotHeap, inv: &Inv, after: Option<ItemKey>) -> Option<ItemKey> {
    let mut best: Option<ItemKey> = None;
    for s in &heap.block(inv.r)[..inv.size as usize] {
        if s.count > 0 && after.is_none_or(|a| s.key > a) && best.is_none_or(|b| s.key < b) {
            best = Some(s.key);
        }
    }
    best
}

/// Empties a slot (an empty slot is `{none, 0}` everywhere, rule 15).
pub fn clear(s: &mut Slot) {
    *s = EMPTY_SLOT;
}

/// How many of `n` items [`insert`] would place.
pub fn room(heap: &SlotHeap, protos: &Protos, inv: &Inv, key: ItemKey, n: i64) -> i64 {
    let stack = stack_size(protos, key);
    let slots = heap.block(inv.r);
    let mut left = n;
    for i in 0..inv.bar {
        if left <= 0 {
            break;
        }
        let s = slots[i as usize];
        if Some(i) != inv.origin && s.key == key && i64::from(s.count) < stack {
            left -= left.min(stack - i64::from(s.count));
        }
    }
    for i in 0..inv.bar {
        if left <= 0 {
            break;
        }
        if Some(i) != inv.origin && slots[i as usize].count == 0 {
            left -= left.min(stack);
        }
    }
    n - left
}

/// Inserts up to `n` items of `key` (rule 17's order); returns how many it placed.
pub fn insert(heap: &mut SlotHeap, protos: &Protos, inv: &Inv, key: ItemKey, n: i64) -> i64 {
    let stack = stack_size(protos, key);
    let slots = heap.block_mut(inv.r);
    let mut left = n;
    for i in 0..inv.bar {
        if left <= 0 {
            break;
        }
        let s = &mut slots[i as usize];
        if Some(i) != inv.origin && s.key == key && i64::from(s.count) < stack {
            let k = left.min(stack - i64::from(s.count));
            s.count += k as i32;
            left -= k;
        }
    }
    for i in 0..inv.bar {
        if left <= 0 {
            break;
        }
        let s = &mut slots[i as usize];
        if Some(i) != inv.origin && s.count == 0 {
            let k = left.min(stack);
            *s = Slot { key, count: k as i32 };
            left -= k;
        }
    }
    n - left
}

/// Removes up to `n` items of `key` from the highest slot down (locked and origin slots included); returns
/// how many it removed.
pub fn remove(heap: &mut SlotHeap, inv: &Inv, key: ItemKey, n: i64) -> i64 {
    let slots = heap.block_mut(inv.r);
    let mut left = n;
    for i in (0..inv.size as usize).rev() {
        if left <= 0 {
            break;
        }
        let s = &mut slots[i];
        if s.key != key || s.count == 0 {
            continue;
        }
        let k = left.min(i64::from(s.count));
        s.count -= k as i32;
        left -= k;
        if s.count == 0 {
            clear(s);
        }
    }
    n - left
}

/// Auto-sort of a main inventory of `size` slots in block `r` (rule 17): `totals` is scratch.
pub fn sort_block(
    heap: &mut SlotHeap,
    protos: &Protos,
    r: InvRef,
    size: u32,
    origin: Option<u32>,
    totals: &mut Vec<(ItemKey, i64)>,
) {
    let slots = heap.block_mut(r);
    totals.clear();
    for i in 0..size {
        if Some(i) == origin {
            continue;
        }
        let s = &mut slots[i as usize];
        if s.count > 0 {
            totals.push((s.key, i64::from(s.count)));
        }
        clear(s);
    }
    totals.sort_unstable_by_key(|x| x.0);
    let mut i = 0u32;
    let mut j = 0usize;
    while j < totals.len() {
        let key = totals[j].0;
        let mut n = 0i64;
        while j < totals.len() && totals[j].0 == key {
            n += totals[j].1;
            j += 1;
        }
        let stack = stack_size(protos, key);
        while n > 0 {
            if Some(i) == origin {
                i += 1;
            }
            let c = n.min(stack);
            slots[i as usize] = Slot { key, count: c as i32 };
            n -= c;
            i += 1;
        }
    }
}

/// A copy of a main inventory and its hand, to tell whether a step changed them (golden rule 14). Its buffer
/// is kept, so taking a snapshot allocates nothing once warm.
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    hand: Hand,
    slots: Vec<Slot>,
}

impl Snapshot {
    pub fn take(&mut self, heap: &SlotHeap, main: InvRef, size: u32, hand: &Hand) {
        self.hand = *hand;
        self.slots.clear();
        self.slots.extend_from_slice(&heap.block(main)[..size as usize]);
    }

    /// Whether the inventory or the hand differs from the snapshot.
    pub fn differs(&self, heap: &SlotHeap, main: InvRef, size: u32, hand: &Hand) -> bool {
        self.hand != *hand || self.slots[..] != heap.block(main)[..size as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heap_with(slots: u32) -> (SlotHeap, InvRef) {
        let mut h = SlotHeap::new();
        let r = h.alloc(slots);
        (h, r)
    }

    fn protos() -> Protos {
        let mut p = Protos::default();
        p.item.stack_size = vec![50, 100];
        p
    }

    #[test]
    fn insertion_tops_up_then_fills_below_the_bar_and_skips_the_origin() {
        let p = protos();
        let (mut h, r) = heap_with(4);
        let k = key_of(1);
        h.block_mut(r)[2] = Slot { key: k, count: 90 };
        let inv = Inv { r, size: 4, bar: 3, origin: Some(0) };
        assert_eq!(room(&h, &p, &inv, k, 500), 110);
        assert_eq!(insert(&mut h, &p, &inv, k, 500), 110);
        let b = h.block(r);
        assert_eq!(b[0], EMPTY_SLOT, "the origin slot is reserved");
        assert_eq!((b[1].count, b[2].count, b[3].count), (100, 100, 0), "slot 3 lies past the bar");
        assert_eq!(remove(&mut h, &Inv { origin: None, ..inv }, k, 150), 150);
        assert_eq!((h.block(r)[1].count, h.block(r)[2]), (50, EMPTY_SLOT), "removal takes the highest first");
    }

    #[test]
    fn sorting_packs_full_stacks_first_around_the_origin() {
        let p = protos();
        let (mut h, r) = heap_with(4);
        let (a, b) = (key_of(0), key_of(1));
        h.block_mut(r).copy_from_slice(&[
            Slot { key: b, count: 30 },
            Slot { key: a, count: 20 },
            EMPTY_SLOT,
            Slot { key: a, count: 40 },
        ]);
        let mut scratch = Vec::new();
        sort_block(&mut h, &p, r, 4, Some(0), &mut scratch);
        assert_eq!(
            h.block(r),
            &[Slot { key: b, count: 30 }, Slot { key: a, count: 50 }, Slot { key: a, count: 10 }, EMPTY_SLOT]
        );
        assert_eq!(next_key(&h, &Inv { r, size: 4, bar: 4, origin: None }, Some(a)), Some(b));
    }
}
