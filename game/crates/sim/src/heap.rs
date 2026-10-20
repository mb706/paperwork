//! The slot heap (10 §4.5): every inventory's slots, in one arena per size class.
//!
//! - **Classes** (golden README rule 15): class `c` holds blocks of `class_slots(c)` slots, the sequence
//!   1, 2, 4 … 128, then multiples of 64 (192, 256 …). An inventory owns one block of the smallest class that
//!   holds it, named by `InvRef = (class << 24) | block` (types.yaml `InvRef`).
//! - **Allocation** takes the lowest free block of the class, else a new block at the arena's high-water mark,
//!   so the free state is a function of the live inventories and the saved high-water marks (§4.5, D8).
//! - **Freed blocks are zeroed**: every slot of a free block is the empty slot `{key: none, count: 0}`, the same
//!   as an empty slot of a live block, and a free block has no limit bar and no filters.
//! - **Limit bars and filters** are sparse lists beside the arenas, sorted by `InvRef` (and slot).
//!
//! Ownership is derived (§8.1): the World rebuilds it on load from the containers' and players' `InvRef`s.
//!
//! **Inventory versions** (§15.5 "Source revisions"): every block carries a revision counter, raised by every
//! change to its slots, limit bar or filters. They are presentation fields (§4.5): never saved, hashed or
//! compared, read only by extraction to skip rebuilding an unchanged inventory's records.

use crate::r#gen::{InvBar, SlotArena, SlotFilter, SlotHeap as SlotHeapRecord};
use schema::codec::{EResult, Fixed, Writer};
use schema::{InvRef, ItemKey, Slot};

/// The empty slot (types.yaml `Slot`: count 0 means empty, and an empty slot's key is `ItemKey` none).
pub const EMPTY_SLOT: Slot = Slot { key: ItemKey(0xFFFF), count: 0 };

/// The largest class: `class_slots(255)` = 16,000 slots.
pub const MAX_CLASS: u8 = 255;

/// Slots per block of class `c` (rule 15).
pub const fn class_slots(c: u8) -> u32 {
    if c <= 7 { 1 << c } else { 128 + 64 * (c as u32 - 7) }
}

/// The smallest class whose blocks hold `slots` slots (at most 16,000).
pub fn class_for(slots: u32) -> Option<u8> {
    (0..=MAX_CLASS).find(|&c| class_slots(c) >= slots)
}

pub const fn inv_ref(class: u8, block: u32) -> InvRef {
    InvRef(((class as u32) << 24) | (block & 0x00FF_FFFF))
}

pub const fn inv_class(r: InvRef) -> u8 {
    (r.0 >> 24) as u8
}

pub const fn inv_block(r: InvRef) -> u32 {
    r.0 & 0x00FF_FFFF
}

/// One size class: `blocks` blocks of `block_slots` slots, block-major.
#[derive(Clone, Debug, Default, PartialEq)]
struct Arena {
    block_slots: u32,
    /// The high-water mark: blocks ever used (saved).
    blocks: u32,
    slots: Vec<Slot>,
    /// Derived: one bit per owned block.
    owned: Vec<u32>,
    /// Derived: the lowest block that may be free (an allocation hint).
    first_free: u32,
    /// Presentation: each block's inventory version.
    versions: Versions,
}

/// The blocks' inventory versions, one per block. Presentation state (§4.5): equal whatever they hold, so two
/// heaps with the same canonical content compare equal.
#[derive(Clone, Debug, Default)]
struct Versions(Vec<u32>);

impl PartialEq for Versions {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

impl Versions {
    fn raise(&mut self, b: u32) {
        if let Some(v) = self.0.get_mut(b as usize) {
            *v = v.wrapping_add(1);
        }
    }
}

impl Arena {
    fn is_owned(&self, b: u32) -> bool {
        self.owned.get(b as usize / 32).is_some_and(|w| w & (1 << (b % 32)) != 0)
    }

    fn set_owned(&mut self, b: u32, on: bool) {
        let w = b as usize / 32;
        if self.owned.len() <= w {
            self.owned.resize(w + 1, 0);
        }
        if on {
            self.owned[w] |= 1 << (b % 32);
        } else {
            self.owned[w] &= !(1 << (b % 32));
        }
    }
}

/// Why a heap or an `InvRef` was refused at load.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeapError(pub String);

/// The slot heap.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SlotHeap {
    /// Indexed by class; an arena with `blocks == 0` was never used.
    arenas: Vec<Arena>,
    /// One entry per limited inventory, ascending by `inv`.
    bars: Vec<InvBar>,
    /// Ascending by `(inv, slot)`, one per slot.
    filters: Vec<SlotFilter>,
}

impl SlotHeap {
    pub fn new() -> Self {
        Self::default()
    }

    fn arena(&self, r: InvRef) -> &Arena {
        let a = self.arenas.get(usize::from(inv_class(r))).filter(|a| inv_block(r) < a.blocks);
        a.unwrap_or_else(|| panic!("no slot-heap block {:#x}", r.0))
    }

    /// Whether `r` names a block of the heap (owned or not).
    pub fn exists(&self, r: InvRef) -> bool {
        self.arenas.get(usize::from(inv_class(r))).is_some_and(|a| inv_block(r) < a.blocks)
    }

    /// Whether a live inventory owns `r`.
    pub fn is_owned(&self, r: InvRef) -> bool {
        self.exists(r) && self.arena(r).is_owned(inv_block(r))
    }

    /// Whether [`Self::alloc`] would succeed for `slots` slots: a class holds them, and the class has a free block
    /// or room for a new one (2²⁴ blocks per class).
    pub fn can_alloc(&self, slots: u32) -> bool {
        let Some(class) = class_for(slots) else {
            return false;
        };
        match self.arenas.get(usize::from(class)) {
            None => true,
            Some(a) => a.blocks < 1 << 24 || (a.first_free..a.blocks).any(|b| !a.is_owned(b)),
        }
    }

    /// Allocates the lowest free block of the smallest class holding `slots` slots; its slots are empty.
    pub fn alloc(&mut self, slots: u32) -> InvRef {
        let class = class_for(slots).unwrap_or_else(|| panic!("no slot-heap class holds {slots} slots"));
        let ci = usize::from(class);
        if self.arenas.len() <= ci {
            self.arenas.resize_with(ci + 1, Arena::default);
        }
        let a = &mut self.arenas[ci];
        a.block_slots = class_slots(class);
        let mut b = a.first_free;
        while b < a.blocks && a.is_owned(b) {
            b += 1;
        }
        if b == a.blocks {
            assert!(b < 1 << 24, "slot-heap class {class} is full");
            a.blocks += 1;
            let n = a.block_slots as usize;
            a.slots.resize(a.slots.len() + n, EMPTY_SLOT);
            a.versions.0.push(0);
        }
        a.set_owned(b, true);
        a.versions.raise(b);
        a.first_free = b + 1;
        inv_ref(class, b)
    }

    /// Frees a block: its slots become empty and its bar and filters go (§4.5: freed blocks are zeroed).
    pub fn free(&mut self, r: InvRef) {
        let block = inv_block(r);
        let a = &mut self.arenas[usize::from(inv_class(r))];
        assert!(block < a.blocks && a.is_owned(block), "freeing a block no inventory owns: {:#x}", r.0);
        let n = a.block_slots as usize;
        let base = block as usize * n;
        a.slots[base..base + n].fill(EMPTY_SLOT);
        a.set_owned(block, false);
        a.versions.raise(block);
        if block < a.first_free {
            a.first_free = block;
        }
        self.bars.retain(|x| x.inv != r);
        self.filters.retain(|x| x.inv != r);
    }

    /// The block's slots (its whole class size; an inventory uses the first `size` of them).
    pub fn block(&self, r: InvRef) -> &[Slot] {
        let a = self.arena(r);
        let n = a.block_slots as usize;
        let base = inv_block(r) as usize * n;
        &a.slots[base..base + n]
    }

    /// The block's slots to change; raises its inventory version.
    pub fn block_mut(&mut self, r: InvRef) -> &mut [Slot] {
        let block = inv_block(r);
        let a = self.arenas.get_mut(usize::from(inv_class(r))).filter(|a| block < a.blocks);
        let a = a.unwrap_or_else(|| panic!("no slot-heap block {:#x}", r.0));
        a.versions.raise(block);
        let n = a.block_slots as usize;
        let base = block as usize * n;
        &mut a.slots[base..base + n]
    }

    /// The inventory version of block `r` (§15.5): it changes whenever the block's slots, bar or filters may have;
    /// 0 for a block the heap does not have.
    pub fn version(&self, r: InvRef) -> u32 {
        self.arenas
            .get(usize::from(inv_class(r)))
            .map_or(0, |a| a.versions.0.get(inv_block(r) as usize).copied().unwrap_or(0))
    }

    /// The limit bar of `r`: slots from it on are limited (§4.5; rule 16); `None` when unlimited.
    pub fn bar(&self, r: InvRef) -> Option<u16> {
        self.bars.binary_search_by(|x| x.inv.cmp(&r)).ok().map(|i| self.bars[i].bar)
    }

    /// Sets or clears the limit bar of `r`. The caller keeps the canonical form: no entry when the bar is at
    /// or above the inventory's size (golden model decision: unlimited = no entry).
    pub fn set_bar(&mut self, r: InvRef, bar: Option<u16>) {
        self.raise(r);
        match (self.bars.binary_search_by(|x| x.inv.cmp(&r)), bar) {
            (Ok(i), Some(b)) => self.bars[i].bar = b,
            (Ok(i), None) => {
                self.bars.remove(i);
            }
            (Err(i), Some(b)) => self.bars.insert(i, InvBar { inv: r, bar: b }),
            (Err(_), None) => {}
        }
    }

    /// The filters of `r`, ascending by slot.
    pub fn filters(&self, r: InvRef) -> &[SlotFilter] {
        let lo = self.filters.partition_point(|x| x.inv < r);
        let hi = self.filters.partition_point(|x| x.inv <= r);
        &self.filters[lo..hi]
    }

    /// Sets (`Some`) or clears the filter of slot `slot` of `r`.
    pub fn set_filter(&mut self, r: InvRef, slot: u16, key: Option<ItemKey>) {
        self.raise(r);
        let at = self.filters.binary_search_by(|x| (x.inv, x.slot).cmp(&(r, slot)));
        match (at, key) {
            (Ok(i), Some(k)) => self.filters[i].key = k,
            (Ok(i), None) => {
                self.filters.remove(i);
            }
            (Err(i), Some(k)) => self.filters.insert(i, SlotFilter { inv: r, slot, key: k }),
            (Err(_), None) => {}
        }
    }

    fn raise(&mut self, r: InvRef) {
        if let Some(a) = self.arenas.get_mut(usize::from(inv_class(r))) {
            a.versions.raise(inv_block(r));
        }
    }

    /// Every slot of class `c`'s arena, block-major (what `SLOT_HEAP` saves; empty for a class never used).
    pub fn arena_slots(&self, c: u8) -> &[Slot] {
        self.arenas.get(usize::from(c)).map_or(&[], |a| a.slots.as_slice())
    }

    /// Every limit bar, ascending by inventory.
    pub fn all_bars(&self) -> &[InvBar] {
        &self.bars
    }

    /// Every filter, ascending by inventory and slot.
    pub fn all_filters(&self) -> &[SlotFilter] {
        &self.filters
    }

    /// The classes in use (`blocks > 0`), ascending, with their block size and high-water mark.
    pub fn classes(&self) -> impl Iterator<Item = (u8, u32, u32)> + '_ {
        self.arenas
            .iter()
            .enumerate()
            .filter(|(_, a)| a.blocks > 0)
            .map(|(c, a)| (c as u8, a.block_slots, a.blocks))
    }

    /// The `SLOT_HEAP` record (§8.1): the arenas in use, ascending by class, then the sparse lists.
    pub fn to_record(&self) -> SlotHeapRecord {
        SlotHeapRecord {
            arenas: self
                .classes()
                .map(|(c, slots, blocks)| SlotArena {
                    class: c,
                    block_slots: slots as u16,
                    blocks,
                    slots: self.arenas[usize::from(c)].slots.clone(),
                })
                .collect(),
            filters: self.filters.clone(),
            bars: self.bars.clone(),
        }
    }

    /// Rebuilds the heap from its record and the `InvRef`s live inventories own. Refuses what the record
    /// cannot mean: an arena whose block size or slot count is not its class's, an unused arena (saving drops
    /// those, so the bytes would not round-trip), a reference to a missing block or to one block twice, a
    /// free block that is not zeroed, a limit bar or filter on a free block or past its block.
    pub fn from_record(rec: SlotHeapRecord, owners: &[InvRef]) -> Result<Self, HeapError> {
        let err = |m: String| Err(HeapError(m));
        let mut h = Self::default();
        for a in rec.arenas {
            if a.blocks == 0 {
                return err(format!("slot-heap class {} has no blocks", a.class));
            }
            if u32::from(a.block_slots) != class_slots(a.class) {
                return err(format!("slot-heap class {} has {}-slot blocks", a.class, a.block_slots));
            }
            if a.slots.len() as u64 != u64::from(a.blocks) * u64::from(a.block_slots) || a.blocks >= 1 << 24 {
                return err(format!(
                    "slot-heap class {}: {} slots for {} blocks",
                    a.class,
                    a.slots.len(),
                    a.blocks
                ));
            }
            if let Some(s) =
                a.slots.iter().find(|s| (s.count == 0) != (s.key == EMPTY_SLOT.key) || s.count < 0)
            {
                return err(format!(
                    "slot-heap class {}: slot {:?} is neither empty nor a stack",
                    a.class, s
                ));
            }
            let ci = usize::from(a.class);
            if h.arenas.len() <= ci {
                h.arenas.resize_with(ci + 1, Arena::default);
            }
            h.arenas[ci] = Arena {
                block_slots: u32::from(a.block_slots),
                blocks: a.blocks,
                slots: a.slots,
                owned: vec![0; (a.blocks as usize).div_ceil(32)],
                first_free: 0,
                versions: Versions(vec![0; a.blocks as usize]),
            };
        }
        for &r in owners {
            if !h.exists(r) {
                return err(format!("an inventory names the missing slot-heap block {:#x}", r.0));
            }
            let a = &mut h.arenas[usize::from(inv_class(r))];
            if a.is_owned(inv_block(r)) {
                return err(format!("two inventories own the slot-heap block {:#x}", r.0));
            }
            a.set_owned(inv_block(r), true);
        }
        for (c, a) in h.arenas.iter().enumerate() {
            let n = a.block_slots as usize;
            for b in 0..a.blocks {
                if !a.is_owned(b)
                    && a.slots[b as usize * n..(b as usize + 1) * n].iter().any(|s| *s != EMPTY_SLOT)
                {
                    return err(format!(
                        "the free slot-heap block {:#x} is not empty",
                        inv_ref(c as u8, b).0
                    ));
                }
            }
        }
        for x in &rec.bars {
            if !h.is_owned(x.inv) || u32::from(x.bar) >= h.arena(x.inv).block_slots {
                return err(format!(
                    "a limit bar on the block {:#x} that no inventory owns or past it",
                    x.inv.0
                ));
            }
        }
        if rec.bars.windows(2).any(|w| w[0].inv >= w[1].inv) {
            return err("two limit bars for one inventory".to_owned());
        }
        for x in &rec.filters {
            if !h.is_owned(x.inv) || u32::from(x.slot) >= h.arena(x.inv).block_slots {
                return err(format!(
                    "a filter on the block {:#x} that no inventory owns or past it",
                    x.inv.0
                ));
            }
        }
        if rec.filters.windows(2).any(|w| (w[0].inv, w[0].slot) >= (w[1].inv, w[1].slot)) {
            return err("two filters for one slot".to_owned());
        }
        h.bars = rec.bars;
        h.filters = rec.filters;
        Ok(h)
    }

    /// A block's digest member (golden README rule 39): its slots, then `u32` count and its limit-bar entries,
    /// then `u32` count and its filters, ascending by slot.
    pub fn write_block_member(&self, r: InvRef, w: &mut Writer<'_>) -> EResult {
        for s in self.block(r) {
            s.write(w, "SlotHeap.slot")?;
        }
        match self.bars.binary_search_by(|x| x.inv.cmp(&r)) {
            Ok(i) => {
                w.u32(1);
                self.bars[i].write(w, "SlotHeap.bar")?;
            }
            Err(_) => w.u32(0),
        }
        let f = self.filters(r);
        w.u32(f.len() as u32);
        for x in f {
            x.write(w, "SlotHeap.filter")?;
        }
        Ok(())
    }

    /// The free blocks of class `c` whose `InvRef` falls in digest shard `shard` (`InvRef mod 3,600`), in
    /// ascending block order: blocks `b ≡ (shard − (c << 24)) mod 3,600`.
    pub fn free_blocks_in_shard(&self, c: u8, shard: u32, shards: u32, out: &mut Vec<u32>) {
        let Some(a) = self.arenas.get(usize::from(c)) else {
            return;
        };
        let base = (u64::from(c) << 24) % u64::from(shards);
        let first = ((u64::from(shard) + u64::from(shards) - base) % u64::from(shards)) as u32;
        let mut b = first;
        while b < a.blocks {
            if !a.is_owned(b) {
                out.push(b);
            }
            b += shards;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes_follow_rule_15() {
        let sizes: Vec<u32> = (0..=10).map(class_slots).collect();
        assert_eq!(sizes, vec![1, 2, 4, 8, 16, 32, 64, 128, 192, 256, 320]);
        assert_eq!(class_for(80), Some(7), "the character's 80 slots: class 7, 128 slots");
        assert_eq!(class_for(32), Some(5), "a 32-slot chest");
        assert_eq!(class_for(33), Some(6));
        assert_eq!(class_for(129), Some(8));
        assert_eq!(class_for(0), Some(0));
        assert_eq!(class_for(16_000), Some(255));
        assert_eq!(class_for(16_001), None);
        assert_eq!(inv_ref(7, 1).0, (7 << 24) | 1);
        assert_eq!((inv_class(inv_ref(7, 1)), inv_block(inv_ref(7, 1))), (7, 1));
    }

    #[test]
    fn allocation_takes_the_lowest_free_block_and_free_zeroes() {
        let mut h = SlotHeap::new();
        let a = h.alloc(32);
        let b = h.alloc(32);
        let c = h.alloc(30);
        assert_eq!([a, b, c], [inv_ref(5, 0), inv_ref(5, 1), inv_ref(5, 2)]);
        h.block_mut(b)[3] = Slot { key: ItemKey(16), count: 7 };
        h.set_bar(b, Some(10));
        h.set_filter(b, 2, Some(ItemKey(8)));
        h.free(b);
        assert!(h.block(b).iter().all(|s| *s == EMPTY_SLOT));
        assert_eq!(h.bar(b), None);
        assert!(h.filters(b).is_empty());
        assert_eq!(h.alloc(17), inv_ref(5, 1), "the lowest free block again");
        assert_eq!(h.alloc(80), inv_ref(7, 0));
        let classes: Vec<(u8, u32, u32)> = h.classes().collect();
        assert_eq!(classes, vec![(5, 32, 3), (7, 128, 1)]);
    }

    #[test]
    fn record_round_trip_and_refusals() {
        let mut h = SlotHeap::new();
        let a = h.alloc(32);
        let b = h.alloc(32);
        let m = h.alloc(80);
        h.block_mut(m)[0] = Slot { key: ItemKey(16), count: 50 };
        h.set_bar(a, Some(4));
        h.set_filter(m, 3, Some(ItemKey(8)));
        h.free(b);
        let rec = h.to_record();
        let back = SlotHeap::from_record(rec.clone(), &[a, m]).expect("a valid heap");
        assert_eq!(back.to_record(), rec);
        assert_eq!(back.bar(a), Some(4));
        assert_eq!(back.alloc_probe(), inv_ref(5, 1));
        // A free block holding items, a dangling reference, a block owned twice, a bar on a free block.
        let mut bad = rec.clone();
        bad.arenas[0].slots[40] = Slot { key: ItemKey(16), count: 1 };
        assert!(SlotHeap::from_record(bad, &[a, m]).is_err());
        assert!(SlotHeap::from_record(rec.clone(), &[a, m, inv_ref(5, 9)]).is_err());
        assert!(SlotHeap::from_record(rec.clone(), &[a, a, m]).is_err());
        assert!(SlotHeap::from_record(rec.clone(), &[m]).is_err(), "a's bar is on a free block");
        let mut bad = rec;
        bad.arenas[1].block_slots = 64;
        assert!(SlotHeap::from_record(bad, &[a, m]).is_err());
    }

    #[test]
    fn free_blocks_by_shard() {
        let mut h = SlotHeap::new();
        let refs: Vec<InvRef> = (0..10).map(|_| h.alloc(32)).collect();
        h.free(refs[3]);
        h.free(refs[7]);
        let shard = |r: InvRef| r.0 % 3600;
        for r in [refs[3], refs[7]] {
            let mut out = Vec::new();
            h.free_blocks_in_shard(5, shard(r), 3600, &mut out);
            assert_eq!(out, vec![inv_block(r)]);
        }
        let mut out = Vec::new();
        h.free_blocks_in_shard(5, shard(refs[4]), 3600, &mut out);
        assert!(out.is_empty(), "block 4 is owned");
    }

    impl SlotHeap {
        /// The block the next 32-slot allocation would take, without changing this heap.
        fn alloc_probe(&self) -> InvRef {
            self.clone().alloc(32)
        }
    }
}
