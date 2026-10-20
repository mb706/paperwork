//! A scale probe of the core (C2a), ignored by default: 10,000 chests with filled inventories on 25 × 25
//! modified chunks (the shape of §10.6's `m0-chests-10k`), timing the save, the load, the full state hash and
//! idle ticks (preflight, timers, d_t and one slice per tick). `simtool bench` (C2c) owns the real benchmarks;
//! this only shows where the core stands. Run it alone, pinned, in the ntest profile:
//! `taskset -c 0-7 cargo test --profile ntest -p sim --features simcheck --test scale -- --ignored --nocapture`.

use schema::{ChunkKey, Direction, EntityFlags, EntityId, ItemKey, Slot, SurfaceIndex, Tick, chunk_key};
use sim::r#gen::{Chunk, GeneratedChunk};
use sim::world::NewEntity;
use std::time::Instant;

#[test]
#[ignore = "a timing probe: run with --ignored --nocapture"]
fn ten_thousand_chests() {
    let mut c = crate::common::ctx();
    c.load(&crate::common::container_input(&crate::common::golden("start.save"))).expect("start.save");
    let w = c.world_mut().expect("a world");
    // 25 × 25 chunks east of the golden map (chunks 2 … 26), generated and modified, tile 0 everywhere.
    for cx in 2..27 {
        for cy in -12..13 {
            let key: ChunkKey = chunk_key(cx, cy);
            w.chunks
                .insert_generated(GeneratedChunk {
                    surface: SurfaceIndex(0),
                    key,
                    ..GeneratedChunk::default()
                })
                .expect("new");
            w.chunks
                .insert_modified(Chunk { surface: SurfaceIndex(0), key, ..Chunk::default() })
                .expect("generated");
        }
    }
    let t0 = Instant::now();
    for i in 0..10_000i32 {
        let (tx, ty) = (64 + (i % 100) * 7, -384 + (i / 100) * 7);
        let e = NewEntity {
            proto: EntityId(0),
            surface: 0,
            x2: 2 * tx + 1,
            y2: 2 * ty + 1,
            dir: Direction::North,
            flip: 0,
            quality: 0,
            built_by: 16,
            flags: EntityFlags::EMPTY,
            built_tick: Tick(0),
        };
        let (_, h) = w.create_entity(&e).expect("a chest");
        let inv = w.containers.inv[w.entities.pool_slot[sim::handle::slot(h) as usize] as usize];
        for (k, s) in w.heap.block_mut(inv).iter_mut().enumerate() {
            *s = Slot { key: ItemKey(((k % 3) as u16) << 3), count: 1 + (k as i32 % 50) };
        }
    }
    let build_ms = t0.elapsed().as_secs_f64() * 1e3;
    let t = Instant::now();
    let saved = c.checkpoint().expect("saves");
    let save_ms = t.elapsed().as_secs_f64() * 1e3;
    let t = Instant::now();
    let h = c.state_hashes().expect("hashes");
    let hash_ms = t.elapsed().as_secs_f64() * 1e3;
    let mut back = crate::common::ctx();
    let input = crate::common::state_input(&saved);
    let t = Instant::now();
    back.load(&input).expect("loads");
    let load_ms = t.elapsed().as_secs_f64() * 1e3;
    assert_eq!(back.state_hashes().expect("hashes").full, h.full);
    let mut ticks = Vec::with_capacity(3600);
    for _ in 0..3600 {
        let t = Instant::now();
        back.tick(&[]).expect("an idle tick");
        ticks.push(t.elapsed().as_secs_f64() * 1e3);
    }
    ticks.sort_by(f64::total_cmp);
    let mean = ticks.iter().sum::<f64>() / ticks.len() as f64;
    eprintln!(
        "10,000 chests: {} KiB saved; build {build_ms:.1} ms, save {save_ms:.1} ms, load {load_ms:.1} ms, full \
         state hash {hash_ms:.1} ms; idle tick mean {mean:.4} ms, p99 {:.4} ms, max {:.4} ms",
        saved.len() / 1024,
        ticks[ticks.len() * 99 / 100],
        ticks[ticks.len() - 1]
    );
}
