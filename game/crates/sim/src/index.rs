//! Ordered containers for the digest's slices (10 §4.8; C2a-r1 finding 10).
//!
//! A `records` section's member is keyed by the record's **position** (golden README rule 38), and one slice
//! must cost about 1/3,600 of the state, so the sim needs, per section, the records of one shard (a
//! [`ShardBuckets`] index) and each one's position in canonical order (a [`BlockList`], or a sorted `Vec` when
//! records are only appended). Both are derived: rebuilt on load, never saved.

use schema::SHARDS;

/// Items per block of a [`BlockList`]: a block splits at twice this.
const BLOCK: usize = 256;

/// A sorted sequence of distinct items in blocks of at most `2 × BLOCK`: insertion, removal and `pop_first`
/// touch one block, and an item's position (`rank`) sums the block lengths before it, so every operation costs
/// O(n / BLOCK + BLOCK) rather than O(n). Emptied blocks are kept for reuse, so a steady churn of insertions
/// and removals allocates nothing (§2.5).
#[derive(Clone, Debug)]
pub struct BlockList<T> {
    blocks: Vec<Vec<T>>,
    len: usize,
    spare: Vec<Vec<T>>,
}

impl<T> Default for BlockList<T> {
    fn default() -> Self {
        Self { blocks: Vec::new(), len: 0, spare: Vec::new() }
    }
}

impl<T: Ord + Copy> PartialEq for BlockList<T> {
    fn eq(&self, other: &Self) -> bool {
        self.len == other.len && self.iter().eq(other.iter())
    }
}

impl<T: Ord + Copy> BlockList<T> {
    pub fn new() -> Self {
        Self::default()
    }

    /// From items that are sorted and distinct (a decoder checked them); `None` otherwise.
    pub fn from_sorted(items: &[T]) -> Option<Self> {
        if items.windows(2).any(|w| w[0] >= w[1]) {
            return None;
        }
        let blocks = items.chunks(BLOCK).map(<[T]>::to_vec).collect();
        Some(Self { blocks, len: items.len(), spare: Vec::new() })
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The block that holds `x` or would: the last block whose first item is ≤ `x` (the first block when none).
    fn block_of(&self, x: &T) -> usize {
        let i = self.blocks.partition_point(|b| b[0] <= *x);
        i.saturating_sub(1)
    }

    /// Inserts `x`; `false` when it was there.
    pub fn insert(&mut self, x: T) -> bool {
        if self.blocks.is_empty() {
            let mut b = self.spare.pop().unwrap_or_default();
            b.push(x);
            self.blocks.push(b);
            self.len = 1;
            return true;
        }
        let bi = self.block_of(&x);
        let b = &mut self.blocks[bi];
        let Err(at) = b.binary_search(&x) else {
            return false;
        };
        b.insert(at, x);
        self.len += 1;
        if b.len() >= 2 * BLOCK {
            let mut tail = self.spare.pop().unwrap_or_default();
            tail.extend_from_slice(&self.blocks[bi][BLOCK..]);
            self.blocks[bi].truncate(BLOCK);
            self.blocks.insert(bi + 1, tail);
        }
        true
    }

    /// Removes `x`; `false` when it was not there.
    pub fn remove(&mut self, x: &T) -> bool {
        if self.blocks.is_empty() {
            return false;
        }
        let bi = self.block_of(x);
        let Ok(at) = self.blocks[bi].binary_search(x) else {
            return false;
        };
        self.blocks[bi].remove(at);
        self.len -= 1;
        if self.blocks[bi].is_empty() {
            let b = self.blocks.remove(bi);
            self.spare.push(b);
        }
        true
    }

    pub fn first(&self) -> Option<&T> {
        self.blocks.first().and_then(|b| b.first())
    }

    pub fn pop_first(&mut self) -> Option<T> {
        let x = *self.first()?;
        self.remove(&x);
        Some(x)
    }

    pub fn contains(&self, x: &T) -> bool {
        !self.blocks.is_empty() && self.blocks[self.block_of(x)].binary_search(x).is_ok()
    }

    /// The position of `x` in the sequence (0-based), or `None` when absent.
    pub fn rank(&self, x: &T) -> Option<usize> {
        if self.blocks.is_empty() {
            return None;
        }
        let bi = self.block_of(x);
        let at = self.blocks[bi].binary_search(x).ok()?;
        Some(self.blocks[..bi].iter().map(Vec::len).sum::<usize>() + at)
    }

    /// The items in order.
    pub fn iter(&self) -> impl Iterator<Item = &T> + '_ {
        self.blocks.iter().flatten()
    }

    pub fn clear(&mut self) {
        while let Some(mut b) = self.blocks.pop() {
            b.clear();
            self.spare.push(b);
        }
        self.len = 0;
    }
}

/// Per digest shard (3,600, §4.8), the keys of a collection that fall in it, each bucket sorted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShardBuckets<K> {
    buckets: Vec<Vec<K>>,
}

impl<K> Default for ShardBuckets<K> {
    fn default() -> Self {
        Self { buckets: Vec::new() }
    }
}

impl<K: Ord + Copy> ShardBuckets<K> {
    pub fn new() -> Self {
        Self::default()
    }

    fn bucket_mut(&mut self, shard: u32) -> &mut Vec<K> {
        if self.buckets.is_empty() {
            self.buckets.resize_with(SHARDS as usize, Vec::new);
        }
        &mut self.buckets[(shard % SHARDS) as usize]
    }

    /// Adds `k` to shard `shard`'s bucket (once).
    pub fn insert(&mut self, shard: u32, k: K) {
        let b = self.bucket_mut(shard);
        // Keys that only grow (serials) go at the end without a search.
        match b.last() {
            Some(&last) if last >= k => {
                if let Err(i) = b.binary_search(&k) {
                    b.insert(i, k);
                }
            }
            _ => b.push(k),
        }
    }

    pub fn remove(&mut self, shard: u32, k: &K) {
        if self.buckets.is_empty() {
            return;
        }
        let b = &mut self.buckets[(shard % SHARDS) as usize];
        if let Ok(i) = b.binary_search(k) {
            b.remove(i);
        }
    }

    /// The keys of shard `shard`, ascending.
    pub fn bucket(&self, shard: u32) -> &[K] {
        self.buckets.get((shard % SHARDS) as usize).map_or(&[], Vec::as_slice)
    }

    pub fn clear(&mut self) {
        self.buckets.iter_mut().for_each(Vec::clear);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Xoshiro128;
    use std::collections::BTreeSet;

    #[test]
    fn block_list_agrees_with_an_ordered_set() {
        let mut b = BlockList::new();
        let mut r = BTreeSet::new();
        let mut rng = Xoshiro128::seeded(3, 1);
        for step in 0..60_000 {
            let x = rng.next_u32() % 5_000;
            match rng.next_u32() % 4 {
                0 | 1 => assert_eq!(b.insert(x), r.insert(x)),
                2 => assert_eq!(b.remove(&x), r.remove(&x)),
                _ => assert_eq!(b.pop_first(), r.pop_first()),
            }
            if step % 997 == 0 {
                assert_eq!(b.len(), r.len());
                assert!(b.iter().copied().eq(r.iter().copied()));
                for (i, y) in r.iter().enumerate().step_by(37) {
                    assert_eq!(b.rank(y), Some(i));
                    assert!(b.contains(y));
                }
                assert_eq!(b.rank(&9_999), None);
            }
        }
        let v: Vec<u32> = r.iter().copied().collect();
        assert_eq!(BlockList::from_sorted(&v).expect("sorted"), b);
        assert!(BlockList::from_sorted(&[2u32, 1]).is_none());
    }

    #[test]
    fn shard_buckets_stay_sorted() {
        let mut s = ShardBuckets::new();
        for k in [7203u32, 3, 3603, 3, 10_803] {
            s.insert(k % SHARDS, k);
        }
        assert_eq!(s.bucket(3), &[3, 3603, 7203, 10_803]);
        s.remove(3, &3603);
        assert_eq!(s.bucket(3), &[3, 7203, 10_803]);
        assert!(s.bucket(4).is_empty());
    }
}
