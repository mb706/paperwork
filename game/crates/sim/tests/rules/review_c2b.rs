//! Regression tests for codex's review of C2b (pm/reviews/C2b-r1.md) at the rule level (findings 5–7 and 9);
//! the loads and the world identity are in `tests/core/review_c2b.rs`, worldgen's bounds and calibration in
//! `crates/worldgen/tests/`, the scheduling bound in `regen.rs`. Each fails on the code the review read.

use crate::common::patch_section;
use crate::helpers::*;
use schema::codec::Writer;
use schema::events::EventPayload;
use schema::{Direction, FailReason, ItemKey, PlayerIndex, SaveSection, Serial, SurfaceIndex, chunk_key};
use sim::testkit::{Scenario, TestSequencer};

const PLATE: ItemKey = ItemKey(2 << 3);

/// The golden start with player 0's main inventory holding two stacks of 100 iron plates (slots 0 and 1) and
/// nothing else.
fn two_stacks() -> Vec<u8> {
    patch_section(&golden("states/tick-0000.sections"), SaveSection::SlotHeap, |b| {
        let mut h = sim::r#gen::decode_slot_heap(b).expect("heap");
        let a = h.arenas.iter_mut().find(|a| a.class == 7).expect("the main inventory's class");
        a.slots[..128].fill(sim::heap::EMPTY_SLOT);
        a.slots[0] = schema::Slot { key: PLATE, count: 100 };
        a.slots[1] = schema::Slot { key: PLATE, count: 100 };
        let mut out = Vec::new();
        sim::r#gen::encode_slot_heap(&mut Writer::new(&mut out), &h).expect("encodes");
        out
    })
}

fn failures(events: &[(schema::events::EventHeader, EventPayload)]) -> Vec<FailReason> {
    events
        .iter()
        .filter_map(|(_, e)| match e {
            EventPayload::ActionFailed(f) => Some(f.reason),
            _ => None,
        })
        .collect()
}

/// Finding 6: a fast transfer that empties the hand refills it from the inventory (I §3.8, corrected
/// 2026-10-20), its origin the slot it came from; a partial one leaves the rest in the hand.
#[test]
fn a_fast_transfer_refills_the_emptied_cursor() {
    let mut s = Scenario::from_state("c2b-fast-transfer-refill", &protos(), &two_stacks()).expect("loads");
    s.act(0, click_main(0)); // the hand takes slot 0's 100 plates
    s.run(1);
    assert_eq!((s.player(0).hand.count, s.player(0).hand.origin), (100, 0));
    let version = s.player(0).inventory_version;
    s.events();
    s.act(0, fast(serial(2))); // chest A takes all 100
    s.run(1);
    let p = s.player(0);
    assert_eq!((p.hand.key, p.hand.count, p.hand.ghost), (PLATE, 100, false), "the cursor refilled");
    assert_eq!(p.hand.origin, 1, "from slot 1, which it now reserves");
    assert_eq!(count(&s, 0, PLATE), 0, "the second stack is in the hand");
    assert!(s.player(0).inventory_version > version);
    let texts: Vec<_> = s
        .events()
        .into_iter()
        .filter_map(|(_, e)| match e {
            EventPayload::FlyingText(t) => Some((t.count, t.total)),
            _ => None,
        })
        .collect();
    assert_eq!(texts, vec![(-100, 100)], "the text counts what left and what the inventory held");
    // Chest A now holds plates 100 (slot 0), ore 20 (1) and plates 30 (2). Limited to its first two slots it
    // takes nothing: nothing moves and no text appears. Limited to three, 70 fit: the rest stays in the hand,
    // which is not empty, so nothing refills.
    s.act(0, bar(2));
    s.act(0, fast(serial(2)));
    s.run(1);
    assert_eq!(s.player(0).hand.count, 100, "nothing fits: nothing moves");
    s.act(0, bar(3));
    s.act(0, fast(serial(2)));
    s.run(1);
    let p = s.player(0);
    assert_eq!((p.hand.count, p.hand.origin), (30, 1), "a partial transfer keeps the rest, not refilled");
    finish(&s);
}

fn bar(bar: u16) -> schema::Action<'static> {
    schema::Action::SetInventoryBar(schema::SetInventoryBarAction {
        target: serial(2),
        inv: schema::InventoryType::Chest,
        bar,
    })
}

/// Finding 5: with the serial counter exhausted, a build (on a pristine chunk) and a join are refused and
/// change nothing; the reviewed code made the chunk modified and then trapped.
#[test]
fn an_exhausted_serial_counter_refuses_builds_and_joins() {
    let mut s = scenario("c2b-serials-exhausted", 1945);
    s.system(joined(0));
    s.run(1);
    s.act(0, craft(recipe(&s, "iron-chest"), 0));
    s.run(31);
    s.act(0, click_main(0));
    s.run(1);
    let state = patch_section(&s.ctx.checkpoint().expect("saves"), SaveSection::Globals, |b| {
        let mut g = sim::r#gen::decode_globals(b).expect("globals");
        g.next_serial = Serial(u32::MAX);
        let mut out = Vec::new();
        sim::r#gen::encode_globals(&mut Writer::new(&mut out), &g).expect("encodes");
        out
    });
    let mut s = Scenario::from_state("c2b-serials-exhausted", &protos(), &state).expect("loads");
    let modified = s.world().chunks.modified_count();
    let chest = item(&s, "iron-chest");
    s.act(0, build(chest, 2, 0));
    s.system(joined(1));
    s.run(1);
    assert_eq!(failures(&s.events()), vec![FailReason::Unsupported, FailReason::Unsupported]);
    assert_eq!(s.world().chunks.modified_count(), modified, "the pristine chunk stayed pristine");
    assert_eq!(s.world().entity_count(), 0);
    assert!(s.world().players.get(PlayerIndex(1)).is_none(), "no character for the joiner");
    assert_eq!(s.player(0).hand.count, 1, "the hand kept its chest");
    s.check_equivalence(&[1], 1).unwrap_or_else(|e| panic!("{e}"));
}

/// Finding 7: begin_mining_terrain out of reach is refused before any terrain is read: 1,000 targets in
/// distant pristine chunks of a loaded world regenerate nothing (the reviewed code generated each).
#[test]
fn distant_mining_targets_generate_nothing() {
    let mut s = scenario("c2b-distant-mining", 7);
    {
        let w = s.ctx.world_mut().expect("w");
        for i in 0..1200i32 {
            w.chunks
                .insert_generated(sim::r#gen::GeneratedChunk {
                    surface: SurfaceIndex(0),
                    key: chunk_key(50 + i % 40, 50 + i / 40),
                    kappa: 0.005,
                    theta: 14.0,
                    sunlight: 1.0,
                })
                .expect("new");
        }
    }
    let save = s.ctx.checkpoint().expect("saves");
    let mut c = sim::testkit::start_from(&protos(), &save, schema::SimFlags::EMPTY).expect("loads");
    let mut q = TestSequencer::new(&c);
    let t = c.world().expect("w").current_tick();
    q.push_system(t + 1, &joined(0)).expect("in order");
    c.tick(&q.closure(t + 1)).expect("joins");
    let before = c.world().expect("w").regen.generated();
    for i in 0..1000i32 {
        let (cx, cy) = (50 + i % 40, 50 + i / 40);
        let kind = if i % 2 == 0 { schema::MiningTarget::ResourceTile } else { schema::MiningTarget::Tile };
        let a = schema::Action::BeginMiningTerrain(schema::BeginMiningTerrainAction {
            input_gen: 0,
            kind,
            pos: schema::FinePos { x: (cx * 32 + 5) * 256, y: (cy * 32 + 5) * 256 },
        });
        q.push(t + 2, PlayerIndex(0), &a).expect("in order");
    }
    c.pres.events.drain(&mut Vec::new());
    c.tick(&q.closure(t + 2)).expect("a tick");
    assert_eq!(c.world().expect("w").regen.generated(), before, "no distant chunk generated");
    let mut out = Vec::new();
    let (n, _) = c.pres.events.drain(&mut out);
    assert_eq!(n, 1000, "every target refused, out of reach");
}

/// Finding 9: the sequencer gives each action its seq when it is queued, refuses a player's action for an
/// earlier tick than its last, and stamps held inputs with the generation its own queued releases raised.
#[test]
fn the_sequencer_assigns_identities_and_order_at_send_time() {
    let mut s = scenario("c2b-sequencer", 1945);
    s.system(joined(0));
    s.run(1);
    s.act(0, craft(recipe(&s, "iron-chest"), 0));
    s.run(31);
    let t = s.tick();
    // Send order: one for tick t + 10, then one for t + 5: refused (D21), not given the earlier seq.
    let first = s.seq.push(t + 10, PlayerIndex(0), &stop()).expect("in order");
    let e = s.seq.push(t + 5, PlayerIndex(0), &stop()).expect_err("an earlier tick after a later one");
    assert!(e.0.contains("D21"), "{e}");
    let next = s.seq.push(t + 10, PlayerIndex(0), &click_main(0)).expect("same tick");
    assert_eq!(next.0, first.0 + 1, "seqs in send order");
    // Identities at send time: the build's seq names it by creation id in the same closure.
    let k = s.seq.push(t + 10, PlayerIndex(0), &build(item(&s, "iron-chest"), 2, 0)).expect("in order");
    s.seq.push(t + 10, PlayerIndex(0), &fast(creation(k.0, 0))).expect("in order");
    // Generations: a release queued for t + 11 raises the stamp of what is queued after it.
    let g = s.seq.input_gen(PlayerIndex(0));
    s.seq.push_system(t + 11, &release(0)).expect("in order");
    assert_eq!(s.seq.input_gen(PlayerIndex(0)), g.wrapping_add(1));
    s.seq.push(t + 12, PlayerIndex(0), &walk(Direction::East)).expect("in order");
    s.events();
    s.run_until(t + 13);
    let events = s.events();
    assert!(events.iter().any(|(_, e)| matches!(e, EventPayload::EntityBuilt(_))));
    assert!(
        !events.iter().any(|(_, e)| matches!(e, EventPayload::InputFenced)),
        "the walk carries the new generation"
    );
    assert!(s.player(0).walking);
    assert_eq!(
        failures(&events),
        vec![FailReason::NothingToTransfer],
        "the creation id named the empty new chest"
    );
    finish(&s);
}
