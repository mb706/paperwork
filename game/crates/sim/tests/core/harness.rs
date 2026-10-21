//! The D18 harness itself (10 §4.1 D18 a–c, §10.2, §10.4 #2–#5): the reference run against NO_SLEEP, a reload
//! at chosen ticks (join equivalence) and heavy mode, comparing full canonical state after every tick for the
//! first 2,000 ticks. C2a runs it on the golden start with the golden closure log (whose actions, until the
//! action pipeline of C2b, only consume their seqs, rule 12) and with world churn applied identically in
//! every run; a deliberate divergence must be found and named down to the field.

use crate::common::*;
use schema::container::ClosureLog;
use schema::{Direction, EntityFlags, EntityId, Tick};
use sim::testkit::{
    Closures, Schedule, Variant, check_equivalence, compare, record, record_windows, record_with, windows_of,
};
use sim::world::NewEntity;

/// The golden closure log's closures and blobs.
struct Log {
    bytes: Vec<u8>,
}

impl Log {
    fn golden() -> Self {
        Self { bytes: golden("closure-log.pwlog") }
    }

    fn with<R>(&self, f: impl FnOnce(&ClosureLog<'_>) -> R) -> R {
        f(&ClosureLog::parse(&self.bytes).expect("the golden log parses"))
    }
}

impl Closures for Log {
    fn closure(&self, tick: u32) -> Vec<u8> {
        self.with(|l| {
            l.records.iter().find(|r| r.tick.0 == tick).map(|r| r.closure.to_vec()).unwrap_or_default()
        })
    }

    fn blobs(&self, tick: u32) -> Vec<Vec<u8>> {
        let closure = self.closure(tick);
        self.with(|l| {
            let mut out = Vec::new();
            for a in schema::ClosureIter::new(&closure) {
                if let Ok(act) = schema::Action::decode(a.ty, a.payload)
                    && let Some(h) = act.blob()
                    && let Some(b) = l.blobs.iter().find(|b| b.sha256.bytes == h)
                {
                    out.push(b.bytes.to_vec());
                }
            }
            out
        })
    }
}

fn start() -> Vec<u8> {
    state_file(0)
}

#[test]
fn the_golden_log_is_equivalent_under_no_sleep_reloads_and_heavy_mode() {
    let p = protos();
    let variants = [
        Variant::NoSleep,
        Variant::Reload { at: 1 },
        Variant::Reload { at: 54 },
        Variant::Reload { at: 55 },
        Variant::Reload { at: 377 },
        Variant::Heavy { every: 97 },
    ];
    check_equivalence(&p, &start(), &Log::golden(), 650, &variants).unwrap_or_else(|e| panic!("{e}"));
}

/// Entity churn applied by a hook after each tick, the same in every run: what decides later allocations (the
/// lowest free rows, the generations, the serial counter, the free heap blocks) must survive a save and a load.
fn churn(t: u32, c: &mut sim::SimContext) {
    let w = c.world_mut().expect("a world");
    let mut rng = sim::rng::Xoshiro128::seeded(t, 9);
    if t.is_multiple_of(3) {
        let live = w.entities_by_serial();
        if live.len() > 2 {
            let h = live[(rng.next_u32() as usize) % live.len()];
            w.destroy_entity(h);
        }
    } else {
        let tx = (rng.next_u32() % 96) as i32 - 48;
        let ty = (rng.next_u32() % 96) as i32 - 48;
        let e = NewEntity {
            proto: EntityId(0),
            surface: 0,
            x2: 2 * tx + 1,
            y2: 2 * ty + 1,
            dir: Direction::North,
            flip: 0,
            quality: 0,
            built_by: 16,
            flags: EntityFlags::EMPTY,
            built_tick: Tick(t),
        };
        w.create_entity(&e).expect("a chest");
    }
}

#[test]
fn churn_survives_reloads_and_heavy_mode() {
    let p = protos();
    let s = Schedule::default();
    let reference =
        record_with(&p, &start(), &Log::golden(), 400, Variant::Plain, s, &mut churn).expect("runs");
    for v in [Variant::NoSleep, Variant::Reload { at: 133 }, Variant::Heavy { every: 41 }] {
        let run = record_with(&p, &start(), &Log::golden(), 400, v, s, &mut churn).expect("runs");
        compare(&reference, &run).unwrap_or_else(|d| panic!("{v:?}: {d}"));
    }
    // The churn really changed the world: the last state differs from the start's.
    assert_ne!(reference.first().unwrap().state, reference.last().unwrap().state);
}

#[test]
fn a_divergence_is_found_at_its_tick_and_named_to_the_field() {
    let p = protos();
    let s = Schedule::default();
    let reference = record(&p, &start(), &Log::golden(), 120, Variant::Plain, s).expect("runs");
    // Break one run: move player 0 by a tiny amount after tick 77.
    let broken = record_with(&p, &start(), &Log::golden(), 120, Variant::Plain, s, &mut |t, c| {
        if t == 77 {
            let w = c.world_mut().expect("a world");
            let p0 = w.players.get_mut(schema::PlayerIndex(0)).expect("player 0");
            p0.x += 1.0 / 1024.0;
        }
    })
    .expect("runs");
    let d = compare(&reference, &broken).expect_err("a divergence");
    assert_eq!(d.tick, 77);
    assert!(d.what.contains("PLAYERS") && d.what.contains("players[0].x"), "{}", d.what);
    // The same divergence after the every-tick window is still found by the digests (d_t covers positions).
    let late = Schedule { every_tick_until: 10, then_every: 600 };
    let reference = record(&p, &start(), &Log::golden(), 120, Variant::Plain, late).expect("runs");
    let broken = record_with(&p, &start(), &Log::golden(), 120, Variant::Plain, late, &mut |t, c| {
        if t == 77 {
            c.world_mut().expect("a world").players.get_mut(schema::PlayerIndex(0)).expect("p0").x += 0.5;
        }
    })
    .expect("runs");
    let d = compare(&reference, &broken).expect_err("a divergence");
    assert_eq!(d.tick, 78, "the next tick's d_t sees the moved character: {}", d.what);
}

#[test]
fn a_changed_global_is_named_at_its_tick() {
    let p = protos();
    let s = Schedule::default();
    let reference = record(&p, &start(), &Log::golden(), 60, Variant::Plain, s).expect("runs");
    let reloaded = record(&p, &start(), &Log::golden(), 60, Variant::Reload { at: 30 }, s).expect("runs");
    compare(&reference, &reloaded).expect("a clean reload is equivalent");
    let lossy = record_with(&p, &start(), &Log::golden(), 60, Variant::Plain, s, &mut |t, c| {
        if t == 30 {
            c.world_mut().expect("a world").globals.next_serial = schema::Serial(100);
        }
    })
    .expect("runs");
    let d = compare(&reference, &lossy).expect_err("a divergence");
    assert_eq!(d.tick, 30);
    assert!(d.what.contains("GLOBALS") && d.what.contains("next_serial"), "{}", d.what);
}

/// §10.4 #3 after a late load (the M0 exit audit, C9): a reload restarts the dense window, in the reference and the
/// variant alike, so a divergence right after a late reload is found at its tick by the canonical states; and a
/// reference recorded without the reload's window cannot be compared with it silently.
#[test]
fn a_late_reload_restarts_the_dense_window() {
    let p = protos();
    // a dense window of 10 ticks, so that a reload 60 ticks in is "late"
    let s = Schedule { every_tick_until: 10, then_every: 600 };
    let t0 = record(&p, &start(), &Log::golden(), 1, Variant::Plain, s).expect("runs")[0].tick;
    let reload = Variant::Reload { at: t0 + 60 };
    let windows = windows_of(&[reload]);
    assert_eq!(windows, [t0 + 60]);
    let none = &mut |_: u32, _: &mut sim::SimContext| {};
    let reference =
        record_windows(&p, &start(), &Log::golden(), 120, Variant::Plain, s, &windows, none).expect("runs");
    let reloaded =
        record_windows(&p, &start(), &Log::golden(), 120, reload, s, &windows, none).expect("runs");
    compare(&reference, &reloaded).expect("a clean late reload is equivalent");
    for r in &reference {
        let rel = r.tick - t0;
        let dense = rel <= 10 || (60..=70).contains(&rel) || rel == 120;
        assert_eq!(r.state.is_some(), dense, "tick {rel}");
    }
    // a lost global right after the late reload: found at its own tick, by the states
    let broken = record_windows(&p, &start(), &Log::golden(), 120, reload, s, &windows, &mut |t, c| {
        if t == t0 + 64 {
            c.world_mut().expect("a world").globals.next_serial = schema::Serial(100);
        }
    })
    .expect("runs");
    let d = compare(&reference, &broken).expect_err("a divergence");
    assert_eq!(d.tick, t0 + 64);
    assert!(d.what.contains("GLOBALS") && d.what.contains("next_serial"), "{}", d.what);
    // a reference without the window: the comparison refuses rather than skip the reload's ticks
    let sparse = record(&p, &start(), &Log::golden(), 120, Variant::Plain, s).expect("runs");
    let d = compare(&sparse, &reloaded).expect_err("the windows differ");
    assert_eq!(d.tick, t0 + 60);
    assert!(d.what.contains("only one run kept its state"), "{}", d.what);
}

#[test]
fn per_phase_digests_name_the_phase() {
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    let before = c.state_hashes().expect("hash").full;
    assert!(c.last_phase_digests().is_none());
    c.set_phase_digests(true);
    c.tick(&[]).expect("a tick");
    let p = *c.last_phase_digests().expect("recorded");
    // Phase 1 moves the tick counter, so every phase after it differs from the start and nothing later in an
    // idle M0 tick changes the state: phases 1 … 16 all hash the same state, the state after the tick.
    assert_ne!(p[0], before);
    assert!(p.iter().all(|&x| x == p[0]), "{p:x?}");
    assert_eq!(p[15], c.state_hashes().expect("hash").full);
}

/// D6: a NaN written into the state is caught after the phase that wrote it (builds with simcheck).
#[test]
#[cfg(feature = "simcheck")]
fn a_nan_in_state_fails_the_tick_in_simcheck_builds() {
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    c.world_mut().expect("a world").players.get_mut(schema::PlayerIndex(0)).expect("p0").y = f64::NAN;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.tick(&[])));
    let msg = r.expect_err("a panic (a trap in the module)");
    let msg = msg.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("NaN in player.position 0 after phase 1"), "{msg}");
}
