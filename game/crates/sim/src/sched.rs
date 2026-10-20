//! Update scheduling (10 §4.6; A1 findings 1–2, IMPL-2, B1-r1 17): Factorio-style sleep and wake, built so that
//! sleeping is a pure optimisation and a NO_SLEEP run is bit-identical (D18 b).
//!
//! - **Active sets** are bitsets over a pool's slots, iterated in ascending slot order: take the lowest set
//!   bit at or after the cursor, update that entity, then look again from the next slot. An entity woken
//!   during its own phase runs this tick if its slot is above the cursor, else next tick (D3 a).
//! - **Waking only marks** (wake rule 1): [`Scheduler::wake`] sets the active bit and raises the entity's
//!   wake sequence number; the entity's own phase does the work.
//! - **Registrations carry the sequence number** (wake rule 2): a sleeper registers with at most
//!   [`MAX_REGISTRATIONS`] wake sources (watch lists and one timer); the first to fire wakes it, which makes
//!   the others stale. Stale nodes are dropped when their list fires, a list is compacted when its stale
//!   nodes outnumber its live ones, and the whole pool is swept when it holds more than twice the live
//!   registrations, so retained nodes stay bounded (B1-r1 17). Forgetting an entity (destroyed) drops its
//!   registrations at once.
//! - **Wake timers** wait in a 4,096-bucket wheel (one bucket per tick) or, for longer delays, a binary heap;
//!   a delay of 0 means 1 (a timer is due no earlier than the next tick). Wake timers only wake, so their fire
//!   order is free. **Work timers** (ghost expiry …) are saved world state in `TIMERS` and fire in
//!   `(due, serial, event, owner)` order; the World keeps them ordered (`World::timers`), not here.
//!
//! Everything here is derived and unsaved (§8.1): after a load every entity starts awake and goes back to
//! sleep within a tick. NO_SLEEP (`sim_set_flags` bit 0) keeps every live slot active and bypasses all of it.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// At most four wake sources per sleeper (§4.6, B1-r1 17).
pub const MAX_REGISTRATIONS: usize = 4;
/// Buckets of the wake-timer wheel (§4.6).
pub const WHEEL_BUCKETS: u32 = 4096;
const NONE: u32 = u32::MAX;

/// An entity that can sleep: its pool kind and its slot in that pool, packed `(kind << 24) | slot`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sleeper(pub u32);

impl Sleeper {
    pub const fn new(kind: u8, slot: u32) -> Self {
        Self(((kind as u32) << 24) | (slot & 0x00FF_FFFF))
    }

    pub const fn kind(self) -> u8 {
        (self.0 >> 24) as u8
    }

    pub const fn slot(self) -> u32 {
        self.0 & 0x00FF_FFFF
    }
}

/// A watch list (a wake source: an inventory's *added* or *space* list, a line's arrivals, a network's
/// power-restored list …), allocated by the system that owns the source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ListId(pub u32);

/// A pool's active set: one bit per slot (§4.6).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveSet {
    words: Vec<u32>,
}

impl ActiveSet {
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the bit of `slot`; returns whether it was clear.
    pub fn insert(&mut self, slot: u32) -> bool {
        let w = slot as usize / 32;
        if self.words.len() <= w {
            self.words.resize(w + 1, 0);
        }
        let bit = 1u32 << (slot % 32);
        let was = self.words[w] & bit != 0;
        self.words[w] |= bit;
        !was
    }

    pub fn remove(&mut self, slot: u32) {
        if let Some(w) = self.words.get_mut(slot as usize / 32) {
            *w &= !(1u32 << (slot % 32));
        }
    }

    pub fn contains(&self, slot: u32) -> bool {
        self.words.get(slot as usize / 32).is_some_and(|w| w & (1u32 << (slot % 32)) != 0)
    }

    /// The lowest set slot at or after `from`: the cursor of §4.6's loop, which re-reads the words so that
    /// an entity woken above the cursor runs in this pass.
    pub fn next_at_or_after(&self, from: u32) -> Option<u32> {
        let mut w = from as usize / 32;
        if w >= self.words.len() {
            return None;
        }
        let mut bits = self.words[w] & (u32::MAX << (from % 32));
        loop {
            if bits != 0 {
                return Some((w as u32) * 32 + bits.trailing_zeros());
            }
            w += 1;
            if w >= self.words.len() {
                return None;
            }
            bits = self.words[w];
        }
    }

    /// Exactly the slots `< n` set (NO_SLEEP, and after a load every entity starts awake).
    pub fn fill(&mut self, n: u32) {
        let words = (n as usize).div_ceil(32);
        self.words.clear();
        self.words.resize(words, u32::MAX);
        if !n.is_multiple_of(32) {
            self.words[words - 1] = (1u32 << (n % 32)) - 1;
        }
    }

    pub fn clear(&mut self) {
        self.words.iter_mut().for_each(|w| *w = 0);
    }

    pub fn count(&self) -> u32 {
        self.words.iter().map(|w| w.count_ones()).sum()
    }
}

/// Per sleeper: its wake sequence number and the registrations of its current sleep.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SleeperState {
    /// Rises (wrapping) at every wake and at every forget; nodes that recorded another value are stale.
    seq: u32,
    /// The lists of the current registrations, [`NONE`] in unused places; a timer registration is the
    /// wheel bucket's list, or `TIMER_HEAP` for the heap.
    regs: [u32; MAX_REGISTRATIONS],
}

/// The pseudo-list of registrations held by the long-delay heap.
const TIMER_HEAP: u32 = u32::MAX - 1;

/// One registration.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Node {
    next: u32,
    owner: Sleeper,
    seq: u32,
}

/// One watch list (or wheel bucket): a singly linked chain of nodes and its counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct List {
    head: u32,
    len: u32,
    stale: u32,
}

impl Default for List {
    fn default() -> Self {
        Self { head: NONE, len: 0, stale: 0 }
    }
}

/// What a sweep found, for tests and the profile.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SchedStats {
    pub nodes_in_use: u32,
    pub live_registrations: u32,
    pub compactions: u32,
    pub sweeps: u32,
}

/// The scheduler of every pool: active sets, wake sequence numbers, watch lists and wake timers.
#[derive(Clone, Debug)]
pub struct Scheduler {
    /// NO_SLEEP (D18 b): every live slot stays active, and sleeping, registering and timers do nothing.
    no_sleep: bool,
    /// Indexed by pool kind.
    active: Vec<ActiveSet>,
    /// Indexed by pool kind, then slot.
    sleepers: Vec<Vec<SleeperState>>,
    nodes: Vec<Node>,
    free: u32,
    lists: Vec<List>,
    free_lists: Vec<u32>,
    /// Wheel buckets are the lists `0 … WHEEL_BUCKETS − 1`.
    heap: BinaryHeap<Reverse<(u32, u32)>>,
    /// The tick whose timers fired last (timers are scheduled relative to it).
    now: u32,
    stats: SchedStats,
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            no_sleep: false,
            active: Vec::new(),
            sleepers: Vec::new(),
            nodes: Vec::new(),
            free: NONE,
            lists: vec![List::default(); WHEEL_BUCKETS as usize],
            free_lists: Vec::new(),
            heap: BinaryHeap::new(),
            now: 0,
            stats: SchedStats::default(),
        }
    }

    /// A fresh scheduler at `tick` (after a load: every entity awake, no registration).
    pub fn reset(&mut self, tick: u32) {
        let no_sleep = self.no_sleep;
        *self = Self::new();
        self.no_sleep = no_sleep;
        self.now = tick;
    }

    pub fn no_sleep(&self) -> bool {
        self.no_sleep
    }

    /// Sets NO_SLEEP. Turning it on drops every registration; the caller then activates every live slot.
    pub fn set_no_sleep(&mut self, on: bool) {
        if on && !self.no_sleep {
            let now = self.now;
            let active = std::mem::take(&mut self.active);
            let sleepers = std::mem::take(&mut self.sleepers);
            self.reset(now);
            self.active = active;
            // Sequence numbers survive; registrations are gone.
            self.sleepers = sleepers
                .into_iter()
                .map(|v| {
                    v.into_iter()
                        .map(|s| SleeperState { seq: s.seq.wrapping_add(1), regs: [NONE; 4] })
                        .collect()
                })
                .collect();
        }
        self.no_sleep = on;
    }

    fn state(&mut self, s: Sleeper) -> &mut SleeperState {
        let k = usize::from(s.kind());
        if self.sleepers.len() <= k {
            self.sleepers.resize_with(k + 1, Vec::new);
        }
        let v = &mut self.sleepers[k];
        let i = s.slot() as usize;
        if v.len() <= i {
            v.resize(i + 1, SleeperState { seq: 0, regs: [NONE; MAX_REGISTRATIONS] });
        }
        &mut v[i]
    }

    /// The active set of a pool kind.
    pub fn active(&self, kind: u8) -> Option<&ActiveSet> {
        self.active.get(usize::from(kind))
    }

    fn active_mut(&mut self, kind: u8) -> &mut ActiveSet {
        let k = usize::from(kind);
        if self.active.len() <= k {
            self.active.resize_with(k + 1, ActiveSet::new);
        }
        &mut self.active[k]
    }

    /// The next active slot of `kind` at or after `from` (§4.6's loop).
    pub fn next_active(&self, kind: u8, from: u32) -> Option<u32> {
        self.active(kind).and_then(|a| a.next_at_or_after(from))
    }

    pub fn is_active(&self, s: Sleeper) -> bool {
        self.active(s.kind()).is_some_and(|a| a.contains(s.slot()))
    }

    /// Marks a new or loaded entity awake (§4.6: every entity starts awake); the same as a wake.
    pub fn activate(&mut self, s: Sleeper) {
        self.wake(s);
    }

    /// The wake sequence number of `s`.
    pub fn wake_seq(&self, s: Sleeper) -> u32 {
        self.sleepers.get(usize::from(s.kind())).and_then(|v| v.get(s.slot() as usize)).map_or(0, |x| x.seq)
    }

    /// Wake rule 1: marks `s` active and raises its sequence number, making its registrations stale. A
    /// sleeper that is already active is left as it is. Returns whether it was asleep.
    pub fn wake(&mut self, s: Sleeper) -> bool {
        if !self.active_mut(s.kind()).insert(s.slot()) {
            return false;
        }
        self.invalidate(s);
        true
    }

    /// Raises the sequence number of `s` and marks its registrations stale in their lists.
    fn invalidate(&mut self, s: Sleeper) {
        let st = self.state(s);
        st.seq = st.seq.wrapping_add(1);
        let regs = st.regs;
        st.regs = [NONE; MAX_REGISTRATIONS];
        for l in regs {
            if l == NONE {
                continue;
            }
            self.stats.live_registrations -= 1;
            if l == TIMER_HEAP {
                continue;
            }
            let list = &mut self.lists[l as usize];
            list.stale += 1;
            if list.stale * 2 > list.len {
                self.compact(l);
            }
        }
        self.maybe_sweep();
    }

    /// Puts `s` to sleep: clears its active bit. The caller then registers it with its wake sources. Under
    /// NO_SLEEP the entity stays active and nothing happens.
    pub fn sleep(&mut self, s: Sleeper) {
        if self.no_sleep {
            return;
        }
        self.active_mut(s.kind()).remove(s.slot());
    }

    /// An entity is destroyed: it leaves its pool's active set and every registration of it is dropped now
    /// (§4.6); its slot may be reused, and nothing registered before can wake the new occupant.
    pub fn forget(&mut self, s: Sleeper) {
        self.active_mut(s.kind()).remove(s.slot());
        self.invalidate(s);
    }

    fn add_reg(&mut self, s: Sleeper, list: u32) -> u32 {
        let st = self.state(s);
        let Some(place) = st.regs.iter().position(|&l| l == NONE) else {
            panic!("sleeper {s:?} registers with more than {MAX_REGISTRATIONS} wake sources (§4.6)");
        };
        st.regs[place] = list;
        let seq = st.seq;
        self.stats.live_registrations += 1;
        seq
    }

    fn alloc_node(&mut self, owner: Sleeper, seq: u32) -> u32 {
        self.stats.nodes_in_use += 1;
        if self.free != NONE {
            let n = self.free;
            self.free = self.nodes[n as usize].next;
            self.nodes[n as usize] = Node { next: NONE, owner, seq };
            return n;
        }
        self.nodes.push(Node { next: NONE, owner, seq });
        (self.nodes.len() - 1) as u32
    }

    fn free_node(&mut self, n: u32) {
        self.nodes[n as usize].next = self.free;
        self.free = n;
        self.stats.nodes_in_use -= 1;
    }

    fn push(&mut self, list: u32, owner: Sleeper, seq: u32) {
        let n = self.alloc_node(owner, seq);
        let l = &mut self.lists[list as usize];
        self.nodes[n as usize].next = l.head;
        l.head = n;
        l.len += 1;
    }

    fn is_live(&self, n: &Node) -> bool {
        self.wake_seq(n.owner) == n.seq
    }

    /// A new watch list.
    pub fn alloc_list(&mut self) -> ListId {
        if let Some(l) = self.free_lists.pop() {
            return ListId(l);
        }
        self.lists.push(List::default());
        ListId((self.lists.len() - 1) as u32)
    }

    /// Retires a list whose source is gone: its live waiters wake (the source they waited on vanished).
    pub fn free_list(&mut self, l: ListId) {
        assert!(l.0 >= WHEEL_BUCKETS, "wheel buckets are not watch lists");
        self.fire_list(l.0);
        self.free_lists.push(l.0);
    }

    /// Registers sleeping `s` with the list `l` (at most four registrations per sleep).
    pub fn watch(&mut self, s: Sleeper, l: ListId) {
        if self.no_sleep {
            return;
        }
        assert!(l.0 >= WHEEL_BUCKETS && (l.0 as usize) < self.lists.len(), "no watch list {}", l.0);
        let seq = self.add_reg(s, l.0);
        self.push(l.0, s, seq);
    }

    /// Wakes every live waiter of `l` (wake rule 1) and empties it; stale nodes are dropped.
    pub fn notify(&mut self, l: ListId) {
        self.fire_list(l.0);
    }

    fn fire_list(&mut self, l: u32) {
        let list = std::mem::take(&mut self.lists[l as usize]);
        let mut n = list.head;
        while n != NONE {
            let node = self.nodes[n as usize];
            let next = node.next;
            if self.is_live(&node) {
                // This registration is consumed here; wake() makes the sleeper's others stale.
                let st = self.state(node.owner);
                if let Some(p) = st.regs.iter().position(|&x| x == l) {
                    st.regs[p] = NONE;
                    self.stats.live_registrations -= 1;
                }
                self.wake(node.owner);
            }
            self.free_node(n);
            n = next;
        }
    }

    /// Unlinks the stale nodes of a list.
    fn compact(&mut self, l: u32) {
        self.stats.compactions += 1;
        let mut prev = NONE;
        let mut n = self.lists[l as usize].head;
        while n != NONE {
            let node = self.nodes[n as usize];
            if self.is_live(&node) {
                prev = n;
            } else {
                if prev == NONE {
                    self.lists[l as usize].head = node.next;
                } else {
                    self.nodes[prev as usize].next = node.next;
                }
                self.lists[l as usize].len -= 1;
                self.free_node(n);
            }
            n = node.next;
        }
        self.lists[l as usize].stale = 0;
    }

    /// The full sweep (B1-r1 17): when nodes in use exceed twice the live registrations (plus a small
    /// allowance), every list with stale nodes is compacted and the heap rebuilt without stale entries.
    fn maybe_sweep(&mut self) {
        if self.stats.nodes_in_use <= 2 * self.stats.live_registrations + 64 {
            return;
        }
        self.stats.sweeps += 1;
        for l in 0..self.lists.len() as u32 {
            if self.lists[l as usize].stale > 0 {
                self.compact(l);
            }
        }
        let entries = std::mem::take(&mut self.heap).into_vec();
        for Reverse((due, n)) in entries {
            if self.is_live(&self.nodes[n as usize]) {
                self.heap.push(Reverse((due, n)));
            } else {
                self.free_node(n);
            }
        }
    }

    /// Wakes sleeping `s` at tick `now + delay`, `now` being the current tick (a delay of 0 means 1, §4.6):
    /// an arrival estimate, a wait condition. One of its at most four registrations.
    pub fn wake_after(&mut self, s: Sleeper, delay: u32) {
        if self.no_sleep {
            return;
        }
        let delay = delay.max(1);
        let due = self.now.wrapping_add(delay);
        if delay < WHEEL_BUCKETS {
            let bucket = due % WHEEL_BUCKETS;
            let seq = self.add_reg(s, bucket);
            self.push(bucket, s, seq);
        } else {
            let seq = self.add_reg(s, TIMER_HEAP);
            let n = self.alloc_node(s, seq);
            self.heap.push(Reverse((due, n)));
        }
    }

    /// Starts tick `tick`: timers scheduled from now on are relative to it, so a delay of 1 means the next
    /// tick whatever phase schedules it.
    pub fn begin_tick(&mut self, tick: u32) {
        self.now = tick;
    }

    /// Phase 2's wake timers for `tick` (the current tick): the wheel bucket, then the heap entries due. Each
    /// live one wakes its sleeper.
    pub fn fire_timers(&mut self, tick: u32) {
        self.now = tick;
        self.fire_list(tick % WHEEL_BUCKETS);
        while let Some(&Reverse((due, n))) = self.heap.peek() {
            if due != tick {
                break;
            }
            self.heap.pop();
            let node = self.nodes[n as usize];
            if self.is_live(&node) {
                let st = self.state(node.owner);
                if let Some(p) = st.regs.iter().position(|&x| x == TIMER_HEAP) {
                    st.regs[p] = NONE;
                    self.stats.live_registrations -= 1;
                }
                self.wake(node.owner);
            }
            self.free_node(n);
        }
    }

    pub fn stats(&self) -> SchedStats {
        self.stats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_set_iterates_in_slot_order_and_sees_wakes_above_the_cursor() {
        let mut a = ActiveSet::new();
        for s in [70, 3, 31, 32, 5] {
            a.insert(s);
        }
        let mut seen = Vec::new();
        let mut cur = 0;
        while let Some(s) = a.next_at_or_after(cur) {
            seen.push(s);
            if s == 5 {
                a.insert(40); // woken above the cursor: runs in this pass
                a.insert(4); // below: next pass
            }
            cur = s + 1;
        }
        assert_eq!(seen, vec![3, 5, 31, 32, 40, 70]);
        assert!(a.contains(4));
        a.fill(33);
        assert_eq!(a.count(), 33);
        assert!(a.contains(32) && !a.contains(33));
        a.fill(64);
        assert_eq!(a.count(), 64);
        a.fill(0);
        assert_eq!(a.next_at_or_after(0), None);
    }

    #[test]
    fn the_first_source_wakes_and_the_others_go_stale() {
        let mut s = Scheduler::new();
        let (src, dst) = (s.alloc_list(), s.alloc_list());
        let e = Sleeper::new(9, 7);
        s.activate(e);
        s.sleep(e);
        s.watch(e, src);
        s.watch(e, dst);
        s.wake_after(e, 10);
        assert!(!s.is_active(e));
        assert_eq!(s.stats().live_registrations, 3);
        s.notify(dst);
        assert!(s.is_active(e));
        assert_eq!(s.stats().live_registrations, 0);
        let seq = s.wake_seq(e);
        // The stale nodes never wake it again: sleep without registering, then fire the old sources.
        s.sleep(e);
        s.notify(src);
        for t in 1..=10 {
            s.fire_timers(t);
        }
        assert!(!s.is_active(e), "stale registrations do not wake");
        assert_eq!(s.wake_seq(e), seq);
        assert_eq!(s.stats().nodes_in_use, 0, "fired lists free their nodes");
    }

    #[test]
    fn a_delay_of_zero_means_the_next_tick_and_long_delays_use_the_heap() {
        let mut s = Scheduler::new();
        s.fire_timers(100);
        let (a, b) = (Sleeper::new(1, 0), Sleeper::new(1, 1));
        for e in [a, b] {
            s.activate(e);
            s.sleep(e);
        }
        s.wake_after(a, 0);
        s.wake_after(b, 10_000);
        s.fire_timers(101);
        assert!(s.is_active(a) && !s.is_active(b));
        for t in 102..10_100 {
            s.fire_timers(t);
        }
        assert!(!s.is_active(b));
        s.fire_timers(10_100);
        assert!(s.is_active(b));
    }

    #[test]
    fn a_timer_set_before_phase_2_is_not_due_in_the_same_tick() {
        // §4.6: a timer is due no earlier than the next tick, whatever phase schedules it.
        let mut s = Scheduler::new();
        let e = Sleeper::new(1, 0);
        s.activate(e);
        s.begin_tick(7);
        s.sleep(e);
        s.wake_after(e, 1); // scheduled in phase 1 of tick 7
        s.fire_timers(7);
        assert!(!s.is_active(e), "not in tick 7");
        s.begin_tick(8);
        s.fire_timers(8);
        assert!(s.is_active(e), "in tick 8");
    }

    #[test]
    fn more_than_four_registrations_is_a_bug() {
        let mut s = Scheduler::new();
        let lists: Vec<ListId> = (0..5).map(|_| s.alloc_list()).collect();
        let e = Sleeper::new(1, 0);
        s.sleep(e);
        for l in &lists[..4] {
            s.watch(e, *l);
        }
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.watch(e, lists[4])));
        assert!(r.is_err());
    }

    #[test]
    fn retained_nodes_stay_within_twice_the_live_registrations() {
        // Many sleepers registering on one long-lived list that never fires, each woken by a timer: without
        // compaction the list would grow without bound.
        let mut s = Scheduler::new();
        let never = s.alloc_list();
        let n = 1000u32;
        for i in 0..n {
            s.activate(Sleeper::new(2, i));
        }
        for t in 1..2000u32 {
            for i in (t % 7..n).step_by(7) {
                let e = Sleeper::new(2, i);
                if s.is_active(e) {
                    s.sleep(e);
                    s.watch(e, never);
                    s.wake_after(e, 1 + (i % 5));
                }
            }
            s.fire_timers(t);
            let st = s.stats();
            // Without reclamation `never` alone would hold about 285,000 nodes by the end.
            assert!(st.nodes_in_use <= 2 * st.live_registrations + 64 + 8, "tick {t}: {st:?}");
        }
        let st = s.stats();
        assert!(st.compactions > 0, "{st:?}");
    }

    #[test]
    fn forget_drops_registrations_so_a_reused_slot_is_not_woken() {
        let mut s = Scheduler::new();
        let l = s.alloc_list();
        let e = Sleeper::new(3, 4);
        s.activate(e);
        s.sleep(e);
        s.watch(e, l);
        s.forget(e);
        // The slot is reused by a new entity, which sleeps without registering on `l`.
        s.activate(e);
        s.sleep(e);
        s.notify(l);
        assert!(!s.is_active(e));
        assert_eq!(s.stats().live_registrations, 0);
    }

    #[test]
    fn no_sleep_bypasses_everything() {
        let mut s = Scheduler::new();
        let l = s.alloc_list();
        let e = Sleeper::new(1, 2);
        s.activate(e);
        s.set_no_sleep(true);
        s.sleep(e);
        s.watch(e, l);
        s.wake_after(e, 3);
        assert!(s.is_active(e));
        assert_eq!(s.stats().live_registrations, 0);
        assert_eq!(s.stats().nodes_in_use, 0);
    }
}
