//! Production statistics (10 §5.20, I §4.12; golden README rule 26): phase 15 flushes the tick's counters
//! into each key's exact totals and its nine display rings.
//!
//! The eight fixed precisions keep 300 points of 1, 12, 120, 720, 7,200, 36,000, 180,000 and 720,000 ticks;
//! `all` starts at 60 ticks per point and doubles whenever its 300 points fill (pairs merged as `f32` sums).
//! Every key's rings follow one global grid: a key first counted in tick t gets rings as if it had existed
//! with zeros since tick 0 (point j of a precision of span T covers ticks j·T + 1 … (j + 1)·T). Every record
//! advances every tick, also at zero.

use crate::digest::Counters;
use crate::r#gen::{Stat, StatRing};
use crate::world::World;
use schema::{StatKey, StatPrecision};

pub const RING_POINTS: u32 = 300;
/// Ticks per point of the fixed precisions (`StatPrecision` s5 … h1000).
pub const TICKS_PER_POINT: [u32; 8] = [1, 12, 120, 720, 7_200, 36_000, 180_000, 720_000];
/// The precision `all`.
pub const ALL_PRECISION: usize = 8;
const ALL_START: u64 = 60;

/// The span of a point of the `all` ring after tick t: 60 × 2^m, m the doublings so far.
pub fn all_span(t: u32) -> u32 {
    let mut s = ALL_START;
    while u64::from(RING_POINTS) * s <= u64::from(t) {
        s *= 2;
    }
    s as u32
}

fn empty_ring(precision: usize, points: u32, acc_count: u32) -> StatRing {
    StatRing {
        precision: StatPrecision::from_value(precision as u8).expect("precisions 0–8"),
        points,
        acc_count,
        acc_produced: 0.0,
        acc_consumed: 0.0,
        produced: [0.0; 300],
        consumed: [0.0; 300],
    }
}

/// A record for a key first counted in tick t, aligned to the global grid.
fn new_stat(key: StatKey, t: u32) -> Stat {
    let p = t - 1;
    let mut rings: Vec<StatRing> =
        TICKS_PER_POINT.iter().enumerate().map(|(i, &span)| empty_ring(i, p / span, p % span)).collect();
    let s = all_span(p);
    rings.push(empty_ring(ALL_PRECISION, p / s, p % s));
    Stat { key, produced_total: 0.0, consumed_total: 0.0, handcrafted_total: 0.0, rings }
}

/// Adds one tick's values to a ring of span `span`; a full point is written as `f32` at `points mod 300`.
fn push(r: &mut StatRing, span: u32, produced: f64, consumed: f64) {
    r.acc_produced += produced;
    r.acc_consumed += consumed;
    r.acc_count += 1;
    if r.acc_count < span {
        return;
    }
    let i = (r.points % RING_POINTS) as usize;
    r.produced[i] = r.acc_produced as f32;
    r.consumed[i] = r.acc_consumed as f32;
    r.points += 1;
    r.acc_produced = 0.0;
    r.acc_consumed = 0.0;
    r.acc_count = 0;
}

/// The `all` ring's doubling: pairs of points merge (each sum rounded to `f32`), 300 points become 150.
fn halve(r: &mut StatRing) {
    for i in 0..150 {
        r.produced[i] = (f64::from(r.produced[2 * i]) + f64::from(r.produced[2 * i + 1])) as f32;
        r.consumed[i] = (f64::from(r.consumed[2 * i]) + f64::from(r.consumed[2 * i + 1])) as f32;
    }
    r.produced[150..].fill(0.0);
    r.consumed[150..].fill(0.0);
    r.points = RING_POINTS / 2;
}

/// The value of `key` in a sorted counter list (0 when absent).
fn get(list: &[(StatKey, f64)], key: StatKey) -> f64 {
    list.binary_search_by(|x| x.0.cmp(&key)).map_or(0.0, |i| list[i].1)
}

impl World {
    /// Phase 15 of tick t (§4.6): every key with a counter this tick gets a record, and every record advances
    /// its totals and its nine rings by this tick.
    pub(crate) fn flush_stats(&mut self, t: u32, c: &Counters) {
        for list in [&c.produced, &c.consumed, &c.handcrafted] {
            for &(key, _) in list {
                self.stat_mut(key, || new_stat(key, t));
            }
        }
        let s_all = all_span(t - 1);
        for s in self.stats_mut() {
            let prod = get(&c.produced, s.key);
            let cons = get(&c.consumed, s.key);
            s.produced_total += prod;
            s.consumed_total += cons;
            s.handcrafted_total += get(&c.handcrafted, s.key);
            for (p, &span) in TICKS_PER_POINT.iter().enumerate() {
                push(&mut s.rings[p], span, prod, cons);
            }
            let all = &mut s.rings[ALL_PRECISION];
            push(all, s_all, prod, cons);
            if all.points == RING_POINTS {
                halve(all);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_all_ring_doubles_its_span() {
        assert_eq!(all_span(0), 60);
        assert_eq!(all_span(17_999), 60);
        assert_eq!(all_span(18_000), 120);
        assert_eq!(all_span(35_999), 120);
        assert_eq!(all_span(36_000), 240);
    }

    #[test]
    fn a_late_key_is_aligned_to_the_grid() {
        let s = new_stat(StatKey(1), 25);
        assert_eq!((s.rings[0].points, s.rings[0].acc_count), (24, 0));
        assert_eq!((s.rings[1].points, s.rings[1].acc_count), (2, 0));
        assert_eq!((s.rings[2].points, s.rings[2].acc_count), (0, 24));
        assert_eq!((s.rings[8].points, s.rings[8].acc_count), (0, 24));
    }
}
