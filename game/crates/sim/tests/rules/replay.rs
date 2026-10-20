//! D18 (e): every recorded session in `test/logs/` (the scenarios' closure logs, their start states and final
//! hashes) replays to its recorded per-tick digests and its final state hash and lineage (10 §10.4 #7).

use crate::helpers::*;
use schema::container::ClosureLog;

#[test]
fn every_recorded_session_replays_to_its_digests_and_hash() {
    if std::env::var("UPDATE_SCENARIO_LOGS").is_ok_and(|v| v == "1") {
        return; // the scenarios are rewriting the sessions in parallel; the next plain run replays them
    }
    let dir = logs_dir();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("test/logs")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".pwlog").map(str::to_owned))
        .collect();
    names.sort();
    assert!(names.len() >= 10, "the M0 scenarios' sessions: {names:?}");
    for name in names {
        let log = std::fs::read(dir.join(format!("{name}.pwlog"))).expect("log");
        let start = std::fs::read(dir.join(format!("{name}.start"))).expect("start state");
        let summary = std::fs::read_to_string(dir.join(format!("{name}.txt"))).expect("summary");
        let l = ClosureLog::parse(&log).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut c =
            sim::testkit::start_from(&protos(), &start, schema::SimFlags::EMPTY).expect("the start loads");
        assert_eq!(
            c.state_hashes().expect("hash").full,
            l.header.start_state_hash,
            "{name}: the start state"
        );
        let (from, to) = (l.header.start_tick.0, l.header.end_tick.0);
        assert_eq!(l.digests.len() as u32, to - from, "{name}: a digest per tick");
        let mut records = l.records.iter().peekable();
        for t in from + 1..=to {
            let closure = match records.peek() {
                Some(r) if r.tick.0 == t => records.next().map_or(&[][..], |r| r.closure),
                _ => &[],
            };
            c.tick(closure).unwrap_or_else(|e| panic!("{name}: tick {t}: {e}"));
            assert_eq!(c.last_digest(), l.digests[(t - from - 1) as usize], "{name}: d_{t}");
        }
        let h = c.state_hashes().expect("hash");
        let want = format!("{name} ticks {from}..{to} state {:016x} r {:016x}\n", h.full, c.lineage());
        assert_eq!(summary, want, "{name}: the final state hash and lineage");
    }
}
