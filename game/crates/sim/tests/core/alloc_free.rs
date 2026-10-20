//! §2.5: the steady-state tick allocates nothing. A counting allocator (test-only; the module's own counting
//! allocator behind `sim_allocs` is simabi's, C2c) counts the allocations of this test's thread while the
//! golden world runs idle ticks after a warm-up: the preflight, the seq watermarks, the timers, the digest's
//! preimage and the slice of every shard. The growth paths (a first watermark record, a buffer's first use)
//! happen in the warm-up.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<u64> = const { Cell::new(0) };
}

// SAFETY: forwards every call to the system allocator unchanged; the counters are thread-local cells that
// never allocate.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if COUNTING.with(Cell::get) {
            COUNT.with(|c| c.set(c.get() + 1));
        }
        // SAFETY: the caller's contract is System's.
        unsafe { System.alloc(l) }
    }

    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(p, l) }
    }

    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        if COUNTING.with(Cell::get) {
            COUNT.with(|c| c.set(c.get() + 1));
        }
        // SAFETY: as above.
        unsafe { System.realloc(p, l, n) }
    }
}

#[global_allocator]
static A: Counting = Counting;

#[test]
fn idle_ticks_allocate_nothing() {
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    // Warm-up: a whole cycle of the 3,600 slice shards, so every buffer has met its largest shard.
    for _ in 0..3600 {
        c.tick(&[]).expect("an idle tick");
    }
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    for _ in 0..3600 {
        c.tick(&[]).expect("an idle tick");
    }
    COUNTING.with(|x| x.set(false));
    assert_eq!(COUNT.with(Cell::get), 0, "allocations in 3,600 steady-state ticks");
}

/// C2a-r1 finding 9: a factory that sleeps and wakes all the time (watch lists, wheel and heap timers,
/// compactions and sweeps) allocates nothing once its buffers have grown.
#[test]
fn sleeping_and_waking_allocate_nothing_once_warm() {
    use crate::sched_equivalence::Toy;
    let mut toy = Toy::new(Toy::random(5), false);
    let mut ops = sim::rng::Xoshiro128::seeded(5, 2);
    for _ in 0..20_000 {
        toy.step(&mut ops);
    }
    let before = toy.sched.stats();
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    for _ in 0..20_000 {
        toy.step(&mut ops);
    }
    COUNTING.with(|x| x.set(false));
    let after = toy.sched.stats();
    assert!(after.sweeps > before.sweeps && after.compactions > before.compactions, "{before:?} {after:?}");
    assert_eq!(COUNT.with(Cell::get), 0, "allocations in 20,000 ticks of sleeps and wakes");
}
