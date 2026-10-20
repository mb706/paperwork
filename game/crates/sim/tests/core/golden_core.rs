//! The parts of the frozen M0 golden set (test/golden/m0/, 10 §15.10) that need no systems (C2a): loading the
//! start save and every frozen state, saving them back byte for byte, the full state hash and each section's,
//! r₀ and the rolling digest's arithmetic, the slice hashes of the frozen states (every shard at tick 600),
//! the digest preimages, the save and closure refusals, and the ABI traces whose calls need no rule.
//! C2b adds the ticks (the closure log's states and digests), C2c the packets, projections and queries.

use crate::common::*;
use schema::container::ClosureLog;
use schema::{SaveSection, SimStatus};
use sim::digest::{Slicer, lineage0, member_hash, members, roll, slice_reference};
use sim::hash::xxh64;
use sim::save::{read_container, state_hash};
use std::collections::BTreeMap;

fn status_of(r: &sim::SimResult<impl Sized>) -> SimStatus {
    match r {
        Ok(_) => SimStatus::Ok,
        Err(e) => e.status,
    }
}

#[test]
fn the_start_save_loads_and_saves_byte_for_byte() {
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save loads");
    assert_eq!(
        c.checkpoint().expect("saves"),
        state_file(0),
        "sim_save at tick 0 = states/tick-0000.sections"
    );
    let want = &state_hashes()[0];
    let h = c.state_hashes().expect("hashes");
    assert_eq!((h.full, c.lineage()), (want.full, want.r));
    assert_eq!(h.sections, want.sections);
    let report = c.load_report_record().expect("a report after a load");
    assert!(!report.new_lineage && report.removed.is_empty());
}

#[test]
fn every_frozen_state_round_trips_with_its_hashes() {
    let hashes = state_hashes();
    assert_eq!(hashes.len(), STATE_TICKS.len());
    for (t, want) in STATE_TICKS.iter().zip(&hashes) {
        assert_eq!(*t, want.tick);
        let bytes = state_file(*t);
        let mut c = ctx();
        c.load(&state_input(&bytes)).unwrap_or_else(|e| panic!("tick {t}: {e}"));
        assert_eq!(c.world().expect("a world").current_tick(), *t);
        assert_eq!(c.lineage(), want.r, "tick {t}: the lineage continues");
        let h = c.state_hashes().expect("hashes");
        assert_eq!(h.full, want.full, "tick {t}: full state hash");
        assert_eq!(h.sections, want.sections, "tick {t}: section hashes");
        let saved = c.checkpoint().expect("saves");
        assert!(
            saved == bytes,
            "tick {t}: save ≠ the frozen state ({})",
            sim::testkit::diff_states(&saved, &bytes).unwrap_or_default()
        );
    }
}

#[test]
fn lineage_and_rolling_digest_arithmetic() {
    let r0 = u64_hex("5f10b3b0134651d2");
    assert_eq!(lineage0(1945), r0, "r₀ = XXH64(u32 1945 ‖ u32 0)");
    let mut r = r0;
    let d = digests();
    assert_eq!(d.len(), 3600);
    for &(t, dt, st, rt) in &d {
        r = roll(r, dt, st);
        assert_eq!(r, rt, "r_{t} = XXH64(r ‖ d ‖ slice)");
    }
}

#[test]
fn slices_of_tick_600_every_shard() {
    let mut c = ctx();
    c.load(&state_input(&state_file(600))).expect("loads");
    let w = c.world().expect("a world");
    let all = members(w);
    let mut slicer = Slicer::new();
    let text = golden_text("slices/tick-0600.txt");
    let mut n = 0;
    for line in text.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
        let (s, h) = line.split_once(' ').expect("shard hash");
        let shard: u32 = s.parse().expect("shard");
        let want = u64_hex(h.trim());
        assert_eq!(slice_reference(&all, shard), want, "shard {shard} (reference)");
        assert_eq!(slicer.slice_hash(w, shard).expect("encodes"), want, "shard {shard} (slicer)");
        n += 1;
    }
    assert_eq!(n, 3600);
}

#[test]
fn members_of_tick_600_match_the_members_file() {
    let mut c = ctx();
    c.load(&state_input(&state_file(600))).expect("loads");
    let mut mine: Vec<(u32, u64, u32, usize, u64)> = members(c.world().expect("a world"))
        .iter()
        .map(|m| (m.section, m.key, m.shard, m.bytes.len(), member_hash(m)))
        .collect();
    mine.sort_unstable();
    let mut want: Vec<(u32, u64, u32, usize, u64)> = golden_text("slices/tick-0600-members.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (
                f[0].parse().unwrap(),
                f[1].parse().unwrap(),
                f[2].parse().unwrap(),
                f[3].parse().unwrap(),
                u64_hex(f[4]),
            )
        })
        .collect();
    want.sort_unstable();
    assert_eq!(mine, want);
}

/// GATE-r2 finding 1 (golden version 6): a state whose rows were reused out of serial order (row 0 holds serial
/// 3,603, row 1 serial 3, row 3 is free, all in shard 3); its slices sort members by key, and its members file
/// lists them.
#[test]
fn slices_of_the_collision_state() {
    let mut c = ctx();
    c.load(&state_input(&golden("slices/collisions.sections"))).expect("loads");
    let w = c.world().expect("a world");
    let all = members(w);
    let mut slicer = Slicer::new();
    for line in
        golden_text("slices/collisions.txt").lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty())
    {
        let (s, h) = line.split_once(' ').expect("shard hash");
        let shard: u32 = s.parse().expect("shard");
        assert_eq!(slicer.slice_hash(w, shard).expect("encodes"), u64_hex(h.trim()), "shard {shard}");
        assert_eq!(slice_reference(&all, shard), u64_hex(h.trim()), "shard {shard} (reference)");
    }
    assert_eq!(c.checkpoint().expect("saves"), golden("slices/collisions.sections"));
    let mut mine: Vec<(u32, u64, u32, usize, u64)> =
        all.iter().map(|m| (m.section, m.key, m.shard, m.bytes.len(), member_hash(m))).collect();
    mine.sort_unstable();
    let mut want: Vec<(u32, u64, u32, usize, u64)> = golden_text("slices/collisions-members.txt")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (
                f[0].parse().unwrap(),
                f[1].parse().unwrap(),
                f[2].parse().unwrap(),
                f[3].parse().unwrap(),
                u64_hex(f[4]),
            )
        })
        .collect();
    want.sort_unstable();
    assert_eq!(mine, want);
}

#[test]
fn frozen_states_give_the_slices_of_their_ticks() {
    let d: BTreeMap<u32, u64> = digests().iter().map(|x| (x.0, x.2)).collect();
    for t in [1u32, 2, 300, 600, 3600] {
        let mut c = ctx();
        c.load(&state_input(&state_file(t))).expect("loads");
        let s = Slicer::new().slice_hash(c.world().expect("a world"), t % 3600).expect("encodes");
        assert_eq!(s, d[&t], "slice_{t}");
    }
}

#[test]
fn the_digest_preimages_hash_to_the_digests_and_carry_the_closure_hashes() {
    let log_bytes = golden("closure-log.pwlog");
    let log = ClosureLog::parse(&log_bytes).expect("the golden log parses");
    let closures: BTreeMap<u32, &[u8]> = log.records.iter().map(|r| (r.tick.0, r.closure)).collect();
    let d: BTreeMap<u32, u64> = digests().iter().map(|x| (x.0, x.1)).collect();
    let mut n = 0;
    for line in
        golden_text("digest-preimages.txt").lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty())
    {
        let (t, h) = line.split_once(' ').expect("tick hex");
        let t: u32 = t.parse().expect("tick");
        let b = unhex(h.trim());
        assert_eq!(xxh64(&b), d[&t], "d_{t} = XXH64(preimage)");
        assert_eq!(u32::from_le_bytes(b[0..4].try_into().unwrap()), t);
        let closure = closures.get(&t).copied().unwrap_or(&[]);
        assert_eq!(
            u64::from_le_bytes(b[4..12].try_into().unwrap()),
            xxh64(closure),
            "tick {t}: closure hash"
        );
        assert_eq!(&b[b.len() - 10..], &[0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0], "tick {t}: no research in M0");
        n += 1;
    }
    assert!(n >= 9);
    // The log's own digest region is the same d_t.
    assert_eq!(log.digests.len(), 3600);
    for (i, &dt) in log.digests.iter().enumerate() {
        assert_eq!(dt, d[&(log.header.digest_first_tick.0 + i as u32)]);
    }
}

#[test]
fn every_member_partitions_the_canonical_state() {
    // §4.8: the 3,600 shards together are exactly the canonical state. Rebuild each section from its members.
    for t in STATE_TICKS {
        let mut c = ctx();
        c.load(&state_input(&state_file(t))).expect("loads");
        let w = c.world().expect("a world");
        let all = members(w);
        for s in sim::save::SAVED_SECTIONS {
            let mut want = Vec::new();
            sim::save::encode_section(w, s, &mut want).expect("encodes");
            let mut ms: Vec<&sim::digest::Member> = all.iter().filter(|m| m.section == s.value()).collect();
            ms.sort_by_key(|m| m.key);
            let covered: usize = ms.iter().map(|m| m.bytes.len()).sum();
            match s {
                SaveSection::EntityTable | SaveSection::PoolContainer => {
                    // The header (rows), then each row's index (4 bytes, not state) and columns: the table's
                    // column bytes are its size less the directory and the alignment padding.
                    let rows = u32::from_le_bytes(want[0..4].try_into().unwrap()) as usize;
                    assert_eq!(ms.len(), rows + 1, "{s:?} at tick {t}");
                    let col_bytes: usize = ms[1..].iter().map(|m| m.bytes.len() - 4).sum();
                    assert!(covered - 4 * rows <= want.len() && col_bytes <= want.len(), "{s:?} at tick {t}");
                }
                SaveSection::SlotHeap => {
                    // Every slot of every block, every bar and filter once (plus the headers and counts).
                    let rec = w.heap.to_record();
                    let slots: usize = rec.arenas.iter().map(|a| a.slots.len()).sum();
                    let blocks: usize = rec.arenas.iter().map(|a| a.blocks as usize).sum();
                    let expect = rec.arenas.len() * 7
                        + slots * 6
                        + blocks * 8
                        + rec.bars.len() * 8
                        + rec.filters.len() * 8;
                    assert_eq!(covered, expect, "SLOT_HEAP at tick {t}");
                }
                _ => {
                    // Records and pieces: the members, in key order, are the section's bytes exactly.
                    let cat: Vec<u8> = ms.iter().flat_map(|m| m.bytes.iter().copied()).collect();
                    assert_eq!(cat, want, "{s:?} at tick {t}");
                }
            }
        }
    }
}

#[test]
fn refused_saves() {
    let cases = [
        ("saves/other-worldgen-version.save", SimStatus::ErrWorldgen),
        ("saves/other-worldgen-data.save", SimStatus::ErrWorldgen),
        ("saves/other-worldgen-version-baked.save", SimStatus::Ok),
        ("saves/column-type-mismatch.save", SimStatus::ErrLoadSchema),
        ("saves/newer-section-version.save", SimStatus::ErrLoadFormat),
    ];
    for (f, want) in cases {
        let mut c = ctx();
        c.load(&container_input(&golden("start.save"))).expect("start.save");
        let before = c.state_hashes().expect("hashes").full;
        let got = c.load(&container_input(&golden(&format!("negative/{f}"))));
        assert_eq!(status_of(&got), want, "{f}: {got:?}");
        if want != SimStatus::Ok {
            assert_eq!(c.state_hashes().expect("hashes").full, before, "{f}: a refused load changes nothing");
        }
    }
    for f in ["negative/saves/truncated.save", "negative/saves/trailing.save"] {
        assert!(read_container(&golden(f)).is_err(), "{f}: the container reader refuses it");
    }
}

#[test]
fn a_baked_save_from_other_rules_continues_under_this_builds() {
    let mut c = ctx();
    c.load(&container_input(&golden("negative/saves/other-worldgen-version-baked.save"))).expect("loads");
    let w = c.world().expect("a world");
    assert_eq!(w.globals.worldgen_version, sim::save::WORLDGEN_VERSION);
    assert_eq!(Some(w.globals.worldgen_data_hash.bytes), c.worldgen().map(|g| g.data_hash));
    let r = c.load_report_record().expect("a report");
    assert!(r.new_lineage);
    assert_eq!(r.r, sim::digest::lineage_of(state_hash(w).expect("hash").full, w.current_tick()));
}

#[test]
fn refused_closures_change_nothing() {
    let index = parse_json(&golden_text("negative/index.json"));
    let mut n = 0;
    for case in index.arr() {
        let file = case.get("file").and_then(Json::str).expect("file");
        if !file.starts_with("closures/") {
            continue;
        }
        let want = case.get("expect").and_then(Json::str).expect("expect");
        let mut c = ctx();
        c.load(&container_input(&golden("start.save"))).expect("start.save");
        let before = c.checkpoint().expect("saves");
        let got = c.tick(&golden(&format!("negative/{file}")));
        assert_eq!(status_of(&got).name(), want, "{file}");
        assert_eq!(c.checkpoint().expect("saves"), before, "{file}: a refused closure changes nothing");
        n += 1;
    }
    assert_eq!(n, 19);
}

#[test]
fn refused_abi_inputs() {
    let index = parse_json(&golden_text("negative/index.json"));
    let mut n = 0;
    for case in index.arr() {
        let file = case.get("file").and_then(Json::str).expect("file");
        let call = case.get("call").and_then(Json::str).expect("call");
        let want = case.get("expect").and_then(Json::str).expect("expect");
        if !(file.starts_with("abi/") || file.starts_with("protos/")) {
            continue;
        }
        let input = golden(&format!("negative/{file}"));
        let mut c = ctx();
        c.load(&container_input(&golden("start.save"))).expect("start.save");
        let got = match call.split_whitespace().next().expect("an export") {
            "sim_init" => {
                let input = if file.starts_with("protos/") { init_input(&input) } else { input };
                status_of(&c.init(&input))
            }
            "sim_new_world" => status_of(&c.new_world(&input)),
            "sim_load" => status_of(&c.load(&input)),
            "sim_blob_put" => status_of(&c.blob_put(&input)),
            "sim_supply_chunk" => status_of(&c.supply_chunk(&input)),
            "sim_save" => status_of(&c.save(&input)),
            // Extraction, subscriptions and queries are C2c's; worldgen's exports C2b's.
            _ => continue,
        };
        assert_eq!(got.name(), want, "{file} ({call})");
        n += 1;
    }
    assert_eq!(n, 13);
}

/// `InitInput` around a prototypes.bin (§15.8).
fn init_input(protos: &[u8]) -> Vec<u8> {
    let mut v = (protos.len() as u32).to_le_bytes().to_vec();
    v.extend_from_slice(protos);
    v.extend_from_slice(&[0; 8]);
    v
}

/// Replays an ABI trace (README "ABI traces") against a fresh module, up to `calls` calls: each call's status,
/// envelope payload and state assertion.
fn replay(name: &str, calls: usize) {
    let traces = parse_json(&golden_text("abi/traces.json"));
    let trace = traces
        .get("traces")
        .expect("traces")
        .arr()
        .iter()
        .find(|t| t.get("name").and_then(Json::str) == Some(name));
    let trace = trace.unwrap_or_else(|| panic!("no trace {name}"));
    let mut c = sim::SimContext::new();
    for (i, call) in trace.get("calls").expect("calls").arr().iter().take(calls).enumerate() {
        let export = call.get("call").and_then(Json::str).expect("call");
        let input = call.get("in").and_then(Json::str).map(golden).unwrap_or_default();
        let param = call
            .get("params")
            .map(|p| p.arr().first().and_then(Json::num).unwrap_or(0.0) as u32)
            .unwrap_or(0);
        let before = c.state_hashes().ok().map(|h| h.full);
        let (status, out): (SimStatus, Option<Vec<u8>>) = match export {
            "sim_init" => (status_of(&c.init(&input)), None),
            "sim_new_world" => (status_of(&c.new_world(&input)), None),
            "sim_load" => (status_of(&c.load(&input)), None),
            "sim_tick" => (status_of(&c.tick(&input)), None),
            "sim_set_flags" => (status_of(&c.set_flags(param)), None),
            "sim_blob_put" => (status_of(&c.blob_put(&input)), None),
            "sim_supply_chunk" => (status_of(&c.supply_chunk(&input)), None),
            "sim_pending_chunks" => split(c.pending_chunks()),
            "sim_meta" => split(c.meta()),
            "sim_load_report" => split(c.load_report()),
            "sim_digest" => split(c.digest()),
            "sim_state_hash" => split(c.state_hash()),
            "sim_save" => split(c.save(&input)),
            other => panic!("{name} call {i}: {other} is not a C2a export"),
        };
        let want = call.get("status").and_then(Json::str).expect("status");
        assert_eq!(status.name(), want, "{name} call {i} ({export})");
        if let Some(f) = call.get("out").and_then(Json::str) {
            let got = out.unwrap_or_else(|| panic!("{name} call {i} ({export}): no envelope"));
            assert!(
                got == golden(f),
                "{name} call {i} ({export}): {} ≠ {f} ({})",
                hex(&got),
                hex(&golden(f))
            );
        }
        let after = c.state_hashes().ok().map(|h| h.full);
        match call.get("state").and_then(Json::str) {
            Some("unchanged") => assert_eq!(before, after, "{name} call {i} ({export}) changed the state"),
            Some("changed") => {
                assert_ne!(before, after, "{name} call {i} ({export}) left the state as it was")
            }
            _ => {}
        }
    }
}

fn split(r: sim::SimResult<Vec<u8>>) -> (SimStatus, Option<Vec<u8>>) {
    match r {
        Ok(v) => (SimStatus::Ok, Some(v)),
        Err(e) => (e.status, None),
    }
}

#[test]
fn trace_boot_and_order() {
    replay("boot-and-order", usize::MAX);
}

#[test]
fn trace_remap_load() {
    replay("remap-load", usize::MAX);
}

#[test]
fn trace_watermarks_before_the_join() {
    // Calls 1–9: a never-joined player's seqs are consumed and survive a save and a load (rule 12); the join
    // itself (call 10) needs `player_joined` (C2b).
    replay("watermarks", 9);
}
