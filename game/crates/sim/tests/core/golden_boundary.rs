//! The frozen M0 golden set at the boundary (10 §15.4–§15.6, §15.10; C2c's exit): the golden flow's packets, every
//! M0 projection's record and every query at the state ticks, byte for byte (DEBUG's implementation-defined
//! fields masked), and the ABI traces with extraction, subscriptions and queries.

use crate::common::*;
use schema::codec::{Packed, Writer};
use schema::projections::{ProjectionKind, SubRequest};
use schema::{SubFlags, SubId};
use sim::SimContext;
use sim::project::{Built, DebugInputs, ProjScratch, SubReq, build_record};

/// The golden flow (README "How each package consumes it"): load; extract (the FULL packet); subscribe; extract
/// with the view (tick 0); tick 1; extract; ticks 2–600 without extraction; extract. Every packet byte for byte.
#[test]
fn the_golden_flow_gives_the_golden_packets() {
    let log = GoldenLog::load();
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let view = golden("view.bin");
    let check = |c: &mut SimContext, name: &str| {
        let got = c.extract(&view).expect("extracts");
        let want = golden(&format!("packets/{name}.bin"));
        assert!(got == want, "packets/{name}.bin differs: {} bytes against {}", got.len(), want.len());
    };
    check(&mut c, "tick-0000-full");
    c.subscribe(&golden("subs.bin")).expect("the golden subscriptions");
    check(&mut c, "tick-0000");
    log.tick(&mut c, 1).expect("tick 1");
    check(&mut c, "tick-0001");
    for t in 2..=600 {
        log.tick(&mut c, t).expect("a tick");
    }
    check(&mut c, "tick-0600");
}

/// One line of `projections/tick-NNNN.txt`: the record's name, its request (sub_id 1) and its status (`ok`,
/// `gone`, `invalid reason=R`); DEBUG's line is masked and checked apart.
fn projection_index(t: u32) -> Vec<(String, SubReq, String)> {
    golden_text(&format!("projections/tick-{t:04}.txt"))
        .lines()
        .filter_map(|l| l.strip_prefix("## "))
        .filter(|l| !l.starts_with("debug "))
        .map(|l| {
            let name = l.split(' ').next().expect("a name").to_owned();
            let field = |k: &str| {
                l.split(' ')
                    .find_map(|f| f.strip_prefix(k).and_then(|v| v.strip_prefix('=')))
                    .expect("a field")
            };
            let num = |k: &str| field(k).parse::<u32>().expect("a number");
            let kind = ProjectionKind::from_name(field("kind")).expect("a kind");
            let req = SubReq {
                sub_id: 1,
                kind,
                target: num("target"),
                p: [num("p0"), num("p1"), num("p2"), 0],
                tail: None,
            };
            let status =
                l.split(" status=").nth(1).expect("a status").split(" bytes=").next().expect("a status");
            (name, req, status.to_owned())
        })
        .collect()
}

/// Every M0 projection at every state tick, evaluated as a fresh subscription (STATS whole), and every query.
#[test]
fn the_projections_and_queries_at_the_state_ticks() {
    let log = GoldenLog::load();
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let mut checked = 0;
    for t in 0..=3600u32 {
        if t > 0 {
            log.tick(&mut c, t).expect("a tick");
        }
        if !STATE_TICKS.contains(&t) {
            continue;
        }
        let w = c.world().expect("a world");
        let dbg = DebugInputs { d: c.last_digest(), r: c.lineage(), memory_bytes: 0, phase_us: None };
        let chests: Vec<u32> = w.entities_by_serial().into_iter().map(|h| w.serial_of(h).0).collect();
        let req = |kind, target, p0, p2| SubReq { sub_id: 1, kind, target, p: [p0, 0, p2, 0], tail: None };
        let index = projection_index(t);
        // The index covers every chest of the tick (an inventory, a panel and a hover each).
        let mut named: Vec<u32> = index
            .iter()
            .filter_map(|(n, _, _)| n.strip_prefix("hover-"))
            .map(|s| s.parse().expect("a serial"))
            .collect();
        named.sort_unstable();
        assert_eq!(named, chests, "tick {t}: the chests");
        let (mut scratch, mut out) = (ProjScratch::default(), Vec::new());
        for (name, r, want) in &index {
            let built = build_record(w, r, None, dbg, &mut scratch, &mut out);
            match built {
                Built::Ok => {
                    assert_eq!(want, "ok", "tick {t}: {name}");
                    let file = golden(&format!("projections/tick-{t:04}/{name}.bin"));
                    assert!(
                        out == file,
                        "tick {t}: {name}.bin differs ({} bytes against {})",
                        out.len(),
                        file.len()
                    );
                }
                Built::Gone => assert_eq!(want, "gone", "tick {t}: {name}"),
                Built::Invalid(reason) => {
                    assert_eq!(*want, format!("invalid reason={}", reason.value()), "tick {t}: {name}")
                }
            }
            checked += 1;
        }
        // DEBUG, its implementation-defined fields masked (README "Masked fields").
        let built = build_record(w, &req(ProjectionKind::Debug, 0, 0, 0), None, dbg, &mut scratch, &mut out);
        assert_eq!(built, Built::Ok);
        let file = golden(&format!("projections/tick-{t:04}/debug.bin"));
        let (a, b) = (
            schema::projections::Debug::decode_exact(&out).expect("ours"),
            schema::projections::Debug::decode_exact(&file).expect("golden"),
        );
        assert_eq!((a.tick, a.entity_count, a.d, a.r), (b.tick, b.entity_count, b.d, b.r), "tick {t}: DEBUG");
        let rows = |d: &schema::projections::Debug<'_>| {
            d.pools.iter().map(|p| (p.pool, p.rows, p.active)).collect::<Vec<_>>()
        };
        assert_eq!(rows(&a), rows(&b), "tick {t}: DEBUG pools");
        // Queries: inspect each chest and serial 1 (a character, no entity), the state hash, the digest.
        let mut q = |kind: schema::projections::QueryKind, params: &[u8]| -> Vec<u8> {
            let mut input = Vec::new();
            schema::QueryInput {
                id: schema::QueryId(7),
                header: schema::projections::QueryHeader { kind, flags: 0 },
                params,
            }
            .encode(&mut Writer::new(&mut input))
            .expect("encodes");
            c.query(&input).expect("starts");
            let out = c.query_step(u32::MAX).expect("finishes");
            let v = schema::QueryStepOutput::decode_exact(&out).expect("decodes");
            let mut body = Vec::new();
            v.results.for_each(|r| {
                assert!(r.ok);
                body = r.body.to_vec();
            });
            body
        };
        let files =
            std::fs::read_dir(golden_dir().join(format!("queries/tick-{t:04}"))).expect("a dir").count();
        assert_eq!(files, chests.len() + 3, "tick {t}: inspect each chest and serial 1, hash, digest");
        for s in chests.iter().copied().chain([1]) {
            let got = q(schema::projections::QueryKind::Inspect, &s.to_le_bytes());
            assert!(got == golden(&format!("queries/tick-{t:04}/inspect-{s}.bin")), "tick {t}: inspect {s}");
        }
        assert!(
            q(schema::projections::QueryKind::Hash, &[]) == golden(&format!("queries/tick-{t:04}/hash.bin")),
            "tick {t}: hash"
        );
        assert!(
            q(schema::projections::QueryKind::Digest, &[])
                == golden(&format!("queries/tick-{t:04}/digest.bin")),
            "tick {t}: digest"
        );
    }
    assert!(checked > 60, "{checked} records");
}

/// The hover projection is sub_id 0's: a request for it is ERR_INPUT (rule 30).
#[test]
fn sub_id_zero_is_refused() {
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let r = SubRequest {
        sub_id: SubId(0),
        kind: ProjectionKind::Hud,
        flags: SubFlags::EMPTY,
        target: 0,
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
        tail: None,
    };
    let mut input = Vec::new();
    schema::SubscribeInput { subs: schema::codec::MsgList::from_slice(&[r]) }
        .encode(&mut Writer::new(&mut input))
        .expect("encodes");
    assert_eq!(c.subscribe(&input).expect_err("sub_id 0").status, schema::SimStatus::ErrInput);
}
