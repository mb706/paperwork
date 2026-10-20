//! Entity handles and the serial index (10 §4.3).
//!
//! An `EntityHandle` is `(generation << 22) | slot`: the entity-table row and the row's handle generation,
//! which rises each time the row is handed out, cycling 1 … 1,023 (golden README rule 28), so handle 0
//! ("none") is never a live entity's. Handles never leave the module and are never saved (§4.5): saves,
//! packets, projections and actions name entities by serial, and [`SerialIndex`] maps a live serial back to
//! its handle.

use crate::rng::fmix32;
use schema::{EntityHandle, Serial};

/// Slot bits of a handle: 4,194,304 rows (§4.3; state.yaml `max_rows`).
pub const SLOT_BITS: u32 = 22;
pub const SLOT_MASK: u32 = (1 << SLOT_BITS) - 1;
/// Generations cycle 1 … GEN_MAX (10 bits; rule 28).
pub const GEN_MAX: u16 = 1023;

/// The handle of row `slot` at generation `generation`.
#[inline]
pub const fn make(slot: u32, generation: u16) -> EntityHandle {
    EntityHandle(((generation as u32) << SLOT_BITS) | (slot & SLOT_MASK))
}

/// The row a handle names.
#[inline]
pub const fn slot(h: EntityHandle) -> u32 {
    h.0 & SLOT_MASK
}

/// The generation a handle carries.
#[inline]
pub const fn generation(h: EntityHandle) -> u16 {
    (h.0 >> SLOT_BITS) as u16
}

/// The generation a row gets when it is handed out again: `(old mod 1,023) + 1` (rule 28).
#[inline]
pub const fn next_generation(old: u16) -> u16 {
    (old % GEN_MAX) + 1
}

/// The serial index (§4.3): live serial → handle. Open addressing with linear probing and a fixed hash
/// (Murmur3's finalizer), backward-shift deletion (no tombstones), and **no iteration API**: nothing can
/// depend on its internal order (D3 d). Derived: rebuilt on load. Growth doubles the table (an amortised
/// growth path of §2.5); a lookup is O(1) expected.
#[derive(Clone, Debug, Default)]
pub struct SerialIndex {
    /// `(serial, handle)`; serial 0 marks an empty bucket (0 is never a live serial).
    table: Vec<(u32, u32)>,
    len: usize,
}

impl SerialIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// An index sized for `n` entries without growing.
    pub fn with_capacity(n: usize) -> Self {
        let mut s = Self::default();
        s.reserve(n);
        s
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn clear(&mut self) {
        self.table.iter_mut().for_each(|b| *b = (0, 0));
        self.len = 0;
    }

    #[inline]
    fn mask(&self) -> usize {
        self.table.len() - 1
    }

    #[inline]
    fn home(&self, serial: u32) -> usize {
        fmix32(serial) as usize & self.mask()
    }

    /// Makes room for `n` entries at a load factor of at most 1/2.
    pub fn reserve(&mut self, n: usize) {
        let want = (n.max(8) * 2).next_power_of_two();
        if want <= self.table.len() {
            return;
        }
        let old = std::mem::replace(&mut self.table, vec![(0, 0); want]);
        self.len = 0;
        for (s, h) in old {
            if s != 0 {
                self.insert(Serial(s), EntityHandle(h));
            }
        }
    }

    /// Adds or replaces the handle of `serial` (not 0).
    pub fn insert(&mut self, serial: Serial, h: EntityHandle) {
        assert!(serial.0 != 0, "serial 0 is never an entity's");
        if (self.len + 1) * 2 > self.table.len() {
            self.reserve(self.len + 1);
        }
        let mut i = self.home(serial.0);
        loop {
            let (s, _) = self.table[i];
            if s == serial.0 {
                self.table[i].1 = h.0;
                return;
            }
            if s == 0 {
                self.table[i] = (serial.0, h.0);
                self.len += 1;
                return;
            }
            i = (i + 1) & self.mask();
        }
    }

    /// The handle of a live serial.
    pub fn get(&self, serial: Serial) -> Option<EntityHandle> {
        if self.table.is_empty() || serial.0 == 0 {
            return None;
        }
        let mut i = self.home(serial.0);
        loop {
            let (s, h) = self.table[i];
            if s == serial.0 {
                return Some(EntityHandle(h));
            }
            if s == 0 {
                return None;
            }
            i = (i + 1) & self.mask();
        }
    }

    /// Removes `serial`; returns its handle if it was there.
    pub fn remove(&mut self, serial: Serial) -> Option<EntityHandle> {
        if self.table.is_empty() || serial.0 == 0 {
            return None;
        }
        let mask = self.mask();
        let mut i = self.home(serial.0);
        loop {
            let (s, h) = self.table[i];
            if s == 0 {
                return None;
            }
            if s == serial.0 {
                // Backward-shift deletion: move later members of the probe run into the gap when their home
                // lies cyclically at or before it, so no lookup ever stops early.
                let mut gap = i;
                let mut j = (i + 1) & mask;
                loop {
                    let (sj, _) = self.table[j];
                    if sj == 0 {
                        break;
                    }
                    let home = self.home(sj);
                    // `home` is cyclically outside (gap, j]: the entry may move back to the gap.
                    let between = if gap <= j { home > gap && home <= j } else { home > gap || home <= j };
                    if !between {
                        self.table[gap] = self.table[j];
                        gap = j;
                    }
                    j = (j + 1) & mask;
                }
                self.table[gap] = (0, 0);
                self.len -= 1;
                return Some(EntityHandle(h));
            }
            i = (i + 1) & mask;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Xoshiro128;

    #[test]
    fn handles_pack_slot_and_generation() {
        let h = make(12345, 7);
        assert_eq!((slot(h), generation(h)), (12345, 7));
        assert_eq!(make(SLOT_MASK, GEN_MAX).0, u32::MAX);
        assert_eq!(next_generation(0), 1);
        assert_eq!(next_generation(1), 2);
        assert_eq!(next_generation(1022), 1023);
        assert_eq!(next_generation(1023), 1, "generations cycle 1 … 1,023 (rule 28)");
    }

    #[test]
    fn index_agrees_with_an_ordered_map_under_random_edits() {
        let mut idx = SerialIndex::new();
        let mut reference = std::collections::BTreeMap::new();
        let mut live: Vec<u32> = Vec::new();
        let mut rng = Xoshiro128::seeded(42, 1);
        let mut next = 1u32;
        for step in 0..200_000 {
            let r = rng.next_u32();
            if !r.is_multiple_of(3) || live.is_empty() {
                // Serials are mostly fresh, sometimes spread so that probe runs collide and wrap.
                let s = if r.is_multiple_of(7) { next.wrapping_mul(4096) | 1 } else { next };
                next += 1;
                if reference.insert(s, step).is_none() {
                    live.push(s);
                }
                idx.insert(Serial(s), EntityHandle(step));
            } else {
                let k = live.swap_remove((r as usize / 3) % live.len());
                assert_eq!(idx.remove(Serial(k)).map(|h| h.0), reference.remove(&k));
            }
            if step % 1000 == 0 {
                for (&s, &h) in &reference {
                    assert_eq!(idx.get(Serial(s)), Some(EntityHandle(h)), "serial {s} at step {step}");
                }
                assert_eq!(idx.len(), reference.len());
                assert_eq!(idx.get(Serial(u32::MAX)), None);
            }
        }
        assert_eq!(idx.get(Serial(0)), None);
        assert_eq!(idx.remove(Serial(0)), None);
    }
}
