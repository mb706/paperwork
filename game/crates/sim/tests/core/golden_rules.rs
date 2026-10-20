//! The frozen M0 golden set's ticks (10 §15.10; C2b's exit): from `start.save`, the closure log's 3,600 ticks
//! give every d_t, slice_t and r_t of `digests.txt` (and the log's own digest region), the preimages of
//! `digest-preimages.txt`, and the states and hashes of `states/` after ticks 1, 2, 300, 600 and 3,600; from
//! `states/tick-0300.sections`, ticks 301–3,600 give the same digests. Every refusal is checked to change
//! nothing (§15.3). WebAssembly runs the same through `simabi` (test/sim-wasm/).

use crate::common::*;
use sim::SimContext;
use std::collections::BTreeMap;

/// Runs ticks `from..=to`, checking each against `digests.txt`, and calls `at(t, c)` after each.
fn run(c: &mut SimContext, log: &GoldenLog, from: u32, to: u32, mut at: impl FnMut(u32, &SimContext)) {
    let want: BTreeMap<u32, (u64, u64, u64)> =
        digests().into_iter().map(|(t, d, s, r)| (t, (d, s, r))).collect();
    for t in from..=to {
        log.tick(c, t).unwrap_or_else(|e| panic!("tick {t}: {e}"));
        let (d, s, r) = want[&t];
        if (c.last_digest(), c.last_slice(), c.lineage()) != (d, s, r) {
            panic!(
                "tick {t}: (d, slice, r) = ({:016x}, {:016x}, {:016x}), golden ({d:016x}, {s:016x}, {r:016x}); preimage {}",
                c.last_digest(),
                c.last_slice(),
                c.lineage(),
                hex(c.last_preimage())
            );
        }
        at(t, c);
    }
}

#[test]
fn the_golden_log_gives_every_digest_state_and_preimage() {
    let log = GoldenLog::load();
    let mut c = ctx();
    c.set_check_refusals(true);
    c.load(&container_input(&golden("start.save"))).expect("start.save loads");
    let pre: BTreeMap<u32, Vec<u8>> = preimages().into_iter().collect();
    let hashes = state_hashes();
    let (first, log_digests) = (log.digests.0, log.digests.1.clone());
    run(&mut c, &log, 1, 3600, |t, c| {
        if let Some(p) = pre.get(&t) {
            assert_eq!(hex(c.last_preimage()), hex(p), "tick {t}: d_t's preimage");
        }
        if t >= first && ((t - first) as usize) < log_digests.len() {
            assert_eq!(
                c.last_digest(),
                log_digests[(t - first) as usize],
                "tick {t}: the log's digest region"
            );
        }
        if STATE_TICKS.contains(&t) {
            let saved = c.checkpoint().expect("saves");
            let want = state_file(t);
            assert!(
                saved == want,
                "tick {t}: sim_save ≠ states/tick-{t:04}.sections ({})",
                sim::testkit::diff_states(&saved, &want).unwrap_or_default()
            );
            let h = c.state_hashes().expect("hashes");
            let line = hashes.iter().find(|l| l.tick == t).expect("a hashes line");
            assert_eq!((h.full, c.lineage()), (line.full, line.r), "tick {t}: state hash and r");
            assert_eq!(h.sections, line.sections, "tick {t}: section hashes");
        }
    });
}

#[test]
fn ticks_301_to_3600_from_the_frozen_state_give_the_same_digests() {
    let log = GoldenLog::load();
    let mut c = ctx();
    c.load(&state_input(&state_file(300))).expect("the tick-300 state loads");
    run(&mut c, &log, 301, 3600, |_, _| {});
    assert_eq!(c.checkpoint().expect("saves"), state_file(3600));
}

/// The events the golden flow extracts (§15.6): none in tick 1, and ticks 2–600's 69 records exactly as the
/// golden packet `tick-0600` carries them in its EVENTS section (the packet itself is C2c's).
#[test]
fn the_events_of_the_golden_log_are_the_golden_packets() {
    let log = GoldenLog::load();
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save loads");
    run(&mut c, &log, 1, 1, |_, _| {});
    let mut one = Vec::new();
    assert_eq!(c.pres.events.drain(&mut one), (0, false), "tick 1 makes no event");
    run(&mut c, &log, 2, 600, |_, _| {});
    let mut out = Vec::new();
    assert_eq!(c.pres.events.drain(&mut out), (69, false));
    let packet = golden("packets/tick-0600.bin");
    assert!(
        packet.windows(out.len()).any(|w| w == out.as_slice()),
        "the 69 records are the packet's EVENTS bytes"
    );
}
