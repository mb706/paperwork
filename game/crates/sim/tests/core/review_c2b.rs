//! Regression tests for codex's review of C2b (pm/reviews/C2b-r1.md) that need the golden states: the malformed
//! loads of findings 3 and 4 (also frozen as WebAssembly fixtures with C2a-r1's, `review_c2a`), and finding 1's
//! world identity. Each fails on the code the review read. The rule-level findings are in `tests/rules/`.

use crate::common::*;
use schema::CraftFlags;
use schema::codec::Writer;
use schema::{ChunkKey, Direction, RecipeId, ResourceId, SaveSection, SimStatus, SurfaceIndex, Tick};
use sim::r#gen::{
    CraftEntry, MiningMode, WorldgenRequest, decode_chunks, decode_globals, decode_players,
    decode_worldgen_pending, encode_chunks, encode_globals, encode_players, encode_worldgen_pending,
};

/// One malformed load (the same shape as `review_c2a`'s).
pub struct Case {
    pub name: &'static str,
    pub input: Vec<u8>,
    pub expect: SimStatus,
    pub why: &'static str,
}

fn players(save: &[u8], f: impl FnOnce(&mut Vec<sim::r#gen::Player>)) -> Vec<u8> {
    patch_section(save, SaveSection::Players, |b| {
        let mut v = decode_players(b).expect("players");
        f(&mut v);
        let mut out = Vec::new();
        encode_players(&mut Writer::new(&mut out), &v).expect("encodes");
        out
    })
}

fn chunks(save: &[u8], f: impl FnOnce(&mut Vec<sim::r#gen::Chunk>)) -> Vec<u8> {
    patch_section(save, SaveSection::Chunks, |b| {
        let mut v = decode_chunks(b).expect("chunks");
        f(&mut v);
        let mut out = Vec::new();
        encode_chunks(&mut Writer::new(&mut out), &v).expect("encodes");
        out
    })
}

fn pending(save: &[u8], v: Vec<WorldgenRequest>) -> Vec<u8> {
    patch_section(save, SaveSection::WorldgenPending, |b| {
        assert!(decode_worldgen_pending(b).expect("pending").is_empty());
        let mut out = Vec::new();
        encode_worldgen_pending(&mut Writer::new(&mut out), &v).expect("encodes");
        out
    })
}

fn globals(save: &[u8], f: impl FnOnce(&mut sim::r#gen::Globals)) -> Vec<u8> {
    patch_section(save, SaveSection::Globals, |b| {
        let mut g = decode_globals(b).expect("globals");
        f(&mut g);
        let mut out = Vec::new();
        encode_globals(&mut Writer::new(&mut out), &g).expect("encodes");
        out
    })
}

fn entry(recipe: u16, count: u16, progress: f64) -> CraftEntry {
    CraftEntry { recipe: RecipeId(recipe), count, flags: CraftFlags::EMPTY, parent: 0xFFFF, progress }
}

fn request(tick: u32, surface: u16, cx: i32, cy: i32) -> WorldgenRequest {
    WorldgenRequest { commit_tick: Tick(tick), surface: SurfaceIndex(surface), cx, cy }
}

/// C2b-r1's malformed loads, from the golden start (tick 0: player 0 online; the 16 chunks −2 … 1 stored).
pub fn cases() -> Vec<Case> {
    let s = state_file(0);
    let lf = SimStatus::ErrLoadFormat;
    vec![
        Case {
            name: "c2b-queue-recipe-out-of-range",
            input: state_input(&players(&s, |p| p[0].crafting_queue.push(entry(65534, 1, 0.0)))),
            expect: lf,
            why: "C2b-r1 finding 3: a queued recipe the prototypes lack (it trapped at the next tick)",
        },
        Case {
            name: "c2b-queue-count-zero",
            input: state_input(&players(&s, |p| p[0].crafting_queue.push(entry(0, 0, 0.0)))),
            expect: lf,
            why: "C2b-r1 finding 3: a queue entry with no units left",
        },
        Case {
            name: "c2b-queue-progress-behind-the-head",
            input: state_input(&players(&s, |p| {
                p[0].crafting_queue.push(entry(0, 1, 0.25));
                p[0].crafting_queue.push(entry(0, 2, 0.5));
            })),
            expect: lf,
            why: "C2b-r1 finding 3: only the head of a queue is under way",
        },
        Case {
            name: "c2b-queue-progress-negative",
            input: state_input(&players(&s, |p| p[0].crafting_queue.push(entry(0, 1, -1.0)))),
            expect: lf,
            why: "C2b-r1 finding 3: progress below 0",
        },
        Case {
            name: "c2b-mining-a-world-object",
            input: state_input(&players(&s, |p| p[0].mining.mode = MiningMode::WorldObject)),
            expect: lf,
            why: "C2b-r1 finding 3: a mining state M0 does not support (it reached unreachable!)",
        },
        Case {
            name: "c2b-walking-direction-odd",
            input: state_input(&players(&s, |p| {
                p[0].walking = true;
                p[0].walking_dir = Direction::NorthNorthEast;
            })),
            expect: lf,
            why: "C2b-r1 finding 3: walking in a direction start_walking refuses",
        },
        Case {
            name: "c2b-chunk-tile-unknown",
            input: state_input(&chunks(&s, |c| c[0].tiles[0] = schema::TileId(250))),
            expect: lf,
            why: "C2b-r1 finding 3: a tile id the prototypes lack (walking indexed past the table)",
        },
        Case {
            name: "c2b-chunk-resource-empty",
            input: state_input(&chunks(&s, |c| {
                let k = c.iter().position(|c| !c.resources.is_empty()).expect("ore");
                c[k].resources[0].amount = 0;
            })),
            expect: lf,
            why: "C2b-r1 finding 3: a resource with no ore left (mining underflowed it)",
        },
        Case {
            name: "c2b-chunk-unknown-tree",
            input: state_input(&chunks(&s, |c| c[0].trees.push(schema::TreeState::default()))),
            expect: lf,
            why: "C2b-r1 finding 3: a tree of a species the prototypes lack",
        },
        Case {
            name: "c2b-pending-generated-chunk",
            input: state_input(&pending(&s, vec![request(100, 0, 0, 0)])),
            expect: lf,
            why: "C2b-r1 finding 3: a request for a generated chunk (its commit failed an assertion)",
        },
        Case {
            name: "c2b-pending-missing-surface",
            input: state_input(&pending(&s, vec![request(100, 1, 10, 10)])),
            expect: lf,
            why: "C2b-r1 finding 3: a request on a surface the world lacks",
        },
        Case {
            name: "c2b-pending-nine-at-one-tick",
            input: state_input(&pending(&s, (0..9).map(|k| request(100, 0, 10 + k, 10)).collect())),
            expect: lf,
            why: "C2b-r1 finding 3: nine requests commit in one tick (at most 8)",
        },
        Case {
            name: "c2b-resource-settings-unbounded",
            input: state_input(&globals(&s, |g| {
                g.map.resources = vec![schema::ResourceSettings {
                    resource: ResourceId(0),
                    frequency: 1.0,
                    size: 1e30,
                    richness: 1.0,
                }];
            })),
            expect: lf,
            why: "C2b-r1 finding 4: a resource size of 1e30 (a chunk's work had no bound)",
        },
        Case {
            name: "c2b-water-scale-infinite",
            input: state_input(&globals(&s, |g| g.map.water_scale = f64::INFINITY)),
            expect: lf,
            why: "C2b-r1 finding 4: a multiplier that is not finite",
        },
    ]
}

#[test]
fn c2b_malformed_loads_are_refused_natively() {
    for c in cases() {
        let mut m = ctx();
        let got = m.load(&c.input).map_or_else(|e| e.status, |()| SimStatus::Ok);
        assert_eq!(got, c.expect, "{}: {}", c.name, c.why);
    }
}

/// Finding 1: the world hash covers every setting generation reads (here the climate compass, a world setting)
/// and the generator's version; an answer for the compass-off world is ignored by the compass-on one.
#[test]
fn the_world_hash_covers_the_climate_compass() {
    let nw = |compass: bool| {
        let mut v = schema::NewWorld { seed: 7, ..schema::NewWorld::default() };
        v.world.climate_compass = compass;
        let mut rec = Vec::new();
        v.encode(&mut Writer::new(&mut rec)).expect("encodes");
        rec
    };
    let mut on = ctx();
    on.new_world(&nw(true)).expect("a world");
    let mut off = ctx();
    off.new_world(&nw(false)).expect("a world");
    assert_ne!(on.world_hash(), off.world_hash(), "the compass changes the climate, so the identity");
    // A request of the compass-on world, answered by the compass-off world's generator: ignored.
    let w = on.world_mut().expect("w");
    w.add_pending((Tick(100), SurfaceIndex(0), 0, 9));
    let foreign = off.world().expect("w").regen.generator().expect("g").chunk(SurfaceIndex(0), 9, 0);
    let mut b = Vec::new();
    foreign.encode(&mut Writer::new(&mut b)).expect("encodes");
    let before = on.state_hashes().expect("hash").full;
    on.supply_chunk(&b).expect("ignored");
    assert_eq!(on.state_hashes().expect("hash").full, before);
    for _ in 0..100 {
        on.tick(&[]).expect("idle");
    }
    let own = on.world().expect("w").regen.generator().expect("g").chunk(SurfaceIndex(0), 9, 0);
    let g = on.world().expect("w").chunks.generated().iter().find(|g| g.key == ChunkKey(own.key.0)).cloned();
    assert_eq!(
        g.map(|g| (g.theta, g.sunlight)),
        Some((own.theta, own.sunlight)),
        "committed inline, not foreign"
    );
    assert_ne!(
        (own.theta, own.sunlight),
        (foreign.theta, foreign.sunlight),
        "the two worlds' climates differ"
    );
}

/// Finding 1, under simcheck: an answer with this world's hash but other content is refused.
#[test]
#[cfg(feature = "simcheck")]
fn a_forged_answer_is_refused_under_simcheck() {
    let mut c = ctx();
    let mut rec = Vec::new();
    schema::NewWorld { seed: 7, ..schema::NewWorld::default() }
        .encode(&mut Writer::new(&mut rec))
        .expect("encodes");
    c.new_world(&rec).expect("a world");
    c.world_mut().expect("w").add_pending((Tick(100), SurfaceIndex(0), 0, 9));
    let g = c.world().expect("w").regen.generator().expect("g").clone();
    let mut forged = g.chunk(SurfaceIndex(0), 9, 0);
    forged.tiles[0] = if forged.tiles[0] == forged.tiles[1] { forged.tiles[2] } else { forged.tiles[1] };
    if forged.tiles[0] == g.chunk(SurfaceIndex(0), 9, 0).tiles[0] {
        forged.theta += 1.0;
    }
    let mut b = Vec::new();
    forged.encode(&mut Writer::new(&mut b)).expect("encodes");
    assert_eq!(c.supply_chunk(&b).expect_err("forged").status, SimStatus::ErrInput);
    let mut good = Vec::new();
    g.chunk(SurfaceIndex(0), 9, 0).encode(&mut Writer::new(&mut good)).expect("encodes");
    c.supply_chunk(&good).expect("the true answer is held");
}

/// Finding 4: `sim_new_world` refuses settings outside the bounds.
#[test]
fn new_world_refuses_unbounded_settings() {
    for map in [
        schema::MapSettings {
            resources: vec![schema::ResourceSettings {
                resource: ResourceId(0),
                frequency: 1.0,
                size: 1e30,
                richness: 1.0,
            }],
            ..schema::MapSettings::default()
        },
        schema::MapSettings {
            resources: vec![schema::ResourceSettings {
                resource: ResourceId(0),
                frequency: 0.01,
                size: 1.0,
                richness: 1.0,
            }],
            ..schema::MapSettings::default()
        },
        schema::MapSettings { starting_area: 7.0, ..schema::MapSettings::default() },
        schema::MapSettings { water_coverage: f64::NAN, ..schema::MapSettings::default() },
    ] {
        let mut rec = Vec::new();
        let nw = schema::NewWorld { seed: 1, map, ..schema::NewWorld::default() };
        if nw.encode(&mut Writer::new(&mut rec)).is_err() {
            continue; // the encoder itself refuses NaN
        }
        let e = ctx().new_world(&rec).expect_err("unbounded");
        assert_eq!(e.status, SimStatus::ErrInput, "{}", e.message);
    }
}
