//! Worldgen v0's guarantees (10 §5.18, §15.9; D12): pure and order-independent chunks, a land starting area
//! with a starting patch of every solid resource, ore spots elsewhere, water by the water settings, the
//! out-of-map tile outside a bounded map. Run on the golden set's M0 prototypes.
#![allow(clippy::disallowed_methods)] // the test reads the prototypes

use schema::{MapSettings, Protos, ResourceSettings, SurfaceIndex, TileId};
use worldgen::Generator;

fn protos_bin() -> Vec<u8> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../test/golden/m0/protos/prototypes.bin"))
        .expect("protos")
}

fn generator(seed: u32, map: &MapSettings) -> (Protos, Generator) {
    let bin = protos_bin();
    let p = Protos::load(&bin).expect("loads");
    let h = worldgen::world_hash(&bin, seed, map);
    let g = Generator::new(&p, seed, map, true, h);
    (p, g)
}

fn tile_named(p: &Protos, name: &str) -> TileId {
    TileId(p.names.tile.iter().position(|n| n == name).expect(name) as u8)
}

#[test]
fn chunks_are_pure_and_independent_of_order() {
    let (_, g) = generator(1945, &MapSettings::default());
    let a: Vec<_> = (-2..=2).flat_map(|cy| (-2..=2).map(move |cx| (cx, cy))).collect();
    let first: Vec<_> = a.iter().map(|&(cx, cy)| g.chunk(SurfaceIndex(0), cx, cy)).collect();
    let (_, g2) = generator(1945, &MapSettings::default());
    for (i, &(cx, cy)) in a.iter().enumerate().rev() {
        assert_eq!(g2.chunk(SurfaceIndex(0), cx, cy), first[i], "chunk ({cx}, {cy})");
    }
    let (_, other) = generator(1946, &MapSettings::default());
    assert_ne!(other.chunk(SurfaceIndex(0), 3, 3).tiles, first[24].tiles, "another seed, another map");
    assert_ne!(g.world_hash(), other.world_hash());
}

#[test]
fn the_starting_area_is_land_with_a_starting_patch() {
    for seed in [1, 7, 1945, 0xDEAD_BEEF] {
        let (p, g) = generator(seed, &MapSettings::default());
        let water = [tile_named(&p, "water"), tile_named(&p, "deep-water")];
        let mut ore = 0u64;
        for cy in -2..2 {
            for cx in -2..2 {
                let c = g.chunk(SurfaceIndex(0), cx, cy);
                for (i, t) in c.tiles.iter().enumerate() {
                    let (tx, ty) = (cx * 32 + (i % 32) as i32, cy * 32 + (i / 32) as i32);
                    let (x, y) = (f64::from(tx) + 0.5, f64::from(ty) + 0.5);
                    if x * x + y * y < 48.0 * 48.0 {
                        assert!(
                            !water.contains(t),
                            "seed {seed}: water at ({tx}, {ty}) in the starting area"
                        );
                    }
                }
                ore += c.resources.iter().map(|r| u64::from(r.amount)).sum::<u64>();
            }
        }
        assert!(ore > 50_000, "seed {seed}: the starting patch holds {ore} ore");
    }
}

#[test]
fn spots_water_and_the_map_edge() {
    let (p, g) = generator(1945, &MapSettings::default());
    let (water, oom) = (tile_named(&p, "water"), tile_named(&p, "out-of-map"));
    let (mut spots, mut wet) = (0, 0);
    for cy in -40..-20 {
        for cx in 20..40 {
            let c = g.chunk(SurfaceIndex(0), cx, cy);
            spots += usize::from(!c.resources.is_empty());
            wet += c.tiles.iter().filter(|&&t| t == water).count();
            assert!(c.resources.windows(2).all(|w| w[0].tile < w[1].tile), "resources ascend by tile");
        }
    }
    assert!(spots > 12, "ore spots away from spawn: {spots} chunks");
    assert!(wet > 1000, "lakes: {wet} water tiles");
    // No water at all with water coverage 0.
    let dry = MapSettings { water_coverage: 0.0, ..MapSettings::default() };
    let (_, g) = generator(1945, &dry);
    for cy in -40..-30 {
        for cx in 20..30 {
            assert!(!g.chunk(SurfaceIndex(0), cx, cy).tiles.contains(&water));
        }
    }
    // A 96 × 96 map: x in [−48, 48).
    let small = MapSettings { width: 96, height: 96, ..MapSettings::default() };
    let (_, g) = generator(1945, &small);
    assert!(g.chunk(SurfaceIndex(0), 2, 0).tiles.iter().all(|&t| t == oom));
    let edge = g.chunk(SurfaceIndex(0), 1, 0);
    for (i, &t) in edge.tiles.iter().enumerate() {
        assert_eq!(t == oom, 32 + (i % 32) >= 48, "tile {i} of chunk (1, 0)");
    }
    assert!(edge.resources.iter().all(|r| 32 + usize::from(r.tile % 32) < 48));
}

#[test]
fn resource_settings_scale_the_patches() {
    let (p, base) = generator(1945, &MapSettings::default());
    let iron =
        schema::ResourceId(p.names.resource.iter().position(|n| n == "iron-ore-patch").expect("iron") as u16);
    let none = MapSettings {
        resources: vec![ResourceSettings { resource: iron, frequency: 1.0, size: 0.0, richness: 1.0 }],
        ..MapSettings::default()
    };
    let (_, g) = generator(1945, &none);
    let total = |g: &Generator| -> u64 {
        (-2..2)
            .flat_map(|cy| (-2..2).map(move |cx| (cx, cy)))
            .map(|(cx, cy)| {
                g.chunk(SurfaceIndex(0), cx, cy).resources.iter().map(|r| u64::from(r.amount)).sum::<u64>()
            })
            .sum()
    };
    assert_eq!(total(&g), 0, "size 0: no patch");
    let rich = MapSettings {
        resources: vec![ResourceSettings { resource: iron, frequency: 1.0, size: 1.0, richness: 2.0 }],
        ..MapSettings::default()
    };
    let (_, g) = generator(1945, &rich);
    let (a, b) = (total(&base), total(&g));
    assert!(b > a + a / 2, "richness 2: {b} against {a}");
}
