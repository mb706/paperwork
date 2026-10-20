//! Worldgen's cross-engine fixtures (10 §5.18, §15.9; D12): for one world, the `gen_init` input, the world
//! hash, and the chunks, chart and preview native code generates, which test/sim-wasm/sim-wasm.test.ts asks
//! gen.wasm for and compares byte for byte. `UPDATE_WORLDGEN_FIXTURES=1` rewrites them; otherwise this test
//! fails when they are stale.
#![allow(clippy::disallowed_methods)] // the test reads and writes its fixtures

use schema::codec::{Fixed, Packed, Writer};
use schema::{ChartChunk, GenInitInput, MapSettings, NewWorld, Protos, SurfaceIndex, chunk_key};
use std::path::{Path, PathBuf};
use worldgen::Generator;

const CHUNKS: [(i32, i32); 7] =
    [(0, 0), (-1, -1), (1, 0), (5, -3), (40, -30), (-1000, 2000), (32_767, -32_768)];

fn dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/sim-wasm/worldgen")
}

fn files() -> Vec<(String, Vec<u8>)> {
    let bin = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/golden/m0/protos/prototypes.bin"),
    )
    .expect("protos");
    let world = NewWorld { seed: 1945, map: MapSettings::default(), ..NewWorld::default() };
    let mut init = Vec::new();
    GenInitInput { protos: &bin, world: world.clone() }.encode(&mut Writer::new(&mut init)).expect("encodes");
    let p = Protos::load(&bin).expect("loads");
    let hash = worldgen::world_hash(&bin, world.seed, &world.map, &world.world);
    let g = Generator::new(&p, world.seed, &world.map, &world.world, hash);
    // C2b-r1 finding 4: a world whose resource size is 1e30, which gen_init refuses.
    let mut unbounded = Vec::new();
    let wild = NewWorld {
        seed: 1945,
        map: MapSettings {
            resources: vec![schema::ResourceSettings {
                resource: schema::ResourceId(0),
                frequency: 1.0,
                size: 1e30,
                richness: 1.0,
            }],
            ..MapSettings::default()
        },
        ..NewWorld::default()
    };
    GenInitInput { protos: &bin, world: wild }.encode(&mut Writer::new(&mut unbounded)).expect("encodes");
    let mut out = vec![
        ("init.bin".to_owned(), init),
        ("init-unbounded.bin".to_owned(), unbounded),
        ("world-hash.txt".to_owned(), format!("{hash:016x}\n").into_bytes()),
    ];
    // The starting patch's chunks too (the patch lies near spawn).
    let mut chunks = CHUNKS.to_vec();
    for cy in -2..2 {
        for cx in -2..2 {
            if !g.chunk(SurfaceIndex(0), cx, cy).resources.is_empty() && !chunks.contains(&(cx, cy)) {
                chunks.push((cx, cy));
            }
        }
    }
    assert!(chunks.len() > CHUNKS.len(), "a starting patch near spawn");
    for (cx, cy) in chunks {
        let mut b = Vec::new();
        g.chunk(SurfaceIndex(0), cx, cy).encode(&mut Writer::new(&mut b)).expect("encodes");
        out.push((format!("chunk_{cx}_{cy}.bin"), b));
    }
    // The chart of chunk (0, 0): its tiles' map colours (genabi's gen_chart).
    let (theta, _) = g.climate(0, 0);
    let mut rgba = [0u8; 4096];
    for i in 0..1024 {
        let (t, _) = g.tile((i % 32) as i32, (i / 32) as i32, theta);
        let c = p.tile.map_color[usize::from(t.0)];
        rgba[4 * i..4 * i + 4].copy_from_slice(&[(c >> 16) as u8, (c >> 8) as u8, c as u8, 255]);
    }
    let mut b = Vec::new();
    ChartChunk { chunk_key: chunk_key(0, 0), surface: SurfaceIndex(0), version: 0, rgba }
        .write(&mut Writer::new(&mut b), "ChartChunk")
        .expect("encodes");
    out.push(("chart_0_0.bin".to_owned(), b));
    out
}

#[test]
fn the_wasm_fixtures_are_current() {
    let update = std::env::var("UPDATE_WORLDGEN_FIXTURES").is_ok_and(|v| v == "1");
    if update {
        std::fs::create_dir_all(dir()).expect("mkdir");
    }
    for (name, bytes) in files() {
        let p = dir().join(&name);
        if update {
            std::fs::write(&p, &bytes).expect("writes");
        } else {
            let got = std::fs::read(&p)
                .unwrap_or_else(|e| panic!("{}: {e} (UPDATE_WORLDGEN_FIXTURES=1)", p.display()));
            assert!(got == bytes, "{name} is stale (UPDATE_WORLDGEN_FIXTURES=1)");
        }
    }
}
