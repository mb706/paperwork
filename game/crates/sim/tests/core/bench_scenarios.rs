//! The M0 benchmark scenarios (§10.6; `sim::testkit::bench`) build what they claim, and their actions are all
//! accepted, so `simtool bench` times the work it names.

use crate::common::*;
use schema::codec::Reader;
use schema::events::EventPayload;
use sim::testkit::bench;

fn refusals(c: &mut sim::SimContext) -> usize {
    let mut out = Vec::new();
    c.pres.events.drain(&mut out);
    let mut r = Reader::new(&out);
    let mut n = 0;
    while !r.is_empty() {
        let (_, p) = schema::events::read_event(&mut r).expect("the sim's events decode");
        n += usize::from(matches!(p, EventPayload::ActionFailed(_)));
    }
    n
}

#[test]
fn m0_walk_walks_east_through_new_land() {
    let mut b = bench::m0_walk(&protos()).expect("the scenario");
    let before = b.ctx.world().expect("w").chunks.generated().len();
    b.run(1_200).expect("ticks");
    let w = b.ctx.world().expect("w");
    let p = w.players.get(schema::PlayerIndex(0)).expect("player 0");
    // 0.15 tiles per tick from tick 2 (the dry map is all grass, dirt and sand: walking speed 1).
    assert!(p.x > 170.0 && p.y.abs() < 1.0, "at ({}, {})", p.x, p.y);
    let after = w.chunks.generated().len();
    assert!(after >= before + 5 * 15, "{before} → {after} generated chunks");
    assert_eq!(refusals(&mut b.ctx), 0);
}

#[test]
fn m0_chests_10k_has_its_chests_windows_and_view() {
    let (mut b, windows) = bench::m0_chests_10k(&protos()).expect("the scenario");
    assert_eq!(windows.len(), 32);
    let w = b.ctx.world().expect("w");
    assert_eq!(w.entity_count(), 10_000);
    assert_eq!(b.ctx.pres.extract.subscriptions(), 32);
    let view = b.view.clone();
    let full = b.ctx.extract(&view).expect("the FULL packet");
    let first = b.ctx.extract(&view).expect("a packet");
    assert!(first.len() > 100_000, "the held chunks' chests and the 32 windows: {} bytes", first.len());
    b.run(1).expect("a tick");
    let steady = b.ctx.extract(&view).expect("a packet");
    // The FULL packet holds no chunk (rule 31): its header and the join's event.
    assert!(full.len() <= 64 && steady.len() < 200, "{} then {} bytes", full.len(), steady.len());
    assert_eq!(refusals(&mut b.ctx), 0);
}

#[test]
fn m0_codec_actions_are_all_accepted() {
    let (mut b, chest) = bench::m0_codec(&protos()).expect("the scenario");
    let t0 = b.tick();
    for t in t0 + 1..=t0 + 50 {
        bench::codec_tick(&mut b, t, chest).expect("queued");
    }
    let mut n = 0;
    for _ in 0..50 {
        let c = b.next_closure();
        n += schema::ClosureIter::new(&c).count();
        b.ctx.tick(&c).expect("a tick");
    }
    assert_eq!(n, 50 * 100);
    assert_eq!(refusals(&mut b.ctx), 0, "every action is accepted");
    // The bar moved with the ticks.
    let w = b.ctx.world().expect("w");
    let row = sim::handle::slot(w.entity(schema::Serial(chest)).expect("the chest")) as usize;
    let inv = w.containers.inv[w.entities.pool_slot[row] as usize];
    assert_eq!(w.heap.bar(inv).map(u32::from), Some((t0 + 50) % 33));
}

#[test]
fn m0_load_states_load_without_regenerating() {
    let state = bench::m0_load_state(&protos(), 1_000).expect("the state");
    let mut c = ctx();
    c.load(&state_input(&state)).expect("loads");
    let w = c.world().expect("w");
    assert!(w.chunks.generated().len() >= 1_000);
    let modified = w.chunks.generated().iter().filter(|g| w.chunks.is_modified(g.surface, g.key)).count();
    // Every hundredth chunk generated after the 225 of the spawn area is modified.
    assert_eq!(modified, (1_000 - 225) / 100, "mostly pristine");
    assert_eq!(w.regen.generated(), 0, "a load regenerates nothing");
    let mut b = bench::m0_load_30k_walk(c).expect("the walker");
    let mut most = 0;
    for _ in 0..600 {
        let before = b.ctx.world().expect("w").regen.generated();
        b.run(1).expect("a tick");
        most = most.max(b.ctx.world().expect("w").regen.generated() - before);
    }
    assert!((1..=8).contains(&most), "at most 8 regenerations a tick: {most}");
}
