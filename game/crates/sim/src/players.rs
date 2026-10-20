//! `World.players` (10 §4.4, S1): one `PlayerState` per player index 0–31, saved in `PLAYERS` in index order.
//! A record exists for every index that ever acted or joined (a watermark record keeps a never-joined
//! player's seqs consumed, golden README rule 12); whether it has a character is its `character` serial.

use crate::r#gen::Player;
use schema::{PLAYERS, PlayerIndex};

/// The players, by index.
#[derive(Clone, Debug, PartialEq)]
pub struct Players {
    slots: Vec<Option<Player>>,
}

impl Default for Players {
    fn default() -> Self {
        Self { slots: vec![None; PLAYERS] }
    }
}

impl Players {
    pub fn new() -> Self {
        Self::default()
    }

    /// From the `PLAYERS` records, which the decoder has checked are strictly ascending and within 0–31.
    pub fn from_records(records: Vec<Player>) -> Self {
        let mut p = Self::default();
        for r in records {
            let i = usize::from(r.index.0);
            p.slots[i] = Some(r);
        }
        p
    }

    pub fn get(&self, i: PlayerIndex) -> Option<&Player> {
        self.slots.get(usize::from(i.0)).and_then(Option::as_ref)
    }

    pub fn get_mut(&mut self, i: PlayerIndex) -> Option<&mut Player> {
        self.slots.get_mut(usize::from(i.0)).and_then(Option::as_mut)
    }

    /// Stores `p` at its index, replacing any record there.
    pub fn insert(&mut self, p: Player) {
        let i = usize::from(p.index.0);
        assert!(i < PLAYERS, "player index {i} out of range");
        self.slots[i] = Some(p);
    }

    /// The records in index order.
    pub fn iter(&self) -> impl Iterator<Item = &Player> + '_ {
        self.slots.iter().filter_map(Option::as_ref)
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut Player> + '_ {
        self.slots.iter_mut().filter_map(Option::as_mut)
    }

    pub fn len(&self) -> usize {
        self.iter().count()
    }

    pub fn is_empty(&self) -> bool {
        self.iter().next().is_none()
    }

    /// The `u32` watermarks of every index (0 for an index without a record), for the preflight (§15.3).
    pub fn last_seqs(&self) -> [u32; PLAYERS] {
        let mut out = [0u32; PLAYERS];
        for p in self.iter() {
            out[usize::from(p.index.0)] = p.last_seq.0;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use schema::Seq;

    #[test]
    fn records_stay_in_index_order() {
        let mut ps = Players::new();
        for i in [5u16, 0, 31] {
            ps.insert(Player {
                index: PlayerIndex(i),
                last_seq: Seq(u32::from(i) * 10),
                ..Player::default()
            });
        }
        let order: Vec<u16> = ps.iter().map(|p| p.index.0).collect();
        assert_eq!(order, vec![0, 5, 31]);
        assert_eq!(ps.last_seqs()[5], 50);
        assert_eq!(ps.len(), 3);
        assert!(ps.get(PlayerIndex(1)).is_none());
        assert!(ps.get(PlayerIndex(0xFFFF)).is_none());
    }
}
