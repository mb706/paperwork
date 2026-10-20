//! Codex's review C2c-r1 (pm/reviews/C2c-r1.md): one test per finding the native module can show. Each fails on
//! the reviewed code (a6bbd2b), as the comments say.

use crate::boundary::{Pkt, decode, loaded, plain_view, subscribe, tile_keys, ui};
use crate::common::*;
use schema::codec::{Fixed, MsgList, Packed, Reader, Writer};
use schema::packet::{PacketSection, ViewRequest};
use schema::projections::{ProjectionKind, QueryKind, SubRequest, UiStatus};
use schema::{SimStatus, SubFlags, SubId};
use sim::SimContext;
use sim::testkit::bench;

fn batch(ids: impl Iterator<Item = u32>, kind: ProjectionKind) -> Vec<u8> {
    let reqs: Vec<SubRequest<'_>> = ids
        .map(|id| SubRequest {
            sub_id: SubId(id),
            kind,
            flags: SubFlags::EMPTY,
            target: 0,
            p0: 0,
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
    input
}

fn unsub(ids: &[u32]) -> Vec<u8> {
    let ids: Vec<SubId> = ids.iter().map(|&i| SubId(i)).collect();
    let mut input = Vec::new();
    schema::UnsubscribeInput { ids: schema::codec::List::from_slice(&ids) }
        .encode(&mut Writer::new(&mut input))
        .expect("encodes");
    input
}

/// Finding 1: refusals waiting for their record are bounded, and so is a batch, before anything is copied; the
/// record counts of ended subscriptions are reclaimed. The reviewed code accepted every batch (2,000 requests,
/// 2,001 records) and kept every retired id's count.
#[test]
fn finding_1_the_subscription_table_is_bounded() {
    let mut c = loaded();
    let view = plain_view();
    c.extract(&view).expect("the FULL packet");
    c.subscribe(&batch(1..31, ProjectionKind::Hud)).expect("30 live");
    c.subscribe(&batch(31..61, ProjectionKind::Hud)).expect("2 live and 28 refusals");
    assert_eq!(c.pres.extract.subscriptions(), 60);
    // 30 more would leave 58 refusals waiting: the batch is refused whole, and nothing changes.
    let e = c.subscribe(&batch(61..91, ProjectionKind::Hud)).expect_err("over the refusals' bound");
    assert_eq!(e.status, SimStatus::ErrLimit);
    assert_eq!(c.pres.extract.subscriptions(), 60);
    // A batch longer than 64 requests is refused before anything is read into the table.
    let e = c.subscribe(&batch(1000..1065, ProjectionKind::Hud)).expect_err("a batch of 65");
    assert_eq!(e.status, SimStatus::ErrLimit);
    // The refusals send one status-2 record each and end; their counts go with them.
    let records = ui(&decode(&c.extract(&view).expect("a packet")));
    assert_eq!(records.iter().filter(|r| r.1 == UiStatus::Invalid).count(), 28);
    assert_eq!(c.pres.extract.subscriptions(), 32);
    assert!(c.pres.extract.versions() <= 33, "{} record counts", c.pres.extract.versions());
    // Churn: 500 windows open and close; the counts stay bounded.
    for k in 0..500u32 {
        c.unsubscribe(&unsub(&[1 + k % 30])).expect("closes");
        c.subscribe(&batch(std::iter::once(10_000 + k), ProjectionKind::Hud)).expect("opens");
        c.extract(&view).expect("a packet");
        c.unsubscribe(&unsub(&[10_000 + k])).expect("closes");
        c.subscribe(&batch(std::iter::once(1 + k % 30), ProjectionKind::Hud)).expect("reopens");
    }
    assert!(c.pres.extract.versions() <= 33, "{} record counts after churn", c.pres.extract.versions());
}

/// Starts a query and steps it `units` at a time; returns its result body and how many steps it took.
fn run_query(c: &mut SimContext, kind: QueryKind, params: &[u8], units: u32) -> (Vec<u8>, usize) {
    let mut input = Vec::new();
    schema::QueryInput {
        id: schema::QueryId(9),
        header: schema::projections::QueryHeader { kind, flags: 0 },
        params,
    }
    .encode(&mut Writer::new(&mut input))
    .expect("encodes");
    c.query(&input).expect("starts");
    for steps in 1..=1_000_000 {
        let out = c.query_step(units).expect("a step");
        let v = schema::QueryStepOutput::decode_exact(&out).expect("decodes");
        let mut got = None;
        v.results.for_each(|r| {
            assert!(r.ok, "the query failed");
            got = Some(r.body.to_vec());
        });
        if let Some(b) = got {
            return (b, steps);
        }
    }
    panic!("the query never finished");
}

fn state_hash_record(c: &SimContext) -> Vec<u8> {
    c.state_hash().expect("sim_state_hash")
}

/// Finding 2: a unit of query work is bounded: the hash query of the 10,000-chest world (a 2.4 MB state) takes
/// thousands of one-unit steps (the reviewed code did all of it in the first), and gives `sim_state_hash`'s
/// record however its work is cut, on every kind of world.
#[test]
fn finding_2_a_hash_query_works_a_bounded_piece_per_unit() {
    let (mut b, _) = bench::m0_chests_10k(&protos()).expect("m0-chests-10k");
    let (body, steps) = run_query(&mut b.ctx, QueryKind::Hash, &[], 1);
    assert_eq!(body, state_hash_record(&b.ctx));
    assert!(steps > 2_000, "{steps} steps of one unit for a 2.4 MB state");
    for units in [7, 300, u32::MAX] {
        assert_eq!(
            run_query(&mut b.ctx, QueryKind::Hash, &[], units).0,
            state_hash_record(&b.ctx),
            "{units} units"
        );
    }
    // Every frozen golden state, a walked world with timers and requests pending, and a pristine-heavy save.
    let mut worlds: Vec<SimContext> = Vec::new();
    for t in STATE_TICKS {
        let mut c = ctx();
        c.load(&state_input(&golden(&format!("states/tick-{t:04}.sections")))).expect("a golden state");
        worlds.push(c);
    }
    let mut walk = bench::m0_walk(&protos()).expect("m0-walk");
    walk.run(400).expect("ticks");
    worlds.push(walk.ctx);
    let mut c = ctx();
    c.load(&state_input(&bench::m0_load_state(&protos(), 600).expect("a state"))).expect("loads");
    worlds.push(c);
    for (k, c) in worlds.iter_mut().enumerate() {
        for units in [1, 13, 1 << 20] {
            assert_eq!(
                run_query(c, QueryKind::Hash, &[], units).0,
                state_hash_record(c),
                "world {k}, {units} units"
            );
        }
    }
}

/// A stat record with nine empty rings.
fn stat(key: schema::StatKey) -> sim::r#gen::Stat {
    let ring = |p: u8| sim::r#gen::StatRing {
        precision: schema::StatPrecision::from_value(p).expect("a precision"),
        points: 0,
        acc_count: 0,
        acc_produced: 0.0,
        acc_consumed: 0.0,
        produced: [0.0; 300],
        consumed: [0.0; 300],
    };
    sim::r#gen::Stat {
        key,
        produced_total: 1.0,
        consumed_total: 0.0,
        handcrafted_total: 0.0,
        rings: (0..9).map(ring).collect(),
    }
}

/// Finding 3: a STATS selection over 256 keys is status 2, reason 3, never a trap (the reviewed code panicked:
/// `Stats.entries: too_long`); a save whose statistics name no prototype is refused at load.
#[test]
fn finding_3_stats_selections_are_bounded_and_saved_keys_checked() {
    let mut c = loaded();
    let w = c.world_mut().expect("w");
    for id in 0..300u32 {
        let key = schema::StatKey((1 << 24) | (id << 3));
        w.stat_mut(key, || stat(key));
    }
    let view = plain_view();
    c.extract(&view).expect("the FULL packet");
    subscribe(&mut c, &[(1, ProjectionKind::Stats, 0, 0)]);
    let records = ui(&decode(&c.extract(&view).expect("a packet")));
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].1, records[0].2.as_slice()), (UiStatus::Invalid, &3u16.to_le_bytes()[..]));
    // Those keys name items the 3-item prototypes lack: a save holding them does not load.
    let state = c.checkpoint().expect("saves");
    let e = ctx().load(&state_input(&state)).expect_err("unknown statistics keys");
    assert!(e.message.contains("statistics key"), "{}", e.message);
}

/// Finding 4: a packet that is built but not delivered changes nothing the main thread holds: building it again
/// gives the same bytes (the reviewed code committed while it built, so a lost packet's deltas and events were
/// gone), and once one is delivered the next carries no repeat.
#[test]
fn finding_4_an_undelivered_packet_loses_nothing() {
    let log = GoldenLog::load();
    let mut c = loaded();
    let view = golden("view.bin");
    c.extract(&view).expect("the FULL packet");
    c.subscribe(&golden("subs.bin")).expect("the golden subscriptions");
    let first = c.extract_stage(&view).expect("staged").to_vec();
    let again = c.extract_stage(&view).expect("staged again").to_vec();
    assert!(first == again, "nothing advanced without delivery");
    assert!(first == golden("packets/tick-0000.bin"));
    c.extract_commit();
    // Ticks 1–5 make events and change records; a packet staged and dropped, then the real one.
    for t in 1..=5 {
        log.tick(&mut c, t).expect("a tick");
    }
    let lost = c.extract_stage(&view).expect("staged").to_vec();
    let delivered = c.extract(&view).expect("delivered");
    assert!(lost == delivered, "the dropped packet's content is in the next");
    let p = decode(&delivered);
    assert!(p.sections.iter().any(|s| s.0 == PacketSection::Events), "the ticks' events");
    let after = decode(&c.extract(&view).expect("a packet"));
    assert!(after.sections.iter().all(|s| s.0 != PacketSection::Events), "delivered events are not resent");
}

/// The keys of every chunk record a packet carries.
fn all_tile_keys(p: &Pkt) -> Vec<u32> {
    tile_keys(p)
}

/// Finding 5: a view over more pristine chunks than the view cache holds (34 × 34 = 1,156 against 512) still
/// receives every chunk, 8 a packet, nearest first. The reviewed code regenerated evicted, already-sent chunks
/// ahead of unsent ones and stalled at 533.
#[test]
fn finding_5_the_view_cache_never_starves_unsent_chunks() {
    let mut c = bench::new_world(&protos(), &bench::dry_world()).expect("a world");
    bench::generate_chunks(
        c.world_mut().expect("w"),
        schema::SurfaceIndex(0),
        (-18..=18).flat_map(|x| (-18..=18).map(move |y| schema::chunk_key(x, y))),
    );
    // Into a fresh module: the World's regeneration cache starts empty.
    let mut c = {
        let s = c.checkpoint().expect("saves");
        let mut d = ctx();
        d.load(&state_input(&s)).expect("loads");
        d
    };
    let mut v = ViewRequest::read(&mut Reader::new(&plain_view()), "v").expect("v");
    (v.x0, v.y0, v.x1, v.y1) = (-512, -512, 512, 512);
    let mut view = Vec::new();
    Fixed::write(&v, &mut Writer::new(&mut view), "v").expect("encodes");
    c.extract(&view).expect("the FULL packet");
    let mut got = std::collections::BTreeSet::new();
    for _ in 0..(1156 / 8 + 2) {
        let p = decode(&c.extract(&view).expect("a packet"));
        let keys = all_tile_keys(&p);
        assert!(keys.len() <= 8);
        got.extend(keys);
    }
    assert_eq!(got.len(), 1156, "every held chunk arrived");
}

/// Finding 6: what is held is per surface, and MOVERS show the view's surface only. Switching the view to
/// surface 1 sends its chunks at the same coordinates and no character of surface 0 (the reviewed code sent no
/// tiles and surface 0's character).
#[test]
fn finding_6_packets_tell_surfaces_apart() {
    let mut b = bench::m0_walk(&protos()).expect("a world with player 0");
    b.run(1).expect("the join");
    let w = b.ctx.world_mut().expect("w");
    bench::generate_chunks(
        w,
        schema::SurfaceIndex(1),
        (-2..=2).flat_map(|x| (-2..=2).map(move |y| schema::chunk_key(x, y))),
    );
    let state = b.ctx.checkpoint().expect("a two-surface save");
    let mut c = ctx();
    c.load(&state_input(&state)).expect("loads");
    let on = |surface: u16| {
        let mut v = ViewRequest::read(&mut Reader::new(&bench::view_around(0, 0, 0)), "v").expect("v");
        v.surface = schema::SurfaceIndex(surface);
        let mut out = Vec::new();
        Fixed::write(&v, &mut Writer::new(&mut out), "v").expect("encodes");
        out
    };
    c.extract(&on(0)).expect("the FULL packet");
    let mut zero = Vec::new();
    for _ in 0..8 {
        let p = decode(&c.extract(&on(0)).expect("a packet"));
        assert!(p.sections.iter().any(|s| s.0 == PacketSection::Movers) || !zero.is_empty());
        zero.extend(all_tile_keys(&p));
    }
    let mut one = Vec::new();
    for k in 0..8 {
        let p = decode(&c.extract(&on(1)).expect("a packet"));
        assert!(p.sections.iter().all(|s| s.0 != PacketSection::Movers), "packet {k}: surface 0's character");
        one.extend(all_tile_keys(&p));
    }
    // The view's held set is chunks −2 … 1 on both axes; surface 1 has all 16 generated.
    one.sort_unstable();
    assert_eq!(one.len(), 16, "every generated chunk of surface 1 in the held set: {one:?}");
    assert!(one.iter().all(|k| zero.contains(k)), "the same coordinates as surface 0's");
}

/// Finding 9: source revisions and shared evaluation (§15.5). Two windows on one untouched chest cost one build
/// (the reviewed code built two records every packet), and nothing more while the chest is untouched; touching
/// it builds one record for both.
#[test]
fn finding_9_unchanged_sources_skip_building_and_twins_share() {
    let mut c = loaded();
    let view = plain_view();
    c.extract(&view).expect("the FULL packet");
    subscribe(&mut c, &[(1, ProjectionKind::Inventory, 2, 2), (2, ProjectionKind::Inventory, 2, 2)]);
    let first = ui(&decode(&c.extract(&view).expect("a packet")));
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].2, first[1].2, "the same record for both");
    let builds = c.pres.extract.builds();
    assert_eq!(builds, 1, "one build for the twins");
    for _ in 0..10 {
        assert!(ui(&decode(&c.extract(&view).expect("a packet"))).is_empty());
    }
    assert_eq!(c.pres.extract.builds(), builds, "an untouched chest is not rebuilt");
    // Touch chest A's inventory (serial 2): one build, two records.
    let w = c.world_mut().expect("w");
    let row = sim::handle::slot(w.entity(schema::Serial(2)).expect("chest A")) as usize;
    let inv = w.containers.inv[w.entities.pool_slot[row] as usize];
    w.heap.block_mut(inv)[31] = schema::Slot { key: schema::ItemKey(2 << 3), count: 1 };
    let after = ui(&decode(&c.extract(&view).expect("a packet")));
    assert_eq!(after.len(), 2);
    assert_eq!(c.pres.extract.builds(), builds + 1);
}
