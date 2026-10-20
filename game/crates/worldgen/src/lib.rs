//! Pure chunk generation (10 §5.18): `generate_chunk(seed, settings, surface, cx, cy) → ChunkData`, as a
//! function of the seed, the map settings and the prototypes only. No World access and no I/O; the sim links
//! it for inline commits and the regeneration of pristine chunks, and `genabi` builds it into `gen.wasm` for
//! the worldgen pool (D12). Its output never depends on generation order or on where it ran.
//!
//! **Worldgen v0** (M0: "terrain, water, ore spots; no towns", §12). The stages of §5.18 that M0's
//! prototypes can show; every number below is a C2 decision (pm/reports/C2.md), raised with `VERSION`:
//! 1. **Climate** at the chunk centre (stage 1): θ = clamp(14 + y/80 + n, −15, 35) °C with n one octave of
//!    simplex noise at a 512-tile wavelength and ±3 K (stream `ambient`); sunlight clamp(1 + y/5,700, 0.6,
//!    1.3). The climate compass off gives θ = 14 °C and sunlight 1. (meta.heat.ambient is not in M0's
//!    prototypes, so §5.18's numbers are written here.)
//! 2. **Elevation** (stage 2): three octaves (384, 96 and 24 tiles × `water_scale`; weights 0.55, 0.3,
//!    0.15). Water lies below the level −0.12 + 0.3 × (`water_coverage` − 1), deep water 0.18 below that;
//!    `water_coverage` 0 makes no water. **The starting area is land**: within 48 × `starting_area` tiles of
//!    spawn the elevation is raised above the water level.
//! 3. **Tiles** (stage 3): biomes by θ (tundra < 0 ≤ boreal < 8 ≤ temperate < 20 ≤ steppe < 26 ≤ desert),
//!    blended ±2 K with tile noise (24 tiles); each biome draws from the tiles that name it, by moisture
//!    noise (64 tiles); a biome without tiles in the prototype set falls back to its neighbours. Land just
//!    above the water level is a beach of the first desert tile. Tiles outside the map are `out-of-map`.
//! 4. **Resources** (stage 5, and stage 10's starting patches), solid resources only: one starting patch per
//!    resource 30–40 tiles from spawn (radius 7 × √size, amount richness × 1,500 × falloff × (1 + 0.2 n));
//!    elsewhere one spot per 160-tile cell with probability 0.3 × frequency outside the starting area
//!    (radius (10–19) × √size, amount richness × 2,000 × (1 + d/512) × falloff × (1 + 0.2 n), d the spot's
//!    distance from spawn). Falloff is 1 − (r/R)². Earlier patches win: starting patches, then spots, each
//!    in ascending resource id and cell order. Resources lie only on walkable land.
//!
//! No trees, rocks, cliffs, decoratives or towns in v0 (M0's prototypes have none). The water, deep-water and
//! out-of-map tiles are found by name (`tiles.yaml` ids), the land tiles by their biomes.
#![forbid(unsafe_code)]

pub mod noise;

use det::xxh64::Xxh64;
use noise::{Simplex2, SplitMix64, mix64};
use schema::codec::Writer;
use schema::{
    Biomes, ChunkData, MapSettings, Protos, ResourceKind, ResourceTile, SurfaceIndex, TileId, chunk_key,
};

/// The worldgen version (§4.4: raised by hand whenever generation changes). GLOBALS records the version a
/// world was generated with; a save made under another version (or other worldgen data) is refused unless
/// it is baked.
pub const VERSION: u32 = 1;

/// Tiles per chunk side.
pub const CHUNK: i32 = 32;

/// The world hash (§15.9 `GenInitOutput`): XXH64 of the `u32` seed, the `map_settings` record as the
/// codec writes it, then `prototypes.bin`. The sim computes it at `sim_new_world` and `sim_load`; a worker's
/// answer carrying another world's hash is ignored.
pub fn world_hash(protos_bin: &[u8], seed: u32, map: &MapSettings) -> u64 {
    let mut h = Xxh64::new();
    h.u32(seed);
    let mut rec = Vec::new();
    // A record the decoder accepted re-encodes; a failure would be a codec bug, and hashes the empty record.
    let _ = map.encode(&mut Writer::new(&mut rec));
    h.write(&rec);
    h.write(protos_bin);
    h.digest()
}

/// A chunk's κ (golden README rule 5): the mean of its 1,024 tiles' `kappa_per_s` (0 for a tile without
/// one), summed in tile order.
pub fn chunk_kappa(protos: &Protos, tiles: &[TileId; 1024]) -> f64 {
    let t = &protos.tile;
    let mut sum = 0.0;
    for id in tiles {
        let i = usize::from(id.0);
        if t.has_kappa.get(i).copied().unwrap_or(false) {
            sum += t.kappa_per_s[i];
        }
    }
    sum / 1024.0
}

/// The noise streams, each with its own permutation table (§5.18: per-layer seed streams).
#[derive(Clone, Copy, Debug)]
#[repr(u64)]
enum Layer {
    Elevation0 = 1,
    Elevation1 = 2,
    Elevation2 = 3,
    Moisture = 4,
    TileBlend = 5,
    Ambient = 6,
    Richness = 7,
    Starting = 8,
    Spots = 9,
    Decor = 10,
}

/// The seed of a layer's stream, or of one cell of it.
fn layer_seed(seed: u32, layer: Layer, a: i64, b: i64) -> u64 {
    let mut z = mix64(u64::from(seed) ^ ((layer as u64) << 40));
    z = mix64(z ^ (a as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    mix64(z ^ (b as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F))
}

/// The biomes in θ order, for the fallback search.
const BIOMES: [Biomes; 5] =
    [Biomes::TUNDRA, Biomes::BOREAL, Biomes::TEMPERATE, Biomes::STEPPE, Biomes::DESERT];

/// One solid resource's generation parameters.
#[derive(Clone, Copy, Debug)]
struct ResourceRule {
    id: schema::ResourceId,
    frequency: f64,
    size: f64,
    richness: f64,
    /// The starting patch's centre.
    start: (f64, f64),
}

/// A spot or patch: centre, squared radius and base amount.
#[derive(Clone, Copy, Debug)]
struct Patch {
    resource: schema::ResourceId,
    x: f64,
    y: f64,
    r2: f64,
    base: f64,
}

/// The generator of one world: its settings, the prototype roles it uses and its noise tables. Built once
/// per world (`gen_init`, a new world or a load) and shared by every chunk.
#[derive(Clone, Debug)]
pub struct Generator {
    world_hash: u64,
    seed: u32,
    width: u32,
    height: u32,
    starting_radius: f64,
    water_scale: f64,
    water_level: Option<f64>,
    compass: bool,
    out_of_map: Option<TileId>,
    water: Option<TileId>,
    deep_water: Option<TileId>,
    beach: Option<TileId>,
    /// Per biome (θ order), the land tiles that name it after the fallback.
    land: [Vec<TileId>; 5],
    resources: Vec<ResourceRule>,
    elevation: [Simplex2; 3],
    moisture: Simplex2,
    blend: Simplex2,
    ambient: Simplex2,
    richness: Simplex2,
}

/// The spot cell size in tiles.
const CELL: i64 = 160;

impl Generator {
    /// The generator of the world with this seed and these settings (`climate_compass` from the world settings).
    pub fn new(
        protos: &Protos,
        seed: u32,
        map: &MapSettings,
        climate_compass: bool,
        world_hash: u64,
    ) -> Self {
        let names = &protos.names.tile;
        let named = |n: &str| names.iter().position(|x| x == n).map(|i| TileId(i as u8));
        let t = &protos.tile;
        let mut land: [Vec<TileId>; 5] = Default::default();
        for (b, list) in BIOMES.iter().zip(land.iter_mut()) {
            for i in 0..t.len() {
                if t.walkable[i] && t.buildable[i] && !t.town[i] && t.biomes[i].contains(*b) {
                    list.push(TileId(i as u8));
                }
            }
        }
        // A biome without tiles takes its nearest neighbour's (ties: the cooler one), else any land tile.
        let fallback: Vec<TileId> = (0..t.len())
            .filter(|&i| t.walkable[i] && t.buildable[i] && !t.town[i])
            .map(|i| TileId(i as u8))
            .collect();
        let found = land.clone();
        for (k, list) in land.iter_mut().enumerate() {
            if !list.is_empty() {
                continue;
            }
            let near = (1..5).find_map(|d| {
                let lo = k.checked_sub(d).map(|j| &found[j]).filter(|l| !l.is_empty());
                let hi = found.get(k + d).filter(|l| !l.is_empty());
                lo.or(hi)
            });
            *list = near.cloned().unwrap_or_else(|| fallback.clone());
        }
        let beach = found[4].first().copied();
        let mut resources = Vec::new();
        let r = &protos.resource;
        for i in 0..r.len() {
            if r.kind[i] != ResourceKind::Solid {
                continue;
            }
            let id = schema::ResourceId(i as u16);
            let s = map.resources.iter().find(|s| s.resource == id);
            let (frequency, size, richness) =
                s.map_or((1.0, 1.0, 1.0), |s| (s.frequency, s.size, s.richness));
            let h = layer_seed(seed, Layer::Starting, i as i64, 0);
            let dir = ((h % 8) + 3 * resources.len() as u64) % 8;
            let dist = 30.0 + ((h >> 8) % 11) as f64;
            let (ux, uy) = UNIT[dir as usize];
            let start = ((dist * ux).floor(), (dist * uy).floor());
            resources.push(ResourceRule { id, frequency, size, richness, start });
        }
        let pos = |v: f64| if v > 0.0 && v.is_finite() { v } else { 0.0 };
        let coverage = pos(map.water_coverage);
        let level = -0.12 + 0.3 * (coverage - 1.0);
        Self {
            world_hash,
            seed,
            width: map.width,
            height: map.height,
            starting_radius: 48.0 * pos(map.starting_area),
            water_scale: if pos(map.water_scale) > 0.0 { map.water_scale } else { 1.0 },
            water_level: (coverage > 0.0).then_some(if level > 0.6 { 0.6 } else { level }),
            compass: climate_compass,
            out_of_map: named("out-of-map"),
            water: named("water"),
            deep_water: named("deep-water"),
            beach,
            land,
            resources,
            elevation: [
                Simplex2::from_seed(layer_seed(seed, Layer::Elevation0, 0, 0)),
                Simplex2::from_seed(layer_seed(seed, Layer::Elevation1, 0, 0)),
                Simplex2::from_seed(layer_seed(seed, Layer::Elevation2, 0, 0)),
            ],
            moisture: Simplex2::from_seed(layer_seed(seed, Layer::Moisture, 0, 0)),
            blend: Simplex2::from_seed(layer_seed(seed, Layer::TileBlend, 0, 0)),
            ambient: Simplex2::from_seed(layer_seed(seed, Layer::Ambient, 0, 0)),
            richness: Simplex2::from_seed(layer_seed(seed, Layer::Richness, 0, 0)),
        }
    }

    pub fn world_hash(&self) -> u64 {
        self.world_hash
    }

    /// Whether tile `(tx, ty)` lies inside the map (golden README rule 1: a centred map, 0 = unbounded).
    fn in_map(&self, tx: i32, ty: i32) -> bool {
        let inside = |v: i32, size: u32| {
            if size == 0 {
                return true;
            }
            let lo = -i64::from(size / 2);
            (lo..lo + i64::from(size)).contains(&i64::from(v))
        };
        inside(tx, self.width) && inside(ty, self.height)
    }

    /// The climate at a chunk's centre (stage 1): θ in °C and sunlight.
    pub fn climate(&self, cx: i32, cy: i32) -> (f64, f64) {
        if !self.compass {
            return (14.0, 1.0);
        }
        let (x, y) = (f64::from(cx) * 32.0 + 16.0, f64::from(cy) * 32.0 + 16.0);
        let n = 3.0 * self.ambient.noise(x / 512.0, y / 512.0);
        (clamp(14.0 + y / 80.0 + n, -15.0, 35.0), clamp(1.0 + y / 5_700.0, 0.6, 1.3))
    }

    /// The elevation at a tile centre (stage 2), with the starting area raised above the water level.
    fn elevation(&self, x: f64, y: f64) -> f64 {
        let (sx, sy) = (x / self.water_scale, y / self.water_scale);
        let [a, b, c] = &self.elevation;
        let mut e = 0.55 * a.noise(sx / 384.0, sy / 384.0)
            + 0.3 * b.noise(sx / 96.0, sy / 96.0)
            + 0.15 * c.noise(sx / 24.0, sy / 24.0);
        if let Some(level) = self.water_level {
            let r = self.starting_radius;
            let d2 = x * x + y * y;
            if r > 0.0 && d2 < 4.0 * r * r {
                // A cone 0.6 high at spawn over twice the radius, and land inside the radius.
                let d = d2.sqrt();
                e += 0.6 * (1.0 - d / (2.0 * r));
                if d < r && e < level + 0.1 {
                    e = level + 0.1;
                }
            }
        }
        e
    }

    /// The patches that can reach chunk `(cx, cy)`: starting patches, then spots, in priority order.
    fn patches(&self, cx: i32, cy: i32, out: &mut Vec<Patch>) {
        out.clear();
        for r in &self.resources {
            if r.size > 0.0 && r.richness > 0.0 {
                let r2 = 49.0 * r.size;
                out.push(Patch { resource: r.id, x: r.start.0, y: r.start.1, r2, base: 1500.0 * r.richness });
            }
        }
        let (x0, y0) = (i64::from(cx) * 32, i64::from(cy) * 32);
        // A spot's centre lies 24–135 tiles into its cell and its radius is under 19 × √size tiles.
        for (k, r) in self.resources.iter().enumerate() {
            if !(r.size > 0.0 && r.richness > 0.0 && r.frequency > 0.0) {
                continue;
            }
            let reach = (19.0 * r.size.sqrt()).ceil() as i64 + 1;
            let (rx0, rx1) = ((x0 - reach).div_euclid(CELL), (x0 + 32 + reach).div_euclid(CELL));
            let (ry0, ry1) = ((y0 - reach).div_euclid(CELL), (y0 + 32 + reach).div_euclid(CELL));
            for ry in ry0..=ry1 {
                for rx in rx0..=rx1 {
                    let h = layer_seed(self.seed, Layer::Spots, rx, ry) ^ mix64(k as u64 + 1);
                    let h = mix64(h);
                    let u = (h & 0xFF_FFFF) as f64 / 16_777_216.0;
                    if u >= 0.3 * r.frequency {
                        continue;
                    }
                    let x = (rx * CELL + 24 + ((h >> 24) % 112) as i64) as f64;
                    let y = (ry * CELL + 24 + ((h >> 36) % 112) as i64) as f64;
                    // The starting area is the starting patches'.
                    let keep = 2.0 * self.starting_radius + 64.0;
                    if x * x + y * y < keep * keep {
                        continue;
                    }
                    let radius = (10 + (h >> 48) % 10) as f64;
                    let base = 2000.0 * (1.0 + (x * x + y * y).sqrt() / 512.0) * r.richness;
                    out.push(Patch { resource: r.id, x, y, r2: radius * radius * r.size, base });
                }
            }
        }
    }

    /// Generates chunk `(cx, cy)` of `surface` (§5.18, §15.9): the sim's inline generation and the workers'
    /// answer are this record.
    pub fn chunk(&self, surface: SurfaceIndex, cx: i32, cy: i32) -> ChunkData {
        let (theta, sunlight) = self.climate(cx, cy);
        let mut tiles = [TileId(0); 1024];
        let mut resources = Vec::new();
        let mut patches = Vec::new();
        self.patches(cx, cy, &mut patches);
        let fallback = self.land.iter().find_map(|l| l.first().copied()).unwrap_or(TileId(0));
        for ly in 0..CHUNK {
            for lx in 0..CHUNK {
                let (tx, ty) = (cx * CHUNK + lx, cy * CHUNK + ly);
                let i = (ly * CHUNK + lx) as usize;
                if !self.in_map(tx, ty) {
                    tiles[i] = self.out_of_map.unwrap_or(fallback);
                    continue;
                }
                let (x, y) = (f64::from(tx) + 0.5, f64::from(ty) + 0.5);
                let e = self.elevation(x, y);
                if let Some(level) = self.water_level {
                    if e < level - 0.18
                        && let Some(d) = self.deep_water.or(self.water)
                    {
                        tiles[i] = d;
                        continue;
                    }
                    if e < level
                        && let Some(w) = self.water
                    {
                        tiles[i] = w;
                        continue;
                    }
                }
                let t = theta + 2.0 * self.blend.noise(x / 24.0, y / 24.0);
                let biome = if t < 0.0 {
                    0
                } else if t < 8.0 {
                    1
                } else if t < 20.0 {
                    2
                } else if t < 26.0 {
                    3
                } else {
                    4
                };
                let beach = self.water_level.is_some_and(|l| e < l + 0.025);
                tiles[i] = match (beach, self.beach) {
                    (true, Some(b)) => b,
                    _ => {
                        let list = &self.land[biome];
                        if list.is_empty() {
                            fallback
                        } else {
                            let m = (self.moisture.noise(x / 64.0, y / 64.0) + 1.0) / 2.0;
                            let k = (m * list.len() as f64).floor();
                            let k = if k < 0.0 { 0 } else { (k as usize).min(list.len() - 1) };
                            list[k]
                        }
                    }
                };
                // Resources on land only: the first patch that covers the tile.
                for p in &patches {
                    let (dx, dy) = (x - p.x, y - p.y);
                    let d2 = dx * dx + dy * dy;
                    if d2 >= p.r2 {
                        continue;
                    }
                    let n = self.richness.noise(x / 8.0, y / 8.0);
                    let amount = (p.base * (1.0 - d2 / p.r2) * (1.0 + 0.2 * n)).floor();
                    if amount >= 1.0 {
                        let a = if amount > 4.0e9 { 4_000_000_000 } else { amount as u32 };
                        resources.push(ResourceTile { tile: i as u16, resource: p.resource, amount: a });
                    }
                    break;
                }
            }
        }
        ChunkData {
            world_hash: self.world_hash,
            surface,
            key: chunk_key(cx, cy),
            tiles,
            theta,
            sunlight,
            resources,
            trees: Vec::new(),
            objects: Vec::new(),
            cliffs: Vec::new(),
            town_features: Vec::new(),
            decor_seed: layer_seed(self.seed, Layer::Decor, i64::from(cx), i64::from(cy)) as u32,
        }
    }

    /// The deterministic stream of a chunk's own draws (decoratives and later stages), for callers that need one.
    pub fn chunk_stream(&self, cx: i32, cy: i32) -> SplitMix64 {
        SplitMix64(layer_seed(self.seed, Layer::Decor, i64::from(cx), i64::from(cy)))
    }
}

/// Unit vectors of the 8 compass directions, north first, y pointing south.
const S: f64 = std::f64::consts::FRAC_1_SQRT_2;
const UNIT: [(f64, f64); 8] =
    [(0.0, -1.0), (S, -S), (1.0, 0.0), (S, S), (0.0, 1.0), (-S, S), (-1.0, 0.0), (-S, -S)];

/// `v` clamped to `[lo, hi]`, with comparisons (§4.1: no `clamp`).
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}
