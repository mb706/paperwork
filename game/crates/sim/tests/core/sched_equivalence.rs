//! The scheduler's equivalences on a toy factory (10 §4.6; A1 findings 1–2; D18 a and b). Producers fill
//! buffers on a cooldown, consumers drain them, and an operator empties and fills buffers at random, so
//! sleepers wake through watch lists (*added*, *space*), wheel timers and heap timers. The world updated
//! every tick (NO_SLEEP), the sleeping world, a world reloaded mid-run (every entity awake, no registration,
//! as after a load) and a world whose NO_SLEEP flag is toggled on its established watch lists must agree on
//! the full state after every tick; retained nodes stay within twice the live registrations after every tick.
//! `alloc_free` runs the same factory to show that sleeping and waking allocate nothing once warm.

use sim::rng::Xoshiro128;
use sim::sched::{ListId, Scheduler, Sleeper};

const PRODUCER: u8 = 1;
const CONSUMER: u8 = 2;

/// The toy's saved state: what a save would hold.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct State {
    tick: u32,
    count: Vec<u32>,
    cap: Vec<u32>,
    p_buf: Vec<usize>,
    p_period: Vec<u32>,
    p_next: Vec<u32>,
    c_buf: Vec<usize>,
    c_poll: Vec<u32>,
    consumed: Vec<u32>,
}

/// The toy: its state plus the derived scheduler and list ids.
pub(crate) struct Toy {
    pub(crate) s: State,
    pub(crate) sched: Scheduler,
    added: Vec<ListId>,
    space: Vec<ListId>,
}

impl Toy {
    pub(crate) fn new(s: State, no_sleep: bool) -> Self {
        let mut sched = Scheduler::new();
        sched.reset(s.tick);
        sched.set_no_sleep(no_sleep);
        let added = (0..s.count.len()).map(|_| sched.alloc_list()).collect();
        let space = (0..s.count.len()).map(|_| sched.alloc_list()).collect();
        // Every entity starts awake (§4.6: after a load).
        for i in 0..s.p_buf.len() {
            sched.activate(Sleeper::new(PRODUCER, i as u32));
        }
        for j in 0..s.c_buf.len() {
            sched.activate(Sleeper::new(CONSUMER, j as u32));
        }
        Self { s, sched, added, space }
    }

    /// NO_SLEEP on a running factory (`sim_set_flags`): the scheduler keeps the list ids, the caller activates
    /// every entity.
    fn set_no_sleep(&mut self, on: bool) {
        self.sched.set_no_sleep(on);
        if on {
            for i in 0..self.s.p_buf.len() {
                self.sched.activate(Sleeper::new(PRODUCER, i as u32));
            }
            for j in 0..self.s.c_buf.len() {
                self.sched.activate(Sleeper::new(CONSUMER, j as u32));
            }
        }
    }

    pub(crate) fn random(seed: u32) -> State {
        let mut r = Xoshiro128::seeded(seed, 1);
        let buffers = 12;
        let (np, nc) = (40, 50);
        State {
            tick: 0,
            count: vec![0; buffers],
            cap: (0..buffers).map(|_| 1 + r.next_u32() % 6).collect(),
            p_buf: (0..np).map(|_| (r.next_u32() % buffers as u32) as usize).collect(),
            // A few producers rest longer than the wheel (4,096 ticks): their cooldown wakes come from the heap.
            p_period: (0..np)
                .map(|i| if i % 8 == 0 { 4096 + r.next_u32() % 3000 } else { 1 + r.next_u32() % 40 })
                .collect(),
            p_next: vec![0; np],
            c_buf: (0..nc).map(|_| (r.next_u32() % buffers as u32) as usize).collect(),
            c_poll: (0..nc)
                .map(|_| {
                    if r.next_u32().is_multiple_of(4) {
                        4000 + r.next_u32() % 2000
                    } else {
                        1 + r.next_u32() % 50
                    }
                })
                .collect(),
            consumed: vec![0; nc],
        }
    }

    /// One tick: timers, the operator, producers in slot order, consumers in slot order (§4.6's loop).
    pub(crate) fn step(&mut self, ops: &mut Xoshiro128) {
        let t = self.s.tick + 1;
        self.s.tick = t;
        self.sched.begin_tick(t);
        self.sched.fire_timers(t);
        // The operator (an inserter or a hand): every few ticks it empties or fills a buffer.
        let op = ops.next_u32();
        if op.is_multiple_of(5) {
            let b = (op as usize / 5) % self.s.count.len();
            if op.is_multiple_of(2) {
                self.s.count[b] = 0;
                self.sched.notify(self.space[b]);
            } else {
                self.s.count[b] = self.s.cap[b];
                self.sched.notify(self.added[b]);
            }
        }
        let mut cur = 0;
        while let Some(i) = self.sched.next_active(PRODUCER, cur) {
            self.producer(i as usize, t);
            cur = i + 1;
        }
        let mut cur = 0;
        while let Some(j) = self.sched.next_active(CONSUMER, cur) {
            self.consumer(j as usize);
            cur = j + 1;
        }
    }

    fn producer(&mut self, i: usize, t: u32) {
        let me = Sleeper::new(PRODUCER, i as u32);
        let b = self.s.p_buf[i];
        if t < self.s.p_next[i] {
            // On cooldown: nothing to do until p_next (an update now provably changes nothing).
            self.sched.sleep(me);
            self.sched.wake_after(me, self.s.p_next[i] - t);
        } else if self.s.count[b] < self.s.cap[b] {
            self.s.count[b] += 1;
            self.s.p_next[i] = t + self.s.p_period[i];
            self.sched.notify(self.added[b]);
        } else {
            self.sched.sleep(me);
            self.sched.watch(me, self.space[b]);
        }
    }

    fn consumer(&mut self, j: usize) {
        let me = Sleeper::new(CONSUMER, j as u32);
        let b = self.s.c_buf[j];
        if self.s.count[b] > 0 {
            self.s.count[b] -= 1;
            self.s.consumed[j] += 1;
            self.sched.notify(self.space[b]);
        } else {
            self.sched.sleep(me);
            self.sched.watch(me, self.added[b]);
            // A poll timer as well (an arrival estimate that may be early, wake rule 3): a second registration.
            self.sched.wake_after(me, self.s.c_poll[j]);
        }
    }
}

#[test]
fn sleeping_no_sleep_and_reloaded_worlds_agree_every_tick() {
    for seed in [1u32, 2, 3] {
        let start = Toy::random(seed);
        let mut sleeping = Toy::new(start.clone(), false);
        let mut awake = Toy::new(start.clone(), true);
        let mut reloaded = Toy::new(start.clone(), false);
        let mut toggled = Toy::new(start, false);
        let (mut o1, mut o2, mut o3, mut o4) = (
            Xoshiro128::seeded(seed, 2),
            Xoshiro128::seeded(seed, 2),
            Xoshiro128::seeded(seed, 2),
            Xoshiro128::seeded(seed, 2),
        );
        let mut max_nodes = 0;
        let mut slept = 0u64;
        for t in 1..=12_000u32 {
            sleeping.step(&mut o1);
            awake.step(&mut o2);
            reloaded.step(&mut o3);
            toggled.step(&mut o4);
            if t % 1_777 == 0 {
                // A reload: the saved state alone, a fresh scheduler, every entity awake.
                reloaded = Toy::new(reloaded.s.clone(), false);
            }
            if t % 1_000 == 0 {
                // NO_SLEEP flipped on the established lists (C2a-r1 finding 3), on for odd thousands.
                toggled.set_no_sleep((t / 1_000) % 2 == 1);
            }
            assert_eq!(sleeping.s, awake.s, "seed {seed}: NO_SLEEP differs after tick {t}");
            assert_eq!(sleeping.s, reloaded.s, "seed {seed}: the reloaded world differs after tick {t}");
            assert_eq!(sleeping.s, toggled.s, "seed {seed}: the toggled world differs after tick {t}");
            for w in [&sleeping, &reloaded, &toggled] {
                let st = w.sched.stats();
                assert!(st.nodes_in_use <= 2 * st.live_registrations, "tick {t}: {st:?}");
            }
            max_nodes = max_nodes.max(sleeping.sched.stats().nodes_in_use);
            slept += (0..40).filter(|&i| !sleeping.sched.is_active(Sleeper::new(PRODUCER, i))).count() as u64;
        }
        // The sleeping world did sleep (the test is not vacuous) and things happened.
        assert!(slept > 100_000, "seed {seed}: producers slept {slept} entity-ticks");
        assert!(sleeping.s.consumed.iter().sum::<u32>() > 1_000);
        assert!(max_nodes > 0);
    }
}
