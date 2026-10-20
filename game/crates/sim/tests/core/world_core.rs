//! The World's core (C2a) under churn: entities created and destroyed in random order keep the entity table,
//! the pools, the slot heap, the serial index, the per-shard buckets, the chunk lists and the occupancy grid
//! consistent; every save loads back to the same bytes and hashes; the incremental slices equal the reference
//! enumeration in every shard; handle generations cycle 1 … 1,023 (rule 28).

use crate::common::*;
use schema::{Direction, EntityFlags, EntityHandle, EntityId, PoolKind, Serial, SurfaceIndex, Tick};
use sim::digest::{Slicer, members, slice_reference};
use sim::handle;
use sim::rng::Xoshiro128;
use sim::spatial::Box2;
use sim::world::NewEntity;

fn chest(tx: i32, ty: i32) -> NewEntity {
    NewEntity {
        proto: EntityId(0), // iron-chest in the golden prototypes
        surface: 0,
        x2: 2 * tx + 1,
        y2: 2 * ty + 1,
        dir: Direction::North,
        flip: 0,
        quality: 0,
        built_by: 16,
        flags: EntityFlags::EMPTY,
        built_tick: Tick(0),
    }
}

fn loaded_start() -> sim::SimContext {
    let mut c = ctx();
    c.load(&container_input(&golden("start.save"))).expect("start.save");
    c
}

fn check_consistency(c: &sim::SimContext, step: usize) {
    let w = c.world().expect("a world");
    // A save loads back to the same bytes and the same hashes.
    let saved = c.checkpoint().expect("saves");
    let mut back = ctx();
    back.load(&state_input(&saved)).unwrap_or_else(|e| panic!("step {step}: reload: {e}"));
    assert_eq!(back.checkpoint().expect("saves"), saved, "step {step}: save → load → save");
    assert_eq!(back.state_hashes().expect("hash"), c.state_hashes().expect("hash"), "step {step}");
    // Every shard: the slicer equals the reference enumeration.
    let all = members(w);
    let mut s = Slicer::new();
    for shard in 0..3600 {
        assert_eq!(
            s.slice_hash(w, shard).expect("encodes"),
            slice_reference(&all, shard),
            "step {step}, shard {shard}"
        );
    }
    // The serial index and the area query agree with a scan of the table.
    let mut scan: Vec<Serial> = (0..w.entities.rows())
        .filter(|&r| w.entities.is_live(r))
        .map(|r| w.entities.serial[r as usize])
        .collect();
    scan.sort_unstable();
    for &s in &scan {
        let h = w.entity(s).expect("a live serial resolves");
        assert!(w.is_live(h));
        assert_eq!(w.serial_of(h), s);
    }
    let everything = Box2 { x0: -48.0, y0: -48.0, x1: 48.0, y1: 48.0 };
    assert_eq!(w.entities_in_area(SurfaceIndex(0), &everything), scan, "step {step}");
    assert_eq!(w.entity_count() as usize, scan.len());
    w.check_invariants().unwrap_or_else(|e| panic!("step {step}: {e}"));
}

#[test]
fn entity_churn_keeps_everything_consistent() {
    let mut c = loaded_start();
    let mut rng = Xoshiro128::seeded(7, 1);
    let mut live: Vec<(Serial, EntityHandle)> = {
        let w = c.world().expect("a world");
        w.entities_by_serial().into_iter().map(|h| (w.serial_of(h), h)).collect()
    };
    let mut destroyed: Vec<(Serial, EntityHandle)> = Vec::new();
    for step in 0..400 {
        let w = c.world_mut().expect("a world");
        let r = rng.next_u32();
        if !r.is_multiple_of(3) || live.is_empty() {
            let tx = (rng.next_u32() % 96) as i32 - 48;
            let ty = (rng.next_u32() % 96) as i32 - 48;
            let next = w.globals.next_serial;
            let (s, h) = w.create_entity(&chest(tx, ty)).expect("a chest in a modified chunk");
            assert_eq!(s, next, "serials are handed out in creation order");
            assert_eq!(w.entities.kind[handle::slot(h) as usize], PoolKind::Container);
            assert!(w.entity_on_tile(SurfaceIndex(0), tx, ty).is_some());
            live.push((s, h));
        } else {
            let i = (r as usize / 3) % live.len();
            let (s, h) = live.swap_remove(i);
            let inv = w.containers.inv[w.entities.pool_slot[handle::slot(h) as usize] as usize];
            w.heap.block_mut(inv)[0] = schema::Slot { key: schema::ItemKey(16), count: 3 };
            w.destroy_entity(h);
            assert!(!w.is_live(h) && w.entity(s).is_none());
            assert!(w.heap.block(inv).iter().all(|x| *x == sim::heap::EMPTY_SLOT), "freed blocks are zeroed");
            destroyed.push((s, h));
        }
        if step % 50 == 49 {
            check_consistency(&c, step);
        }
    }
    let w = c.world().expect("a world");
    for (s, h) in destroyed {
        assert!(w.entity(s).is_none(), "serials are never reused");
        // A destroyed handle stays dead, even when its row was reused (the generation moved on).
        assert!(!w.is_live(h));
    }
}

#[test]
fn handle_generations_cycle_and_survive_a_reload() {
    let mut c = loaded_start();
    let w = c.world_mut().expect("a world");
    // The golden start has rows 0 and 1 live; the next chest takes row 2, and keeps taking it once freed.
    let mut seen = Vec::new();
    for _ in 0..1030 {
        let (_, h) = w.create_entity(&chest(0, 40)).expect("creates");
        seen.push((handle::slot(h), handle::generation(h)));
        w.destroy_entity(h);
    }
    assert!(seen.iter().all(|x| x.0 == 2), "the lowest free row");
    let gens: Vec<u16> = seen.iter().map(|x| x.1).collect();
    assert_eq!(&gens[..3], &[1, 2, 3]);
    assert_eq!(gens[1022], 1023);
    assert_eq!(gens[1023], 1, "generations cycle 1 … 1,023 (rule 28)");
    // The free row keeps its generation through a save and a load (state.yaml `keep`).
    let last_gen = w.entities.r#gen[2];
    let saved = c.checkpoint().expect("saves");
    let mut back = ctx();
    back.load(&state_input(&saved)).expect("reloads");
    let bw = back.world_mut().expect("a world");
    assert_eq!(bw.entities.r#gen[2], last_gen);
    let (_, h) = bw.create_entity(&chest(0, 40)).expect("creates");
    assert_eq!(handle::generation(h), handle::next_generation(last_gen));
}

#[test]
fn creation_needs_modified_chunks_and_a_fitting_centre() {
    let mut c = loaded_start();
    let before = c.checkpoint().expect("saves");
    let w = c.world_mut().expect("a world");
    let mut e = chest(0, 0);
    e.x2 = 0; // a 1×1 entity centres on a tile centre: x2 must be odd
    assert!(w.create_entity(&e).is_err());
    assert!(w.create_entity(&chest(100, 0)).is_err(), "chunk 3 is not generated in the golden map");
    e = chest(0, 0);
    e.proto = EntityId(1); // the character is not a building (it has no pool)
    assert!(w.create_entity(&e).is_err());
    assert_eq!(c.checkpoint().expect("saves"), before, "a refused creation changes nothing");
}

#[test]
fn spatial_queries_by_chunk_lists_and_occupancy() {
    let mut c = loaded_start();
    let w = c.world_mut().expect("a world");
    let (a, ha) = w.create_entity(&chest(-33, 10)).expect("creates"); // chunk −2
    let (b, _) = w.create_entity(&chest(-32, 10)).expect("creates"); // chunk −1, touching tiles
    // The chests' boxes are ±0.35: a box across both tiles meets both, ascending by serial.
    let across = Box2 { x0: -33.0, y0: 10.0, x1: -31.0, y1: 11.0 };
    assert_eq!(w.entities_in_area(SurfaceIndex(0), &across), vec![a, b]);
    assert_eq!(w.lowest_serial_overlapping(SurfaceIndex(0), &across), Some(a));
    // Strict overlap: a box that ends where a chest's box begins does not meet it.
    let edge = Box2 { x0: -40.0, y0: 10.0, x1: -33.0 + 0.15, y1: 11.0 };
    assert!(w.entities_in_area(SurfaceIndex(0), &edge).is_empty());
    assert_eq!(w.entity_on_tile(SurfaceIndex(0), -33, 10), Some(ha));
    w.destroy_entity(ha);
    assert_eq!(w.entity_on_tile(SurfaceIndex(0), -33, 10), None);
    assert_eq!(w.entities_in_area(SurfaceIndex(0), &across), vec![b]);
}
