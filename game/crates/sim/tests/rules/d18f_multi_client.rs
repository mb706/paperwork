//! D18 (f), the multi-client harness (10 §10.4 #8; C8): one closure stream, several worlds, joins by checkpoint
//! mid-run, crashes that come back from a client's own checkpoint and catch up, a re-sync from another client's
//! snapshot, NO_SLEEP on one client, and three read schedules (every tick with subscriptions, never, at random
//! with queries). Every tick the clients' d_t and r_t agree; after every fault their full canonical states do.
//! The harness also finds a divergence planted on purpose, and names its section and field.

use crate::helpers::*;
use schema::{Action, Direction, PlayerIndex};
use sim::rng::Xoshiro128;
use sim::testkit::multi::{self, Reads, Room};

const DIRS: [Direction; 8] = [
    Direction::East,
    Direction::SouthEast,
    Direction::South,
    Direction::SouthWest,
    Direction::West,
    Direction::NorthWest,
    Direction::North,
    Direction::NorthEast,
];

/// A new world's start state.
fn start(seed: u32) -> Vec<u8> {
    let s = scenario("d18f-start", seed);
    s.start_state().0.to_vec()
}

/// Every few ticks, each online player does something: walks, stops, mines at its feet, crafts, picks a stack,
/// builds the chest it holds next to it, or fast-transfers into a chest nearby (by serial).
fn act(room: &mut Room, g: &mut Xoshiro128) {
    for i in 0..4u16 {
        if !g.next_u32().is_multiple_of(9) {
            continue;
        }
        let Some(w) = room.clients[0].ctx.world() else { return };
        let Some(p) = w.players.get(PlayerIndex(i)) else { continue };
        if !p.online {
            continue;
        }
        let (x, y) = (p.x.floor() as i32, p.y.floor() as i32);
        let a: Action<'static> = match g.next_u32() % 8 {
            0 | 1 => walk(DIRS[(g.next_u32() % 8) as usize]),
            2 => stop(),
            3 => mine_tile(x + (g.next_u32() % 5) as i32 - 2, y + (g.next_u32() % 5) as i32 - 2),
            4 => craft(0, 1),
            5 => click_main((g.next_u32() % 4) as u16),
            6 => build(schema::ItemKey(0), x + 2, y),
            _ => fast(serial(1 + g.next_u32() % 12)),
        };
        room.act(i, a);
    }
}

#[test]
fn one_stream_many_worlds_agree_after_every_fault() {
    let protos = protos();
    let mut room = Room::new(&protos, &start(7), "founder", Reads::EveryTick { follow: 0, half: 30 })
        .expect("the room starts");
    let mut g = Xoshiro128::seeded(2026, 21);
    let mut faults = 0;
    let agree = |room: &Room, what: &str| room.agree().unwrap_or_else(|e| panic!("{what}: {e}"));
    room.system(joined(0));
    room.system(joined(1));
    room.run(1).expect("tick 1");
    for t in 2..=3000u32 {
        match t {
            300 => {
                room.join("late", "founder", Reads::None).expect("a join");
                agree(&room, "a join by checkpoint");
                room.system(joined(2));
                faults += 1;
            }
            700 => {
                room.join("reader", "late", Reads::Random { seed: 5 }).expect("a join");
                room.system(joined(3));
                agree(&room, "a second join, from the first joiner");
                faults += 1;
            }
            900 => room.checkpoint("late").expect("an autosave"),
            1200 => {
                room.crash("late").expect("a crash");
                agree(&room, "a crash and catch-up from tick 900");
                faults += 1;
            }
            1400 => {
                room.set_no_sleep("reader", true).expect("NO_SLEEP");
                faults += 1;
            }
            1600 => {
                room.system(left(1));
            }
            1800 => {
                room.resync("founder", "reader").expect("a re-sync");
                agree(&room, "a re-sync of the founder from the reader");
                faults += 1;
            }
            2000 => {
                room.system(joined(1));
                room.join("sleepless", "reader", Reads::EveryTick { follow: 3, half: 12 }).expect("a join");
                room.set_no_sleep("sleepless", true).expect("NO_SLEEP");
                agree(&room, "a join of a NO_SLEEP client");
                faults += 1;
            }
            2200 => room.checkpoint("reader").expect("an autosave"),
            2500 => {
                room.system(release(2));
                room.crash("reader").expect("a crash");
                agree(&room, "a crash across a release");
                faults += 1;
            }
            _ => {}
        }
        act(&mut room, &mut g);
        room.run(1).unwrap_or_else(|e| panic!("{e}\n{}", room.log.join("\n")));
    }
    agree(&room, "the end");
    assert_eq!(room.clients.len(), 4);
    assert!(faults >= 7, "faults injected: {faults}");
    // The run touched the world: chunks were generated and something was crafted or mined.
    let w = room.clients[0].ctx.world().expect("a world");
    assert!(w.stats().iter().any(|s| s.produced_total > 0.0), "nothing was produced");
}

#[test]
fn a_planted_divergence_is_found_and_named() {
    let protos = protos();
    let mut room = Room::new(&protos, &start(7), "a", Reads::None).expect("the room starts");
    room.system(joined(0));
    room.run(5).expect("ticks");
    room.join("b", "a", Reads::None).expect("a join");
    room.agree().expect("equal after the join");
    // Past the join's dense window (every tick's full state compared), only d_t and r_t are checked per tick.
    room.run(multi::DENSE_TICKS).expect("ticks");
    // Plant a divergence in b's world: player 0 a hair to the east.
    let w = room.clients[1].ctx.world_mut().expect("a world");
    w.players.get_mut(PlayerIndex(0)).expect("player 0").x += 1.0 / 1024.0;
    let e = room.agree().expect_err("the divergence is found");
    assert!(e.contains("PLAYERS") && e.contains(".x"), "{e}");
    // And the per-tick check catches it on the next tick that slices it, at the latest at the full-state check.
    let mut caught = false;
    for _ in 0..3600 {
        if room.run(1).is_err() {
            caught = true;
            break;
        }
    }
    assert!(caught, "d_t never differed in a whole digest cycle");
}

/// A world replaced late is compared after every tick of the DENSE_TICKS after it (§10.4 #3; the M0 exit audit, C9):
/// a divergence planted 1,500 ticks after a join that came 1,000 ticks into the room is found on the next tick by
/// the full canonical states, not only when d_t happens to slice it.
#[test]
fn a_late_join_is_compared_after_every_tick_of_its_window() {
    let protos = protos();
    let mut room = Room::new(&protos, &start(7), "a", Reads::None).expect("the room starts");
    room.system(joined(0));
    room.run(1000).expect("ticks");
    room.join("b", "a", Reads::None).expect("a join, compared at once");
    room.run(1500).expect("ticks inside the window");
    room.clients[1].ctx.world_mut().expect("a world").globals.next_serial = schema::Serial(9999);
    let e = room.run(1).expect_err("the next tick compares the full states");
    assert!(e.contains("GLOBALS") && e.contains("next_serial"), "{e}");
}
