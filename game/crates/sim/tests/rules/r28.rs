//! R28 (10 §10.8; §4.4, §5.18, D12), M0's cases: a chunk whose worker answer is withheld is generated inline at
//! its commit tick with the same chunk; a late answer, or one carrying another world's hash, is ignored; with
//! no pool at all the world is the same; a burst of requests commits at most 8 chunks per tick, in canonical
//! order; a save and a load with pristine chunks around a walking character continue bit-identically (`finish`'s
//! reloads); a load regenerates no pristine chunk until a rule touches it; a save made under another worldgen
//! version is refused unless baked.

use crate::helpers::*;
use schema::codec::{Packed, Reader, Writer};
use schema::{Direction, PendingChunks, SaveSection, SimStatus, SurfaceIndex, chunk_key};
use sim::SimContext;
use sim::testkit::{Recorded, Scenario, Schedule, Variant, compare, record, record_with};

/// A character walking east from spawn until it crosses into chunk 1: one burst of 15 requests.
fn walker(name: &str) -> Scenario {
    let mut s = scenario(name, 7);
    s.system(joined(0));
    s.run(1);
    s.act(0, walk(Direction::East));
    while s.world().pending().is_empty() {
        s.run(1);
        assert!(s.tick() < 600, "the character reached chunk 1");
    }
    s
}

/// The shell's part (§15.9): every request issued since the last call, answered by a worker — here the same
/// generator, natively.
fn answer_all(c: &mut SimContext, extra: &mut dyn FnMut(&mut SimContext)) {
    let out = c.pending_chunks().expect("a world");
    let p = PendingChunks::decode(&mut Reader::new(&out)).expect("PendingChunks");
    let w = c.world().expect("a world");
    let g = w.regen.generator().expect("a generator").clone();
    for q in p.requests.iter() {
        let d = g.chunk(q.surface, q.cx, q.cy);
        let mut b = Vec::new();
        d.encode(&mut Writer::new(&mut b)).expect("encodes");
        c.supply_chunk(&b).expect("an answer is accepted");
    }
    extra(c);
}

#[test]
fn r28_a_burst_commits_eight_per_tick_in_canonical_order() {
    let mut s = walker("r28-burst");
    let t = s.tick();
    let pending: Vec<_> = s.world().pending().iter().copied().collect();
    assert_eq!(pending.len(), 15, "chunk column cx = 8, cy −7 … 7");
    let at = |tick: u32| pending.iter().filter(|k| k.0.0 == tick).count();
    assert_eq!((at(t + 30), at(t + 31)), (8, 7), "at most 8 commits per tick, from t + 30 on");
    assert!(pending.windows(2).all(|w| w[0] < w[1]), "commit order: (tick, surface, cy, cx)");
    assert!(pending.iter().all(|k| k.3 == 8 && (-7..=7).contains(&k.2)));
    let generated = s.world().chunks.generated().len();
    s.run_until(t + 30);
    assert_eq!(s.world().chunks.generated().len(), generated + 8);
    s.run(1);
    assert_eq!(s.world().chunks.generated().len(), generated + 15);
    assert!(!s.world().is_pending(SurfaceIndex(0), chunk_key(8, 0)));
    s.run(200);
    finish(&s);
}

#[test]
fn r28_worker_answers_late_and_foreign_answers_give_the_same_world() {
    let mut s = walker("r28-worker-answers");
    s.run(400);
    let (start, _) = s.start_state();
    let (start, protos) = (start.to_vec(), s.protos().to_vec());
    let closures: Recorded = s.closures().clone();
    let n = s.ticks();
    let every = Schedule { every_tick_until: n, then_every: 0 };
    // No pool at all: inline generation throughout (the reference).
    let inline = record(&protos, &start, &closures, n, Variant::Plain, every).expect("runs");
    // A pool answering every request at once, plus answers the sim must ignore: one for a chunk generated
    // long ago (late), one for a chunk nobody asked for, and one from another world.
    let mut late = 0;
    let answered = record_with(&protos, &start, &closures, n, Variant::Plain, every, &mut |_, c| {
        answer_all(c, &mut |c| {
            let w = c.world().expect("a world");
            let g = w.regen.generator().expect("a generator").clone();
            let before = c.state_hashes().expect("hash").full;
            for (cx, cy, foreign) in [(0, 0, false), (400, 400, false), (8, 1, true)] {
                let mut d = g.chunk(SurfaceIndex(0), cx, cy);
                if foreign {
                    d.world_hash ^= 1;
                    d.tiles = [schema::TileId(0); 1024];
                }
                let mut b = Vec::new();
                d.encode(&mut Writer::new(&mut b)).expect("encodes");
                c.supply_chunk(&b).expect("ignored, not refused");
                late += 1;
            }
            assert_eq!(c.state_hashes().expect("hash").full, before, "answers never change the World");
        });
    })
    .expect("runs");
    compare(&inline, &answered).unwrap_or_else(|d| panic!("answers changed the run: {d}"));
    assert!(late > 0);
    finish(&s);
}

#[test]
fn r28_a_load_regenerates_nothing_until_a_rule_touches_it() {
    let mut s = scenario("r28-lazy-regeneration", 7);
    // 30,000 more generated chunks far from spawn (records only, as a long game leaves them).
    {
        let w = s.ctx.world_mut().expect("a world");
        for i in 0..30_000i32 {
            let (cx, cy) = (100 + i % 200, 100 + i / 200);
            w.chunks
                .insert_generated(sim::r#gen::GeneratedChunk {
                    surface: SurfaceIndex(0),
                    key: chunk_key(cx, cy),
                    kappa: 0.005,
                    theta: 14.0,
                    sunlight: 1.0,
                })
                .expect("new");
        }
    }
    let save = s.ctx.checkpoint().expect("saves");
    let mut c = sim::testkit::start_from(&protos(), &save, schema::SimFlags::EMPTY).expect("loads");
    assert_eq!(c.world().expect("w").chunks.generated().len(), 30_225);
    assert_eq!(c.world().expect("w").regen.generated(), 0, "a load regenerates nothing");
    for _ in 0..50 {
        c.tick(&[]).expect("idle");
    }
    assert_eq!(c.world().expect("w").regen.generated(), 0, "idle ticks touch nothing");
    // A character joining at spawn and walking touches the chunks under it, and only those.
    let mut seq = sim::testkit::TestSequencer::new(&c);
    let t = c.world().expect("w").current_tick();
    seq.push_system(t + 1, &joined(0)).expect("in order");
    seq.push(t + 2, schema::PlayerIndex(0), &walk(Direction::South)).expect("in order");
    for k in 1..=100 {
        c.tick(&seq.closure(t + k)).expect("ticks");
    }
    let n = c.world().expect("w").regen.generated();
    assert!((1..=4).contains(&n), "{n} chunks regenerated");
    // D18 (a–c) from the 30,225-chunk save (its megabyte start state is not kept as a session in test/logs/).
    let mut big = Scenario::from_state("r28-lazy-regeneration", &protos(), &save).expect("loads");
    big.system(joined(0));
    big.run(1);
    big.act(0, walk(Direction::South));
    big.run(120);
    big.check_equivalence(&[17, 60], 23).unwrap_or_else(|e| panic!("D18: {e}"));
    let _ = &mut s;
}

#[test]
fn r28_saves_under_another_worldgen_load_only_baked() {
    let mut s = scenario("r28-baked-saves", 7);
    s.system(joined(0));
    s.run(10);
    let plain = s.ctx.checkpoint().expect("saves");
    let baked = s.ctx.save(&1u32.to_le_bytes()).expect("a baked save");
    let other = |save: &[u8]| {
        crate::common::patch_section(save, SaveSection::Globals, |g| {
            let mut v = sim::r#gen::decode_globals(g).expect("globals");
            v.worldgen_version += 1;
            let mut out = Vec::new();
            sim::r#gen::encode_globals(&mut Writer::new(&mut out), &v).expect("encodes");
            out
        })
    };
    let mut c = SimContext::new();
    c.init_protos(&protos(), schema::SimFlags::EMPTY).expect("protos");
    let patched = other(&plain);
    let (frames, r) = sim::save::parse_save_output(&patched).expect("SaveOutput");
    let e = c.load(&sim::save::load_input(&frames, r)).expect_err("pristine chunks under another worldgen");
    assert_eq!(e.status, SimStatus::ErrWorldgen);
    let patched = other(&baked);
    let (frames, r) = sim::save::parse_save_output(&patched).expect("SaveOutput");
    c.load(&sim::save::load_input(&frames, r)).expect("a baked save loads under another worldgen");
    let w = c.world().expect("w");
    assert_eq!(w.chunks.modified_count(), w.chunks.generated().len(), "every generated chunk is stored");
    // It continues under this build's worldgen pair, on a new lineage (§4.4, §4.8 item 4; C2a's decision).
    assert_eq!(w.globals.worldgen_version, worldgen::VERSION);
    assert!(c.load_report_record().expect("a report").new_lineage);
    finish(&s);
}

/// An answer that claims this world but holds what worldgen v0 never makes (an empty resource, an unknown
/// tile, a tree) is refused (`ERR_INPUT`) and changes nothing; the chunk is generated inline as without it.
#[test]
fn r28_an_impossible_answer_is_refused() {
    let s = walker("r28-impossible-answer");
    let mut c = sim::testkit::reload(s.protos(), &s.ctx).expect("reloads");
    let k = *s.world().pending().first().expect("a request");
    let g = c.world().expect("w").regen.generator().expect("g").clone();
    let good = g.chunk(k.1, k.3, k.2);
    let before = c.state_hashes().expect("hash").full;
    let mut empty = good.clone();
    if let Some(r) = empty.resources.first_mut() {
        r.amount = 0;
    } else {
        empty.resources.push(schema::ResourceTile { tile: 0, resource: schema::ResourceId(0), amount: 0 });
    }
    let mut unknown = good.clone();
    unknown.tiles[7] = schema::TileId(200);
    let mut tree = good.clone();
    tree.trees.push(schema::TreeState::default());
    for bad in [empty, unknown, tree] {
        let mut b = Vec::new();
        bad.encode(&mut Writer::new(&mut b)).expect("encodes");
        assert_eq!(c.supply_chunk(&b).expect_err("impossible").status, SimStatus::ErrInput);
    }
    assert_eq!(c.state_hashes().expect("hash").full, before);
}
