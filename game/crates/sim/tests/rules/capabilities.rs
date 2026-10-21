//! M0's exit: "every action, projection and query outside the capability manifest fails with its explicit error"
//! (10 §12, §2.4, §15.3, §15.5; C8). Every action type the schema knows and M0 does not support, sent with a payload
//! that decodes (the codec probes' `zero`/`mixed` samples, `test/fixtures/codec/probes.txt`), is refused with
//! `action_failed` / `unsupported` and changes nothing; every projection kind outside the manifest answers its
//! subscription with one status-2 record, reason 1; every query kind outside it finishes with `ok` 0, reason 1.

use crate::helpers::*;
use schema::codec::{Fixed, MsgList, Packed, Reader, Writer};
use schema::events::EventPayload;
use schema::packet::{PacketHeader, PacketSection, SectionEntry};
use schema::projections::{ProjectionKind, QueryHeader, QueryKind, SubRequest, UiRecord, UiStatus};
use schema::{
    ActionHeader, ActionType, FailReason, PlayerIndex, QueryId, QueryInput, QueryStepOutput, SubFlags, SubId,
    SubscribeInput, action_supported, projection_supported, query_supported,
};
use std::collections::BTreeMap;
use std::path::Path;

fn from_hex(h: &str) -> Vec<u8> {
    (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).expect("hex")).collect()
}

/// A framed action of each type whose payload decodes: `action:<name> <case> ok <hex>` from the probes.
fn samples() -> BTreeMap<String, Vec<u8>> {
    let text = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/codec/probes.txt"),
    )
    .expect("the codec probes");
    let mut out = BTreeMap::new();
    for l in text.lines().filter(|l| !l.starts_with('#')) {
        let f: Vec<&str> = l.split(' ').collect();
        if let [target, case, "ok", hex] = f.as_slice()
            && let Some(name) = target.strip_prefix("action:")
            && (*case == "zero" || *case == "mixed")
        {
            out.entry(name.to_owned()).or_insert_with(|| from_hex(hex));
        }
    }
    out
}

#[test]
fn every_action_outside_m0_is_refused_as_unsupported_and_changes_nothing() {
    let mut s = golden_scenario("capabilities");
    s.run(1);
    let samples = samples();
    let mut refused = 0;
    for t in ActionType::ALL {
        if action_supported(t) || t.value() >= 0xFF00 {
            continue;
        }
        let framed = samples.get(t.name()).unwrap_or_else(|| panic!("no decodable sample of {}", t.name()));
        let h = ActionHeader::read(&mut Reader::new(framed), "ActionHeader").expect("a framed action");
        assert_eq!(h.r#type, t.value(), "{}", t.name());
        let payload = framed[4..4 + usize::from(h.len)].to_vec();
        let tick = s.tick() + 1;
        s.seq.push_raw(tick, Some(PlayerIndex(0)), t.value(), payload).expect("in order");
        s.run(1);
        let reasons: Vec<FailReason> = s
            .events()
            .iter()
            .filter_map(|(_, e)| match e {
                EventPayload::ActionFailed(f) => Some(f.reason),
                _ => None,
            })
            .collect();
        assert_eq!(reasons, vec![FailReason::Unsupported], "{}", t.name());
        // A refusal changes nothing: the scenario's `set_check_refusals` checks each against the state hash.
        refused += 1;
    }
    assert!(refused >= 30, "action types outside M0: {refused}");
    finish(&s);
}

#[test]
fn every_projection_and_query_outside_m0_fails_with_reason_1() {
    let s = golden_scenario("capabilities-boundary");
    let mut c =
        sim::testkit::start_from(&protos(), s.start_state().0, schema::SimFlags::EMPTY).expect("loads");
    // Subscriptions: one per kind outside the manifest.
    let kinds: Vec<ProjectionKind> =
        ProjectionKind::ALL.into_iter().filter(|k| !projection_supported(*k)).collect();
    assert!(!kinds.is_empty(), "M0 leaves projections out");
    let reqs: Vec<SubRequest<'_>> = kinds
        .iter()
        .enumerate()
        .map(|(i, &kind)| SubRequest {
            sub_id: SubId(i as u32 + 1),
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
    SubscribeInput { subs: MsgList::from_slice(&reqs) }
        .encode(&mut Writer::new(&mut input))
        .expect("encodes");
    c.subscribe(&input).expect("a subscription batch");
    // A world's first packet is FULL, with no record (golden rule 31); the records come in the next.
    c.extract(&golden("view.bin")).expect("the first packet");
    let packet = c.extract(&golden("view.bin")).expect("a packet");
    let mut r = Reader::new(&packet);
    let header = PacketHeader::read(&mut r, "PacketHeader").expect("a header");
    let mut records = Vec::new();
    for _ in 0..header.section_count {
        let e = SectionEntry::read(&mut r, "SectionEntry").expect("an entry");
        if e.r#type == PacketSection::Ui {
            let mut ur = Reader::new(&packet[e.offset as usize..(e.offset + e.byte_length) as usize]);
            for _ in 0..e.count {
                let u = UiRecord::decode(&mut ur).expect("a record");
                records.push((u.sub_id.0, u.status, u.body.to_vec()));
            }
        }
    }
    for (i, k) in kinds.iter().enumerate() {
        let rec =
            records.iter().find(|x| x.0 == i as u32 + 1).unwrap_or_else(|| panic!("no record for {k:?}"));
        assert_eq!(rec.1, UiStatus::Invalid, "{k:?}: status 2");
        assert_eq!(rec.2, 1u16.to_le_bytes().to_vec(), "{k:?}: reason 1 (unsupported)");
    }
    // Queries: one per kind outside the manifest, at most 4 running at once.
    let qkinds: Vec<QueryKind> = QueryKind::ALL.into_iter().filter(|k| !query_supported(*k)).collect();
    assert!(!qkinds.is_empty(), "M0 leaves queries out");
    for chunk in qkinds.chunks(4) {
        for (i, &kind) in chunk.iter().enumerate() {
            let mut q = Vec::new();
            QueryInput { id: QueryId(100 + i as u32), header: QueryHeader { kind, flags: 0 }, params: &[] }
                .encode(&mut Writer::new(&mut q))
                .expect("encodes");
            c.query(&q).expect("a query starts");
        }
        let out = c.query_step(u32::MAX).expect("they finish");
        let v = QueryStepOutput::decode_exact(&out).expect("decodes");
        let mut got = Vec::new();
        v.results.for_each(|r| got.push((r.id.0, r.ok, r.body.to_vec())));
        assert_eq!(got.len(), chunk.len());
        for (id, ok, body) in got {
            assert!(!ok, "query {id}: ok 0");
            assert_eq!(body, 1u16.to_le_bytes().to_vec(), "query {id}: reason 1 (unsupported)");
        }
    }
}
