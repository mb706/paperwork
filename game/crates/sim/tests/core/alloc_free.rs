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

/// §2.5 with the rules running: a character walking to and fro (collision every tick) while it hand-mines ore
/// (a unit every 120 ticks: insertion, auto-sort, flying texts, statistics) allocates nothing once warm. The
/// events are drained every tick into one buffer, as extraction does.
#[test]
fn a_walking_mining_character_allocates_nothing_once_warm() {
    use schema::{
        Action, BeginMiningTerrainAction, Direction, FinePos, JoinFlags, MiningTarget, PlayerIndex,
        PlayerJoinedAction, StartWalkingAction,
    };
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    // A new player at the spawn point mines the golden map's ore tile (1, 1) (500 ore), within reach of
    // everywhere its walk takes it.
    let me = PlayerIndex(2);
    let ore = c.world().expect("w").resource_at(schema::SurfaceIndex(0), 1, 1).expect("ore on (1, 1)");
    assert!(ore.amount >= 500);
    let mut seq = sim::testkit::TestSequencer::new(&c);
    seq.push_system(1, &Action::PlayerJoined(PlayerJoinedAction { player: me, flags: JoinFlags::EMPTY }))
        .expect("in order");
    let mine = Action::BeginMiningTerrain(BeginMiningTerrainAction {
        input_gen: 0,
        kind: MiningTarget::ResourceTile,
        pos: FinePos { x: 256 + 128, y: 256 + 128 },
    });
    seq.push(2, me, &mine).expect("in order");
    for t in (3..7200).step_by(6) {
        let dir = if (t / 6) % 2 == 0 { Direction::East } else { Direction::West };
        seq.push(t, me, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir })).expect("in order");
    }
    let closures: Vec<Vec<u8>> = (1..=7200).map(|t| seq.closure(t)).collect();
    let mut events = Vec::with_capacity(1 << 16);
    let mut run = |c: &mut sim::SimContext, range: std::ops::Range<usize>| {
        for closure in &closures[range] {
            c.tick(closure).expect("a tick");
            events.clear();
            c.pres.events.drain(&mut events);
        }
    };
    run(&mut c, 0..3600);
    let mined = c.world().expect("w").stats().iter().map(|s| s.produced_total).sum::<f64>();
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    run(&mut c, 3600..7200);
    COUNTING.with(|x| x.set(false));
    let w = c.world().expect("w");
    let more = w.stats().iter().map(|s| s.produced_total).sum::<f64>();
    assert!(more >= mined + 25.0, "it kept mining: {mined} then {more}");
    assert_eq!(w.players.get(me).expect("p2").mining.mode, sim::r#gen::MiningMode::ResourceTile);
    assert_eq!(COUNT.with(Cell::get), 0, "allocations in 3,600 ticks of walking and mining");
}

/// §2.5 at the boundary: the shell's per-tick calls (`sim_tick`, `sim_digest`, `sim_pending_chunks`) and an
/// extraction every tick with the golden subscriptions, a STATS with its series, DEBUG and the hover allocate
/// nothing once their buffers have grown, while a character walks and mines (the records change every tick).
#[test]
fn ticks_and_extractions_allocate_nothing_once_warm() {
    use schema::codec::{MsgList, Packed, Writer};
    use schema::projections::{ProjectionKind, SubRequest};
    use schema::{
        Action, BeginMiningTerrainAction, Direction, FinePos, JoinFlags, MiningTarget, PlayerIndex,
        PlayerJoinedAction, StartWalkingAction, SubFlags, SubId,
    };
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    let me = PlayerIndex(2);
    let mut seq = sim::testkit::TestSequencer::new(&c);
    seq.push_system(1, &Action::PlayerJoined(PlayerJoinedAction { player: me, flags: JoinFlags::EMPTY }))
        .expect("in order");
    let mine = Action::BeginMiningTerrain(BeginMiningTerrainAction {
        input_gen: 0,
        kind: MiningTarget::ResourceTile,
        pos: FinePos { x: 256 + 128, y: 256 + 128 },
    });
    seq.push(2, me, &mine).expect("in order");
    for t in (3..7200).step_by(6) {
        let dir = if (t / 6) % 2 == 0 { Direction::East } else { Direction::West };
        seq.push(t, me, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir })).expect("in order");
    }
    let closures: Vec<Vec<u8>> = (1..=7200).map(|t| seq.closure(t)).collect();
    let view = crate::common::golden("view.bin");
    c.extract(&view).expect("the FULL packet");
    c.subscribe(&crate::common::golden("subs.bin")).expect("the golden subscriptions");
    let sub = |id: u32, kind, target: u32, p0: u32, p2: u32| SubRequest {
        sub_id: SubId(id),
        kind,
        flags: SubFlags::EMPTY,
        target,
        p0,
        p1: 0,
        p2,
        p3: 0,
        tail: None,
    };
    let more = [
        sub(20, ProjectionKind::Stats, 0, 0, 1),
        sub(21, ProjectionKind::Debug, 0, 0, 0),
        sub(22, ProjectionKind::Character, 2, 0, 0),
    ];
    let mut input = Vec::new();
    schema::SubscribeInput { subs: MsgList::from_slice(&more) }
        .encode(&mut Writer::new(&mut input))
        .expect("encodes");
    c.subscribe(&input).expect("subscribes");
    let mut out = Vec::with_capacity(1 << 20);
    let mut packets = 0usize;
    let mut run = |c: &mut sim::SimContext, range: std::ops::Range<usize>| {
        for closure in &closures[range] {
            c.tick(closure).expect("a tick");
            out.clear();
            c.digest_into(&mut out).expect("a digest");
            out.clear();
            c.pending_chunks_into(&mut out).expect("the requests");
            out.clear();
            c.extract_into(&view, &mut out).expect("a packet");
            packets += out.len();
        }
    };
    run(&mut c, 0..3600);
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    run(&mut c, 3600..7200);
    COUNTING.with(|x| x.set(false));
    assert!(packets > 3600 * 64, "the packets carry records: {packets} bytes");
    assert_eq!(COUNT.with(Cell::get), 0, "allocations in 3,600 ticks with their calls and extractions");
}

/// Runs `ticks` empty-closure ticks of `b` with the shell's per-tick calls and, with `view`, an extraction each;
/// returns, per tick, the allocations counted and the chunks generated or requested (the generation path).
fn steady(
    b: &mut sim::testkit::bench::Bench,
    ticks: u32,
    view: Option<&[u8]>,
    out: &mut Vec<u8>,
) -> Vec<(u64, u64)> {
    let mut per_tick = Vec::with_capacity(ticks as usize);
    for _ in 0..ticks {
        let generated = b.ctx.world().expect("w").regen.generated();
        let before = COUNT.with(Cell::get);
        b.ctx.tick(&[]).expect("a tick");
        out.clear();
        b.ctx.digest_into(out).expect("a digest");
        out.clear();
        b.ctx.pending_chunks_into(out).expect("the requests");
        let requested = schema::PendingChunks::decode_exact(out).expect("the requests").requests.len() as u64;
        if let Some(v) = view {
            out.clear();
            b.ctx.extract_into(v, out).expect("a packet");
        }
        let regenerated = b.ctx.world().expect("w").regen.generated() - generated;
        per_tick.push((COUNT.with(Cell::get) - before, regenerated + requested));
    }
    per_tick
}

/// §2.5's gate on §10.6's M0 scenarios (B1-r1 22): 6,000 steady-state ticks of `m0-chests-10k` (with an
/// extraction of its 32 windows each) and of `m0-codec` (100 actions a tick) allocate nothing.
#[test]
fn the_bench_scenarios_allocate_nothing_in_their_steady_states() {
    use sim::testkit::bench;
    let protos = crate::common::protos();
    let mut out = Vec::with_capacity(1 << 20);
    let (mut b, _) = bench::m0_chests_10k(&protos).expect("m0-chests-10k");
    let view = b.view.clone();
    steady(&mut b, 3_600, Some(&view), &mut out);
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    let ticks = steady(&mut b, 6_000, Some(&view), &mut out);
    COUNTING.with(|x| x.set(false));
    assert_eq!(ticks.iter().map(|t| t.0).sum::<u64>(), 0, "m0-chests-10k: allocations in 6,000 ticks");

    // m0-codec: the closures are encoded first; applying them is the steady state.
    let (mut b, chest) = bench::m0_codec(&protos).expect("m0-codec");
    let t0 = b.tick();
    let mut closures = Vec::with_capacity(9_600);
    for t in t0 + 1..=t0 + 9_600 {
        bench::codec_tick(&mut b, t, chest).expect("queued");
        closures.push(b.seq.closure(t));
    }
    let mut events = Vec::with_capacity(1 << 20);
    let mut run = |b: &mut bench::Bench, cs: &[Vec<u8>]| {
        for c in cs {
            b.ctx.tick(c).expect("a tick");
            events.clear();
            b.ctx.pres.events.drain(&mut events);
        }
    };
    run(&mut b, &closures[..3_600]);
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    run(&mut b, &closures[3_600..]);
    COUNTING.with(|x| x.set(false));
    assert_eq!(COUNT.with(Cell::get), 0, "m0-codec: allocations in 6,000 ticks of 100 actions");
}

/// The growth paths are measured, not banned (§2.5): in `m0-walk` (inline commits through new land) and after
/// `m0-load-30k`'s load (a walk through pristine chunks, here 4,000 of them, and on into new land), only ticks
/// that request or generate a chunk allocate once the module is warm (a whole cycle of the 3,600 digest
/// shards).
#[test]
fn walking_into_new_or_pristine_land_allocates_only_to_generate() {
    use sim::testkit::bench;
    let protos = crate::common::protos();
    let mut out = Vec::with_capacity(1 << 20);
    let mut b = bench::m0_walk(&protos).expect("m0-walk");
    b.run(2).expect("the join and the first step");
    steady(&mut b, 6_000, None, &mut out);
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    let ticks = steady(&mut b, 6_000, None, &mut out);
    COUNTING.with(|x| x.set(false));
    let (gen_ticks, generated) = ticks.iter().fold((0, 0), |(n, g), t| (n + u64::from(t.1 > 0), g + t.1));
    let stray: Vec<usize> =
        ticks.iter().enumerate().filter(|(_, t)| t.0 > 0 && t.1 == 0).map(|(i, _)| i).collect();
    assert!(generated >= 2 * (6_000 * 15 / 213 - 15), "{generated} chunks requested and generated");
    assert!(stray.is_empty(), "m0-walk: ticks that allocate without requesting or generating: {stray:?}");
    eprintln!(
        "m0-walk: {} allocations in {gen_ticks} ticks that requested or generated {generated} chunks",
        ticks.iter().map(|t| t.0).sum::<u64>()
    );

    let state = bench::m0_load_state(&protos, 4_000).expect("the state");
    let mut c = crate::common::ctx();
    c.load(&crate::common::state_input(&state)).expect("loads");
    let mut b = bench::m0_load_30k_walk(c).expect("the walker");
    b.run(1).expect("the first step");
    steady(&mut b, 3_600, None, &mut out);
    COUNT.with(|x| x.set(0));
    COUNTING.with(|x| x.set(true));
    let ticks = steady(&mut b, 3_000, None, &mut out);
    COUNTING.with(|x| x.set(false));
    let stray: Vec<usize> =
        ticks.iter().enumerate().filter(|(_, t)| t.0 > 0 && t.1 == 0).map(|(i, _)| i).collect();
    assert!(ticks.iter().any(|t| t.1 > 0), "the walk regenerates pristine chunks");
    assert!(stray.is_empty(), "m0-load: ticks that allocate without requesting or generating: {stray:?}");
}
