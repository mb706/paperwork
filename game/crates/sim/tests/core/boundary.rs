//! The boundary's behaviours that the golden packets do not reach (10 §15.4–§15.6, §10.6): the UI section's
//! cap and its deferral, the slow cadence, `COALESCED`, `PROFILE`'s per-phase times and the dev panic.

use crate::common::*;
use schema::codec::{Fixed, MsgList, Packed, Reader, Writer};
use schema::packet::{PacketFlags, PacketHeader, PacketSection, SectionEntry, ViewRequest};
use schema::projections::{ProjectionKind, SubRequest, UiRecord, UiStatus};
use schema::{SimFlags, SubFlags, SubId};
use sim::SimContext;

/// A decoded packet: its header and its sections' (type, count, bytes).
struct Pkt {
    header: PacketHeader,
    sections: Vec<(PacketSection, u32, Vec<u8>)>,
}

fn decode(bytes: &[u8]) -> Pkt {
    let mut r = Reader::new(bytes);
    let header = PacketHeader::read(&mut r, "PacketHeader").expect("a header");
    let sections = (0..header.section_count)
        .map(|_| {
            let e = SectionEntry::read(&mut r, "SectionEntry").expect("an entry");
            (e.r#type, e.count, bytes[e.offset as usize..(e.offset + e.byte_length) as usize].to_vec())
        })
        .collect();
    Pkt { header, sections }
}

/// The UI records of a packet: (sub_id, status, body).
fn ui(p: &Pkt) -> Vec<(u32, UiStatus, Vec<u8>)> {
    let Some((_, n, bytes)) = p.sections.iter().find(|s| s.0 == PacketSection::Ui) else {
        return Vec::new();
    };
    let mut r = Reader::new(bytes);
    (0..*n)
        .map(|_| {
            let u = UiRecord::decode(&mut r).expect("a record");
            (u.sub_id.0, u.status, u.body.to_vec())
        })
        .collect()
}

/// The golden view without its hovered serial (no hover projection).
fn plain_view() -> Vec<u8> {
    let bytes = golden("view.bin");
    let mut v = ViewRequest::read(&mut Reader::new(&bytes), "ViewRequest").expect("the golden view");
    v.hovered_serial = schema::Serial(0);
    let mut out = Vec::new();
    v.write(&mut Writer::new(&mut out), "ViewRequest").expect("encodes");
    out
}

fn subscribe(c: &mut SimContext, subs: &[(u32, ProjectionKind, u32, u32)]) {
    let reqs: Vec<SubRequest<'_>> = subs
        .iter()
        .map(|&(id, kind, target, p0)| SubRequest {
            sub_id: SubId(id),
            kind,
            flags: SubFlags::EMPTY,
            target,
            p0,
            p1: 0,
            p2: 0,
            p3: 0,
            tail: None,
        })
        .collect();
    let mut input = Vec::new();
    schema::SubscribeInput { subs: MsgList::from_slice(&reqs) }
        .encode(&mut Writer::new(&mut input))
        .expect("encodes");
    c.subscribe(&input).expect("subscribes");
}

fn loaded() -> SimContext {
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    c
}

/// §15.5: the UI section holds at most its cap; the subscriptions due beyond it wait for the next extraction,
/// starting with the one that did not fit, and lose nothing.
#[test]
fn a_full_ui_section_defers_the_rest_without_loss() {
    let mut c = loaded();
    let view = plain_view();
    assert!(ui(&decode(&c.extract(&view).expect("the FULL packet"))).is_empty());
    // CHARACTER (682 bytes and its 16-byte header at tick 0) fits a 760-byte section; an INVENTORY after it
    // (266 + 16) does not.
    subscribe(
        &mut c,
        &[
            (1, ProjectionKind::Character, 0, 0),
            (2, ProjectionKind::Inventory, 2, 2),
            (3, ProjectionKind::Inventory, 3, 2),
        ],
    );
    c.pres.extract.set_ui_cap(760);
    let first = ui(&decode(&c.extract(&view).expect("extracts")));
    assert_eq!(first.iter().map(|r| r.0).collect::<Vec<_>>(), [1], "only the CHARACTER record fits");
    let second = ui(&decode(&c.extract(&view).expect("extracts")));
    assert_eq!(
        second.iter().map(|r| r.0).collect::<Vec<_>>(),
        [2, 3],
        "the deferred ones, from where it stopped"
    );
    assert!(second.iter().all(|r| r.1 == UiStatus::Ok));
    // Nothing changed since: nothing is resent.
    assert!(ui(&decode(&c.extract(&view).expect("extracts"))).is_empty());
    // Without a cap, a fresh module sends all three at once, with the same bodies.
    let mut d = loaded();
    d.extract(&view).expect("the FULL packet");
    subscribe(
        &mut d,
        &[
            (1, ProjectionKind::Character, 0, 0),
            (2, ProjectionKind::Inventory, 2, 2),
            (3, ProjectionKind::Inventory, 3, 2),
        ],
    );
    let all = ui(&decode(&d.extract(&view).expect("extracts")));
    assert_eq!(all, [first, second].concat());
}

/// §15.5: a slow projection (HUD) is evaluated on subscribing, then at the first extraction at least 60 ticks
/// after its last evaluation, so a skipped extraction delays it and never loses it.
#[test]
fn slow_projections_wait_sixty_ticks_and_skipped_extractions_lose_nothing() {
    let log = GoldenLog::load();
    let mut c = loaded();
    let view = plain_view();
    c.extract(&view).expect("the FULL packet");
    subscribe(&mut c, &[(7, ProjectionKind::Hud, 0, 0)]);
    let hud = |c: &mut SimContext| {
        ui(&decode(&c.extract(&view).expect("extracts"))).iter().filter(|r| r.0 == 7).count()
    };
    assert_eq!(hud(&mut c), 1, "on subscribing (tick 0)");
    let mut seen = Vec::new();
    for t in 1..=130 {
        log.tick(&mut c, t).expect("a tick");
        // Every tick extracts up to 100; then nothing until 130.
        if t <= 100 && hud(&mut c) == 1 {
            seen.push(t);
        }
    }
    assert_eq!(seen, [60], "the HUD's tick changes every tick, but it is sent at its cadence only");
    assert_eq!(hud(&mut c), 1, "at 130, the first extraction 60 ticks after 60");
}

/// §15.4: `COALESCED` when more than one tick ran since the previous packet.
#[test]
fn coalesced_marks_a_packet_after_skipped_ticks() {
    let log = GoldenLog::load();
    let mut c = loaded();
    let view = plain_view();
    let flags = |c: &mut SimContext| decode(&c.extract(&view).expect("extracts")).header.flags;
    assert!(flags(&mut c).contains(PacketFlags::FULL));
    log.tick(&mut c, 1).expect("tick 1");
    assert!(!flags(&mut c).contains(PacketFlags::COALESCED));
    log.tick(&mut c, 2).expect("tick 2");
    log.tick(&mut c, 3).expect("tick 3");
    let f = flags(&mut c);
    assert!(f.contains(PacketFlags::COALESCED) && !f.contains(PacketFlags::FULL), "{f:?}");
    assert!(!flags(&mut c).contains(PacketFlags::COALESCED), "no tick ran since");
}

fn fake_clock() -> f64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static T: AtomicU64 = AtomicU64::new(0);
    // Every reading is 0.25 ms after the previous one.
    T.fetch_add(1, Ordering::Relaxed) as f64 * 0.25
}

/// §10.6, §15.8: with `PROFILE` and a host clock, each tick records the µs of its 16 phases, which `DEBUG`
/// reports; without `PROFILE` the clock is never read and `phase_us` is empty.
#[test]
fn profile_times_the_phases_through_the_host_clock() {
    let mut c = loaded();
    c.set_clock(fake_clock);
    c.tick(&[]).expect("a tick");
    assert_eq!(c.phase_us(), None, "no PROFILE, no times");
    c.set_flags(SimFlags::PROFILE.bits()).expect("dev flags");
    c.tick(&[]).expect("a tick");
    let us = *c.phase_us().expect("times");
    assert!(us.iter().all(|&x| x == 250.0), "one clock step per phase: {us:?}");
    let view = plain_view();
    c.extract(&view).expect("the FULL packet");
    subscribe(&mut c, &[(1, ProjectionKind::Debug, 0, 0)]);
    let rec = ui(&decode(&c.extract(&view).expect("extracts")));
    let d = schema::projections::Debug::decode_exact(&rec[0].2).expect("DEBUG");
    assert_eq!(d.phase_us.iter().collect::<Vec<f32>>(), us.to_vec());
    // The World never sees the clock: the same ticks without it give the same state.
    let mut plain = loaded();
    plain.tick(&[]).expect("a tick");
    plain.tick(&[]).expect("a tick");
    assert_eq!(plain.state_hashes().expect("hash").full, c.state_hashes().expect("hash").full);
}

/// C3's decision 6: in builds with simcheck (tests, the dev module), `debug_dump(0xFFFFFFFF)` is the dev panic
/// the shell's `__game.panic()` sends; any other dump id does nothing to the World.
#[test]
#[should_panic(expected = "the dev panic")]
fn the_dev_panic_traps_in_simcheck_builds() {
    use schema::{Action, DebugDumpAction};
    let mut c = loaded();
    let mut seq = sim::testkit::TestSequencer::new(&c);
    seq.push_system(1, &Action::DebugDump(DebugDumpAction { dump_id: 7 })).expect("in order");
    seq.push_system(2, &Action::DebugDump(DebugDumpAction { dump_id: sim::rules::DEV_PANIC_DUMP_ID }))
        .expect("in order");
    let before = c.state_hashes().expect("hash").full;
    c.tick(&seq.closure(1)).expect("an ordinary dump");
    assert_ne!(c.state_hashes().expect("hash").full, before, "the tick ran");
    let _ = c.tick(&seq.closure(2));
}

/// The chunk keys of a packet's `CHUNK_TILES` records.
fn tile_keys(p: &Pkt) -> Vec<u32> {
    p.sections
        .iter()
        .find(|s| s.0 == PacketSection::ChunkTiles)
        .map(|(_, n, b)| {
            (0..*n as usize)
                .map(|i| u32::from_le_bytes(b[i * 1036..i * 1036 + 4].try_into().expect("4")))
                .collect()
        })
        .unwrap_or_default()
}

/// §4.4 (B1-r1 16): extraction cannot write the World. Pristine chunks no rule has read are generated into the
/// extractor's own cache, at most 8 a packet, nearest the view's centre first; the others follow in later packets
/// (unsent chunks are not held), and the World's regeneration cache is untouched.
#[test]
fn extraction_generates_at_most_eight_pristine_chunks_a_packet_nearest_first() {
    let state = sim::testkit::bench::m0_load_state(&protos(), 400).expect("a state of pristine chunks");
    let mut c = ctx();
    c.load(&state_input(&state)).expect("loads");
    let view = sim::testkit::bench::view_around(0, 0, 0);
    c.extract(&view).expect("the FULL packet");
    let held = schema::packet::held_chunks(&ViewRequest::read(&mut Reader::new(&view), "v").expect("v"))
        .expect("a held set");
    let held_n = ((held.cx1 - held.cx0 + 1) * (held.cy1 - held.cy0 + 1)) as usize;
    let world_generated = c.world().expect("w").regen.generated();
    let mut sent: Vec<u32> = Vec::new();
    let mut packets = 0;
    let mut farthest = 0;
    while sent.len() < held_n {
        let p = decode(&c.extract(&view).expect("a packet"));
        let keys = tile_keys(&p);
        assert!(keys.windows(2).all(|k| k[0] < k[1]), "ascending keys");
        // The pristine ones: at most 8, and none nearer the centre than one sent before (a modified chunk is at
        // hand and goes at once).
        let w = c.world().expect("w");
        let pristine: Vec<u32> = keys
            .iter()
            .copied()
            .filter(|&k| !w.chunks.is_modified(schema::SurfaceIndex(0), schema::ChunkKey(k)))
            .collect();
        assert!(pristine.len() <= 8, "packet {packets}: {} pristine chunks", pristine.len());
        let d = |k: u32| {
            let (cx, cy) = schema::chunk_xy(schema::ChunkKey(k));
            (cx * 64 + 32).pow(2) + (cy * 64 + 32).pow(2)
        };
        if let Some(near) = pristine.iter().map(|&k| d(k)).min() {
            assert!(near >= farthest, "packet {packets} sends a chunk nearer than an earlier packet's");
        }
        farthest = farthest.max(pristine.iter().map(|&k| d(k)).max().unwrap_or(0));
        sent.extend(keys);
        packets += 1;
        assert!(packets <= held_n.div_ceil(8) + 1, "{packets} packets for {held_n} chunks");
    }
    assert_eq!(sent.len(), held_n, "every held chunk once");
    assert_eq!(
        c.world().expect("w").regen.generated(),
        world_generated,
        "extraction does not write the World"
    );
    assert_eq!(c.pres.extract.generated(), held_n as u64);
    // A view rectangle over the whole key range costs what the world holds, not 2³² chunks.
    let mut big = ViewRequest::read(&mut Reader::new(&view), "v").expect("v");
    (big.x0, big.y0, big.x1, big.y1) = (-(1 << 30), -(1 << 30), 1 << 30, 1 << 30);
    let mut bytes = Vec::new();
    big.write(&mut Writer::new(&mut bytes), "v").expect("encodes");
    let before = c.pres.extract.generated();
    let t = std::time::Instant::now();
    c.extract(&bytes).expect("a packet");
    assert!(t.elapsed().as_secs_f64() < 1.0, "a huge view takes {:?}", t.elapsed());
    assert_eq!(c.pres.extract.generated() - before, 8, "eight more pristine chunks, the nearest");
}

/// A query's parameters are kept only up to what an M0 kind takes: a megabyte of them is not copied, and the
/// query finishes with reason 2 (bad parameters) like any other malformed one.
#[test]
fn long_query_parameters_are_bad_parameters() {
    let mut c = loaded();
    let mut input = Vec::new();
    let params = vec![7u8; 1 << 20];
    schema::QueryInput {
        id: schema::QueryId(3),
        header: schema::projections::QueryHeader { kind: schema::projections::QueryKind::Inspect, flags: 0 },
        params: &params,
    }
    .encode(&mut Writer::new(&mut input))
    .expect("encodes");
    c.query(&input).expect("starts");
    let out = c.query_step(u32::MAX).expect("finishes");
    let v = schema::QueryStepOutput::decode_exact(&out).expect("decodes");
    let mut got = Vec::new();
    v.results.for_each(|r| got.push((r.id.0, r.ok, r.body.to_vec())));
    assert_eq!(got, [(3, false, 2u16.to_le_bytes().to_vec())]);
}
