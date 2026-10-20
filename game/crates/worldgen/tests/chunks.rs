//! Worldgen v0's guarantees (10 §5.18, §15.9; D12): pure and order-independent chunks, a land starting area
//! with a starting patch of every solid resource, ore spots elsewhere, water by the water settings, the
//! out-of-map tile outside a bounded map. Run on the golden set's M0 prototypes.
#![allow(clippy::disallowed_methods, clippy::disallowed_macros)] // the test reads the prototypes and prints ranges

use schema::{MapSettings, Protos, ResourceSettings, SurfaceIndex, TileId, WorldSettings};
use worldgen::Generator;

fn protos_bin() -> Vec<u8> {
    std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../test/golden/m0/protos/prototypes.bin"))
        .expect("protos")
}

fn generator(seed: u32, map: &MapSettings) -> (Protos, Generator) {
    let bin = protos_bin();
    let p = Protos::load(&bin).expect("loads");
    let h = worldgen::world_hash(&bin, seed, map, &WorldSettings::default());
    let g = Generator::new(&p, seed, map, &WorldSettings::default(), h);
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

/// C2b-r1 finding 8: the starting iron patch is 01 §4's: about 600 tiles and 600,000 ore (±20%), on every
/// seed (the reviewed generator made about 115,000 on 156 tiles).
#[test]
fn the_starting_iron_patch_matches_the_opening() {
    let mut range = (u64::MAX, 0, u64::MAX, 0);
    for seed in 0..20u32 {
        let (p, g) = generator(seed.wrapping_mul(2_654_435_761), &MapSettings::default());
        let iron = schema::ResourceId(
            p.names.resource.iter().position(|n| n == "iron-ore-patch").expect("iron") as u16,
        );
        let (mut tiles, mut ore) = (0u64, 0u64);
        for cy in -3..3 {
            for cx in -3..3 {
                for r in g.chunk(SurfaceIndex(0), cx, cy).resources.iter().filter(|r| r.resource == iron) {
                    tiles += 1;
                    ore += u64::from(r.amount);
                }
            }
        }
        assert!((420..=780).contains(&tiles), "seed {seed}: {tiles} tiles");
        assert!((480_000..=720_000).contains(&ore), "seed {seed}: {ore} ore");
        range = (range.0.min(tiles), range.1.max(tiles), range.2.min(ore), range.3.max(ore));
    }
    eprintln!("starting iron over 20 seeds: {}–{} tiles, {}–{} ore", range.0, range.1, range.2, range.3);
}

/// C2b-r1 finding 4: the settings are bounded (01 §4: sliders 1/6× to 6×), and a generator given unchecked
/// settings clamps them, so a chunk's work stays bounded (the reviewed code searched an astronomical cell
/// range for a size of 1e30, and overflowed for larger ones).
#[test]
fn settings_are_bounded_and_generation_stays_bounded() {
    let bin = protos_bin();
    let p = Protos::load(&bin).expect("loads");
    let iron = schema::ResourceId(0);
    let wild = |size: f64, frequency: f64| MapSettings {
        resources: vec![ResourceSettings { resource: iron, frequency, size, richness: 1.0 }],
        ..MapSettings::default()
    };
    for (m, ok) in [
        (wild(1.0, 1.0), true),
        (wild(6.0, 6.0), true),
        (wild(0.0, 1.0), true),
        (wild(1e30, 1.0), false),
        (wild(1.0, 0.1), false),
        (wild(f64::INFINITY, 1.0), false),
        (MapSettings { water_scale: 7.0, ..MapSettings::default() }, false),
        (MapSettings { starting_area: -1.0, ..MapSettings::default() }, false),
    ] {
        assert_eq!(worldgen::check_settings(&m, &p).is_ok(), ok, "{m:?}");
    }
    let unknown = MapSettings {
        resources: vec![ResourceSettings {
            resource: schema::ResourceId(9),
            frequency: 1.0,
            size: 1.0,
            richness: 1.0,
        }],
        ..MapSettings::default()
    };
    assert!(worldgen::check_settings(&unknown, &p).is_err());
    // Unchecked: clamped to the bounds, so a far chunk takes milliseconds, not forever.
    for size in [1e30, f64::MAX, f64::INFINITY] {
        let g = Generator::new(&p, 1, &wild(size, 1e30), &WorldSettings::default(), 0);
        for (cx, cy) in [(0, 0), (30_000, -30_000), (-32_768, 32_767)] {
            let _ = g.chunk(SurfaceIndex(0), cx, cy);
        }
    }
}
