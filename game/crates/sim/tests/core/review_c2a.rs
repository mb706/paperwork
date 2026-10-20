//! Regression tests for codex's review of C2a (pm/reviews/C2a-r1.md), one or more per finding; each fails on the
//! code the review read. The malformed loads (findings 1, 2 and 4) are also frozen as fixtures in
//! `game/test/sim-wasm/cases/`, which the WebAssembly runner (`test/sim-wasm/sim-wasm.test.ts`) loads into
//! `sim.wasm`, so native code and wasm32 answer the same (`UPDATE_SIM_WASM_CASES=1` rewrites them).

use crate::common::*;
use schema::{ItemKey, SaveSection, SimStatus, Slot};
use sim::r#gen::{decode_players, decode_slot_heap, encode_players, encode_slot_heap};
use sim::heap::inv_ref;

/// The golden start (tick 0): chests A and B (serials 2, 3) in entity rows 0 and 1 and container rows 0 and 1
/// (blocks 0 and 1 of class 5), player 0 (character serial 1, main inventory: class 7, block 0).
fn start() -> Vec<u8> {
    state_file(0)
}

fn load(input: &[u8]) -> SimStatus {
    let mut c = ctx();
    match c.load(input) {
        Ok(()) => SimStatus::Ok,
        Err(e) => e.status,
    }
}

const IRON_PLATE: u16 = 2 << 3;

/// One malformed load: its name, its `sim_load` input, the status it must get, and why.
struct Case {
    name: &'static str,
    input: Vec<u8>,
    expect: SimStatus,
    why: &'static str,
}

fn with_container_inv(save: &[u8], row: usize, v: u32) -> Vec<u8> {
    patch_section(save, SaveSection::PoolContainer, |t| set_column_u32(t, "inv", row, v))
}

fn with_players(save: &[u8], f: impl FnOnce(&mut Vec<sim::r#gen::Player>)) -> Vec<u8> {
    patch_section(save, SaveSection::Players, |b| {
        let mut ps = decode_players(b).expect("players");
        f(&mut ps);
        let mut out = Vec::new();
        encode_players(&mut schema::codec::Writer::new(&mut out), &ps).expect("encodes");
        out
    })
}

fn with_heap(save: &[u8], f: impl FnOnce(&mut sim::r#gen::SlotHeap)) -> Vec<u8> {
    patch_section(save, SaveSection::SlotHeap, |b| {
        let mut h = decode_slot_heap(b).expect("heap");
        f(&mut h);
        let mut out = Vec::new();
        encode_slot_heap(&mut schema::codec::Writer::new(&mut out), &h).expect("encodes");
        out
    })
}

fn cases() -> Vec<Case> {
    let s = start();
    // Finding 1: block 13,421,773 of class 10 (320 slots) starts at slot 4,294,967,360, which a 32-bit `usize`
    // wraps to 64. The chest that names it is removed by the remap.
    let far = inv_ref(10, 13_421_773).0;
    // Chest A's own block is emptied too, so nothing else in the save betrays the dangling reference: the
    // reviewed code removed the chest and accepted the save.
    let dangling = with_heap(&with_container_inv(&s, 0, far), |h| {
        let a = h.arenas.iter_mut().find(|a| a.class == 5).expect("class 5");
        a.slots[..32].fill(sim::heap::EMPTY_SLOT);
    });
    let remove_chests: &[(u16, &[u16], &[&str])] = &[(3, &[0xFFFF, 1], &["iron-chest"])];
    let (frames, _) = sim::save::parse_save_output(&s).expect("a state");
    let section = |id: SaveSection| frames.iter().find(|f| f.id == id.value()).expect("a section").data;
    let player_main = decode_players(section(SaveSection::Players)).expect("players")[0].main.0;
    let chest_inv = get_column_u32(section(SaveSection::PoolContainer), "inv", 0);
    vec![
        Case {
            name: "remap-removes-a-chest-with-a-missing-block",
            input: load_input_with_remaps(&dangling, remove_chests),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 1: the reference is checked before the remap follows it",
        },
        Case {
            name: "remap-removes-the-chests",
            input: load_input_with_remaps(&s, remove_chests),
            expect: SimStatus::Ok,
            why: "finding 1: a valid removal still loads, its blocks cleared",
        },
        Case {
            name: "chest-x2-i32-max",
            input: state_input(&patch_section(&s, SaveSection::EntityTable, |t| {
                set_column_u32(t, "x2", 0, i32::MAX as u32)
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 2: a centre whose footprint overflows i32 (a trap natively, accepted wrapped in release)",
        },
        Case {
            name: "chest-x2-aliases-a-chunk",
            input: state_input(&patch_section(&s, SaveSection::EntityTable, |t| {
                set_column_u32(t, "x2", 0, (2 * (36 + (65_536 << 5)) + 1) as u32)
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 2: tile 36 + 2^21 is outside the chunk-key range and aliased chunk 1",
        },
        Case {
            name: "chest-outside-the-map",
            input: state_input(&patch_section(&s, SaveSection::EntityTable, |t| {
                set_column_u32(t, "x2", 0, 2 * 60 + 1)
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 2: tile 60 lies in a generated chunk but outside the 96-wide map",
        },
        Case {
            name: "player-position-infinite",
            input: state_input(&with_players(&s, |ps| ps[0].x = f64::INFINITY)),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 2: a position must be finite and inside the chunk range",
        },
        Case {
            name: "worldgen-request-in-the-past",
            input: state_input(&patch_section(&s, SaveSection::WorldgenPending, |_| {
                let mut out = Vec::new();
                let r = sim::r#gen::WorldgenRequest {
                    commit_tick: schema::Tick(0),
                    surface: schema::SurfaceIndex(0),
                    cx: 0,
                    cy: 0,
                };
                sim::r#gen::encode_worldgen_pending(&mut schema::codec::Writer::new(&mut out), &[r]).unwrap();
                out
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 2: a request committing at or before the save's tick",
        },
        Case {
            name: "swapped-inventories",
            input: state_input(&with_players(&with_container_inv(&s, 0, player_main), |ps| {
                ps[0].main = schema::InvRef(chest_inv)
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 4: the player's 80 slots in a 32-slot block and a chest in a 128-slot one",
        },
        Case {
            name: "items-past-the-inventory-size",
            input: state_input(&with_heap(&s, |h| {
                let a = h.arenas.iter_mut().find(|a| a.class == 7).expect("class 7");
                a.slots[100] = Slot { key: ItemKey(IRON_PLATE), count: 1 };
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 4: slot 100 of the player's 80",
        },
        Case {
            name: "stack-over-its-stack-size",
            input: state_input(&with_heap(&s, |h| {
                let a = h.arenas.iter_mut().find(|a| a.class == 5).expect("class 5");
                a.slots[31] = Slot { key: ItemKey(IRON_PLATE), count: 101 };
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 4: 101 iron plates in one slot (a stack is 100)",
        },
        Case {
            name: "limit-bar-past-the-size",
            input: state_input(&with_heap(&s, |h| {
                h.bars.push(sim::r#gen::InvBar { inv: schema::InvRef(player_main), bar: 100 });
                h.bars.sort_by_key(|b| b.inv);
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 4: a bar at 100 on 80 slots (inside the 128-slot block)",
        },
        Case {
            name: "hand-origin-past-the-size",
            input: state_input(&with_players(&s, |ps| {
                ps[0].hand =
                    sim::r#gen::Hand { key: ItemKey(IRON_PLATE), ghost: false, origin: 100, count: 1 }
            })),
            expect: SimStatus::ErrLoadFormat,
            why: "finding 4: a hand whose origin slot is 100 of 80",
        },
    ]
}

#[test]
fn malformed_loads_are_refused_natively() {
    for c in cases() {
        assert_eq!(load(&c.input), c.expect, "{}: {}", c.name, c.why);
    }
}

#[test]
fn a_valid_removal_clears_the_blocks_and_reports_the_chests() {
    let mut c = ctx();
    c.load(&load_input_with_remaps(&start(), &[(3, &[0xFFFF, 1], &["iron-chest"])])).expect("loads");
    let w = c.world().expect("a world");
    assert_eq!(w.entity_count(), 0);
    let removed = c.removed();
    assert_eq!(removed.len(), 1);
    assert_eq!((removed[0].name.as_str(), removed[0].count), ("iron-chest", 2));
    for b in [inv_ref(5, 0), inv_ref(5, 1)] {
        assert!(!w.heap.is_owned(b));
        assert!(w.heap.block(b).iter().all(|s| *s == sim::heap::EMPTY_SLOT));
    }
}

/// The fixtures the WebAssembly runner loads (findings 1, 2 and 4 in wasm32).
#[test]
fn wasm_case_fixtures_are_current() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/sim-wasm/cases");
    let update = std::env::var_os("UPDATE_SIM_WASM_CASES").is_some();
    let mut index = String::from("[\n");
    let all = cases();
    for (i, c) in all.iter().enumerate() {
        let file = format!("{}.bin", c.name);
        let path = dir.join(&file);
        if update {
            std::fs::create_dir_all(&dir).expect("mkdir");
            std::fs::write(&path, &c.input).expect("writes");
        } else {
            let have = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("{}: {e} (UPDATE_SIM_WASM_CASES=1)", path.display()));
            assert!(have == c.input, "{file} is stale (UPDATE_SIM_WASM_CASES=1)");
        }
        // Biome's JSON layout (2 spaces, one field per line), so `npm run check` leaves the file as written.
        index.push_str(&format!(
            "  {{\n    \"name\": \"{}\",\n    \"call\": \"sim_load\",\n    \"input\": \"{file}\",\n    \"expect\": \"{}\",\n    \"why\": \"{}\"\n  }}{}\n",
            c.name,
            c.expect.name(),
            c.why,
            if i + 1 < all.len() { "," } else { "" }
        ));
    }
    index.push_str("]\n");
    let path = dir.join("index.json");
    if update {
        std::fs::write(&path, &index).expect("writes");
    } else {
        let have = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(have == index, "test/sim-wasm/cases/index.json is stale (UPDATE_SIM_WASM_CASES=1)");
    }
}

/// Finding 5: the blobs held for a tick are bounded before anything is copied.
#[test]
fn the_blob_store_is_bounded() {
    use sim::context::{BLOB_MAX_BYTES, BLOBS_MAX, BLOBS_MAX_BYTES};
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let put = |c: &mut sim::SimContext, bytes: &[u8]| -> SimStatus {
        let mut input = sim::sha256::sha256(bytes).to_vec();
        input.extend_from_slice(bytes);
        c.blob_put(&input).map_or_else(|e| e.status, |()| SimStatus::Ok)
    };
    for i in 0..BLOBS_MAX as u32 {
        assert_eq!(put(&mut c, &i.to_le_bytes()), SimStatus::Ok);
    }
    assert_eq!(put(&mut c, &0u32.to_le_bytes()), SimStatus::Ok, "a blob already held is not counted twice");
    assert_eq!(put(&mut c, &9999u32.to_le_bytes()), SimStatus::ErrLimit, "the 65th blob");
    c.tick(&[]).expect("a tick drops the held blobs");
    let big = vec![7u8; BLOB_MAX_BYTES + 1];
    assert_eq!(put(&mut c, &big), SimStatus::ErrInput, "over 8 MiB");
    let n = BLOBS_MAX_BYTES / BLOB_MAX_BYTES;
    for i in 0..n {
        let mut b = vec![0u8; BLOB_MAX_BYTES];
        b[0] = i as u8;
        assert_eq!(put(&mut c, &b), SimStatus::Ok);
    }
    assert_eq!(put(&mut c, &[1]), SimStatus::ErrLimit, "past 32 MiB together");
}

/// Finding 6: a stale handle never converts to the serial of the entity that reused its row.
#[test]
fn a_stale_handle_has_no_serial() {
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let w = c.world_mut().expect("a world");
    let chest = |tx: i32| sim::world::NewEntity {
        proto: schema::EntityId(0),
        surface: 0,
        x2: 2 * tx + 1,
        y2: 2 * 40 + 1,
        dir: schema::Direction::North,
        flip: 0,
        quality: 0,
        built_by: 16,
        flags: schema::EntityFlags::EMPTY,
        built_tick: schema::Tick(0),
    };
    let (a, ha) = w.create_entity(&chest(0)).expect("creates A");
    assert_eq!(w.serial_of(ha), a);
    w.destroy_entity(ha);
    let (b, hb) = w.create_entity(&chest(1)).expect("creates B in A's row");
    assert_eq!(sim::handle::slot(ha), sim::handle::slot(hb));
    assert_ne!(a, b);
    assert_eq!(w.serial_of(ha), schema::Serial::NONE, "A's handle is stale");
    assert_eq!(w.serial_of(hb), b);
    // The invariants compare whole handles: a pool row naming B's row at A's generation is caught.
    let slot = w.entities.pool_slot[sim::handle::slot(hb) as usize] as usize;
    w.containers.entity[slot] = ha;
    assert!(w.check_invariants().is_err());
}

/// Finding 10: with timers, statistics and worldgen requests in the world, the slicer still matches the
/// reference in every shard, reading only its shard's records.
#[test]
fn populated_collections_slice_like_the_reference() {
    use sim::digest::{Slicer, members, slice_reference};
    use sim::rng::Xoshiro128;
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    let w = c.world_mut().expect("a world");
    let mut r = Xoshiro128::seeded(10, 1);
    let ring = |p: u8| sim::r#gen::StatRing {
        precision: schema::StatPrecision::from_value(p).expect("a precision"),
        points: 0,
        acc_count: 0,
        acc_produced: 0.0,
        acc_consumed: 0.0,
        produced: [0.0; 300],
        consumed: [0.0; 300],
    };
    let mut timers = Vec::new();
    for step in 0..6_000u32 {
        match r.next_u32() % 5 {
            0 | 1 => {
                let k = (
                    schema::Tick(1 + r.next_u32() % 100_000),
                    schema::Serial(r.next_u32() % 20_000),
                    schema::TimerEvent::GhostExpiry,
                    r.next_u32() % 7_200,
                );
                if w.add_timer(k) {
                    timers.push(k);
                }
            }
            2 if !timers.is_empty() => {
                let k = timers.swap_remove((r.next_u32() as usize) % timers.len());
                assert!(w.remove_timer(&k));
            }
            3 => {
                let key = schema::StatKey((1 << 24) | (r.next_u32() % 4_000));
                w.stat_mut(key, || sim::r#gen::Stat {
                    key,
                    produced_total: 0.0,
                    consumed_total: 0.0,
                    handcrafted_total: 0.0,
                    rings: (0..9).map(ring).collect(),
                });
            }
            _ => {
                let k = (
                    schema::Tick(1 + r.next_u32() % 500),
                    schema::SurfaceIndex(0),
                    (r.next_u32() % 2_000) as i32 - 1_000,
                    (r.next_u32() % 2_000) as i32 - 1_000,
                );
                w.add_pending(k);
            }
        }
        if step % 3_000 == 2_999 {
            let all = members(w);
            let mut s = Slicer::new();
            for shard in 0..3_600 {
                assert_eq!(
                    s.slice_hash(w, shard).expect("encodes"),
                    slice_reference(&all, shard),
                    "shard {shard}"
                );
            }
        }
    }
    let total = w.timers().len() + w.stats().len() + w.pending().len();
    assert!(w.timers().len() > 1_000 && w.stats().len() > 500 && w.pending().len() > 500);
    // A slice reads its shard's records, not every record (the reviewed slicer scanned all `total`).
    let mut s = Slicer::new();
    let mut most = 0;
    for shard in 0..3_600 {
        s.slice_hash(w, shard).expect("encodes");
        let expected = w.timer_shards_len(shard) + w.stat_shards_len(shard) + w.pending_shards_len(shard);
        assert_eq!(s.last_visited(), expected, "shard {shard}");
        most = most.max(s.last_visited());
    }
    assert!(most * 50 < total, "at most {most} of {total} records per slice");
}
