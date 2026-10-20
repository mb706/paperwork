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
//!    `water_coverage` 0 makes no water. **The starting area is land**: within 56 × `starting_area` tiles of
//!    spawn (the starting patches included) the elevation is raised above the water level.
//! 3. **Tiles** (stage 3): biomes by θ (tundra < 0 ≤ boreal < 8 ≤ temperate < 20 ≤ steppe < 26 ≤ desert),
//!    blended ±2 K with tile noise (24 tiles); each biome draws from the tiles that name it, by moisture
//!    noise (64 and 16 tiles, weights 0.7 and 0.3); a biome without tiles in the prototype set falls back to its neighbours. Land just
//!    above the water level is a beach of the first desert tile. Tiles outside the map are `out-of-map`.
//! 4. **Resources** (stage 5, and stage 10's starting patches), solid resources only, by 01 §4's parametric
//!    model (its table, by resource id; a resource it does not list takes iron's row):
//!    - one **starting patch** per resource: a blob of `tiles` (iron ≈ 600) at radius √(tiles/π) × size with
//!      ±30% edge noise, a₀ × richness per tile (iron 1,000: 600,000 ± 20% in all), centred 1.3 R + 3–10 tiles
//!      from spawn so that its nearest tile is at least 3 from spawn, in a seeded direction (each resource 3/8
//!      of a turn from the last);
//!    - **regular patches** on a jittered grid of cells c / √frequency (iron 224 tiles), each holding a patch
//!      with probability min(p × frequency, 1) (iron 0.90), centred in the cell's middle 60%, radius
//!      r₀ × size × √(1 + d / 1,500) with ±30% edge noise, a₀ × richness × (1 + d / 800) per tile, d the
//!      patch centre's distance from spawn; none centred within 128 × `starting_area` tiles of spawn (the
//!      starting patches' area) or within a resource's `not within` distance (uranium 512).
//!
//!    Tiles vary ±10% around their patch's amount. Earlier patches win: starting patches, then regular
//!    patches, each in ascending resource id and cell order. Resources lie only on walkable land.
//!
//! **Bounds** ([`check_settings`]): every multiplier is finite and in [0, 6]; a resource slider is 0 (none) or
//! in [1/6, 6] (01 §4: "each ranges from 1/6× to 6×"). The sim refuses other settings at `sim_new_world` and
//! `sim_load`, and gen.wasm at `gen_init`, so a chunk's work is bounded.
//!
//! **Identity** ([`world_hash`]): XXH64 of `VERSION`, the seed, the `map_settings` and `world_settings` records
//! and `prototypes.bin`: everything a chunk depends on.
//!
//! No trees, rocks, cliffs, decoratives or towns in v0 (M0's prototypes have none). The water, deep-water and
//! out-of-map tiles are found by name (`tiles.yaml` ids), the land tiles by their biomes.
#![forbid(unsafe_code)]

pub mod noise;

use det::xxh64::Xxh64;
use noise::{Simplex2, SplitMix64, mix64};
use schema::codec::Writer;
use schema::{
    Biomes, ChunkData, MapSettings, Protos, ResourceKind, ResourceTile, SurfaceIndex, TileId, WorldSettings,
    chunk_key,
};

/// The worldgen version (§4.4: raised by hand whenever generation changes). GLOBALS records the version a
/// world was generated with; a save made under another version (or other worldgen data) is refused unless
/// it is baked.
pub const VERSION: u32 = 1;

/// Tiles per chunk side.
pub const CHUNK: i32 = 32;

/// The world hash (§15.9 `GenInitOutput`): XXH64 of `u32 VERSION`, `u32 seed`, the `map_settings` record and
/// the `world_settings` record as the codec writes them, then `prototypes.bin` — every input a chunk depends on
/// (the climate compass is a world setting; game settings change at runtime and never reach worldgen). The
/// sim computes it at `sim_new_world` and `sim_load`; a worker's answer carrying another world's hash is
/// ignored (C2b-r1 finding 1).
pub fn world_hash(protos_bin: &[u8], seed: u32, map: &MapSettings, world: &WorldSettings) -> u64 {
    let mut h = Xxh64::new();
    h.u32(VERSION);
    h.u32(seed);
    let mut rec = Vec::new();
    // A record the decoder accepted re-encodes; a failure would be a codec bug, and hashes the empty record.
    let _ = map.encode(&mut Writer::new(&mut rec));
    h.write(&rec);
    rec.clear();
    let _ = world.encode(&mut Writer::new(&mut rec));
    h.write(&rec);
    h.write(protos_bin);
    h.digest()
}

/// The largest multiplier a setting may have (01 §4: sliders range 1/6× to 6×).
pub const SETTING_MAX: f64 = 6.0;
/// The smallest nonzero resource slider.
pub const SLIDER_MIN: f64 = 1.0 / 6.0;

/// Whether a world's map settings bound generation (C2b-r1 finding 4): every multiplier finite and in
/// [0, 6]; each resource entry names a resource of these prototypes, its sliders 0 (none) or in [1/6, 6].
pub fn check_settings(map: &MapSettings, protos: &Protos) -> Result<(), String> {
    let multipliers = [
        ("starting_area", map.starting_area),
        ("water_scale", map.water_scale),
        ("water_coverage", map.water_coverage),
        ("trees_frequency", map.trees_frequency),
        ("trees_size", map.trees_size),
        ("cliffs_frequency", map.cliffs_frequency),
        ("cliffs_continuity", map.cliffs_continuity),
        ("towns_frequency", map.towns_frequency),
        ("towns_size", map.towns_size),
        ("archives_size", map.archives_size),
        ("archives_richness", map.archives_richness),
        ("exchanges_richness", map.exchanges_richness),
    ];
    for (name, v) in multipliers {
        if !(v.is_finite() && (0.0..=SETTING_MAX).contains(&v)) {
            return Err(format!("map setting {name} = {v}: a multiplier in [0, 6]"));
        }
    }
    for r in &map.resources {
        if usize::from(r.resource.0) >= protos.resource.len() {
            return Err(format!(
                "resource settings for resource {}, which the prototypes lack",
                r.resource.0
            ));
        }
        for (name, v) in [("frequency", r.frequency), ("size", r.size), ("richness", r.richness)] {
            if !(v == 0.0 || (v.is_finite() && (SLIDER_MIN..=SETTING_MAX).contains(&v))) {
                return Err(format!("resource {} {name} = {v}: 0 or in [1/6, 6]", r.resource.0));
            }
        }
    }
    Ok(())
}

/// 01 §4's resource table: per resource id, the regular grid (cell c, probability p, radius r₀, amount a₀,
/// not within d), and the starting patch (amount, tiles); `None` for a resource without a starting patch.
struct ResourceRow {
    name: &'static str,
    cell: f64,
    p: f64,
    r0: f64,
    a0: f64,
    not_within: f64,
    start_tiles: Option<f64>,
}

const RESOURCE_TABLE: [ResourceRow; 5] = [
    ResourceRow {
        name: "iron-ore-patch",
        cell: 224.0,
        p: 0.90,
        r0: 14.0,
        a0: 1000.0,
        not_within: 0.0,
        start_tiles: Some(600.0),
    },
    ResourceRow {
        name: "copper-ore-patch",
        cell: 240.0,
        p: 0.85,
        r0: 13.0,
        a0: 1000.0,
        not_within: 0.0,
        start_tiles: Some(500.0),
    },
    ResourceRow {
        name: "coal-patch",
        cell: 256.0,
        p: 0.80,
        r0: 12.0,
        a0: 800.0,
        not_within: 0.0,
        start_tiles: Some(500.0),
    },
    ResourceRow {
        name: "quartz-patch",
        cell: 288.0,
        p: 0.70,
        r0: 10.0,
        a0: 600.0,
        not_within: 0.0,
        start_tiles: Some(500.0),
    },
    ResourceRow {
        name: "uranium-ore-patch",
        cell: 640.0,
        p: 0.35,
        r0: 8.0,
        a0: 400.0,
        not_within: 512.0,
        start_tiles: None,
    },
];

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
    Edge = 11,
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

/// One solid resource's generation parameters (01 §4's row and the world's sliders).
#[derive(Clone, Copy, Debug)]
struct ResourceRule {
    id: schema::ResourceId,
    /// The regular grid: cell size (frequency applied), probability (frequency applied), radius r₀ × size,
    /// amount a₀ × richness, no patch centred within this distance of spawn.
    cell: f64,
    p: f64,
    r0: f64,
    a0: f64,
    not_within: f64,
    /// The starting patch: centre, radius and amount per tile; `None` without one.
    start: Option<(f64, f64, f64, f64)>,
}

/// A patch: centre, radius (before edge noise) and amount per tile.
#[derive(Clone, Copy, Debug)]
struct Patch {
    resource: schema::ResourceId,
    x: f64,
    y: f64,
    r: f64,
    amount: f64,
}

/// A patch's edge noise: its radius varies ±30% along the edge (01 §4).
const EDGE: f64 = 0.3;

/// The generator of one world: its settings, the prototype roles it uses and its noise tables. Built once
/// per world (`gen_init`, a new world or a load) and shared by every chunk.
#[derive(Clone, Debug)]
pub struct Generator {
    world_hash: u64,
    seed: u32,
    width: u32,
    height: u32,
    starting_radius: f64,
    /// No regular patch is centred within this distance of spawn.
    exclusion: f64,
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
    edge: Simplex2,
}

impl Generator {
    /// The generator of the world with this seed and these settings (`climate_compass` from the world settings).
    /// The generator of a world. Settings outside [`check_settings`]' bounds are clamped into them, so a
    /// chunk's work stays bounded even for a caller that skipped the check.
    pub fn new(
        protos: &Protos,
        seed: u32,
        map: &MapSettings,
        world: &WorldSettings,
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
        // A setting as generation reads it: finite, in [0, 6].
        let bounded = |v: f64| {
            if v.is_finite() && v > 0.0 { if v > SETTING_MAX { SETTING_MAX } else { v } } else { 0.0 }
        };
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
            let (frequency, size, richness) = (bounded(frequency), bounded(size), bounded(richness));
            let name = protos.names.resource.get(i).map_or("", String::as_str);
            let row = RESOURCE_TABLE.iter().find(|x| x.name == name).unwrap_or(&RESOURCE_TABLE[0]);
            let start = row.start_tiles.filter(|_| size > 0.0 && richness > 0.0).map(|tiles| {
                // The blob's radius, and a centre that keeps its edge (at most 1.3 R) 3 tiles from spawn.
                let radius = (tiles / std::f64::consts::PI).sqrt() * size;
                let h = layer_seed(seed, Layer::Starting, i as i64, 0);
                let dir = ((h % 8) + 3 * resources.len() as u64) % 8;
                let dist = (1.0 + EDGE) * radius + 3.0 + ((h >> 8) % 8) as f64;
                let (ux, uy) = UNIT[dir as usize];
                ((dist * ux).floor(), (dist * uy).floor(), radius, row.a0 * richness)
            });
            let on = frequency > 0.0 && size > 0.0 && richness > 0.0;
            resources.push(ResourceRule {
                id,
                cell: if on { row.cell / frequency.sqrt() } else { 0.0 },
                p: if on {
                    let p = row.p * frequency;
                    if p > 1.0 { 1.0 } else { p }
                } else {
                    0.0
                },
                r0: row.r0 * size,
                a0: row.a0 * richness,
                not_within: row.not_within,
                start,
            });
        }
        let coverage = bounded(map.water_coverage);
        let level = -0.12 + 0.3 * (coverage - 1.0);
        let starting_area = bounded(map.starting_area);
        Self {
            world_hash,
            seed,
            width: map.width,
            height: map.height,
            starting_radius: 56.0 * starting_area,
            exclusion: 128.0 * starting_area,
            water_scale: if bounded(map.water_scale) > 0.0 { bounded(map.water_scale) } else { 1.0 },
            water_level: (coverage > 0.0).then_some(if level > 0.6 { 0.6 } else { level }),
            compass: world.climate_compass,
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
            edge: Simplex2::from_seed(layer_seed(seed, Layer::Edge, 0, 0)),
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

    /// The patches that can reach chunk `(cx, cy)`: starting patches, then regular patches, in priority order.
    /// The cell search is bounded: radii grow with the distance from spawn, which the chunk-key range bounds
    /// (±2²⁰ tiles), and every quantity is computed in `i64` or bounded floats.
    fn patches(&self, cx: i32, cy: i32, out: &mut Vec<Patch>) {
        out.clear();
        let (x0, y0) = (f64::from(cx) * 32.0, f64::from(cy) * 32.0);
        // Whether a patch's disc (with its edge noise) can touch the chunk.
        let touches = |px: f64, py: f64, r: f64| {
            let reach = (1.0 + EDGE) * r + 1.0;
            px + reach > x0 && px - reach < x0 + 32.0 && py + reach > y0 && py - reach < y0 + 32.0
        };
        for rule in &self.resources {
            if let Some((x, y, r, amount)) = rule.start
                && touches(x, y, r)
            {
                out.push(Patch { resource: rule.id, x, y, r, amount });
            }
        }
        // The farthest a chunk tile lies from spawn bounds every radius that can reach it.
        let far = (x0.abs() + 32.0) * (x0.abs() + 32.0) + (y0.abs() + 32.0) * (y0.abs() + 32.0);
        for (k, rule) in self.resources.iter().enumerate() {
            if rule.p <= 0.0 || rule.cell < 1.0 {
                continue;
            }
            let r_max = rule.r0 * (1.0 + (far.sqrt() + 2.0 * rule.cell) / 1500.0).sqrt();
            let reach = ((1.0 + EDGE) * r_max + 1.0).ceil() as i64;
            let cell = rule.cell;
            let lo = |v: f64| ((v - reach as f64) / cell).floor() as i64;
            let hi = |v: f64| ((v + 32.0 + reach as f64) / cell).floor() as i64;
            for ry in lo(y0)..=hi(y0) {
                for rx in lo(x0)..=hi(x0) {
                    let h = mix64(layer_seed(self.seed, Layer::Spots, rx, ry) ^ mix64(k as u64 + 1));
                    let u = (h & 0xFF_FFFF) as f64 / 16_777_216.0;
                    if u >= rule.p {
                        continue;
                    }
                    // Centred in the cell's middle 60%.
                    let fx = ((h >> 24) & 0xFFFF) as f64 / 65_536.0;
                    let fy = ((h >> 40) & 0xFFFF) as f64 / 65_536.0;
                    let x = (rx as f64 + 0.2 + 0.6 * fx) * cell;
                    let y = (ry as f64 + 0.2 + 0.6 * fy) * cell;
                    let d = (x * x + y * y).sqrt();
                    if d < self.exclusion || d < rule.not_within {
                        continue;
                    }
                    let r = rule.r0 * (1.0 + d / 1500.0).sqrt();
                    if touches(x, y, r) {
                        out.push(Patch { resource: rule.id, x, y, r, amount: rule.a0 * (1.0 + d / 800.0) });
                    }
                }
            }
        }
    }

    /// The tile at `(tx, ty)` of a chunk whose climate is `theta` (stages 2–3), and whether it is land.
    pub fn tile(&self, tx: i32, ty: i32, theta: f64) -> (TileId, bool) {
        let fallback = self.land.iter().find_map(|l| l.first().copied()).unwrap_or(TileId(0));
        if !self.in_map(tx, ty) {
            return (self.out_of_map.unwrap_or(fallback), false);
        }
        let (x, y) = (f64::from(tx) + 0.5, f64::from(ty) + 0.5);
        let e = self.elevation(x, y);
        if let Some(level) = self.water_level {
            if e < level - 0.18
                && let Some(d) = self.deep_water.or(self.water)
            {
                return (d, false);
            }
            if e < level
                && let Some(w) = self.water
            {
                return (w, false);
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
        if self.water_level.is_some_and(|l| e < l + 0.025)
            && let Some(b) = self.beach
        {
            return (b, true);
        }
        let list = &self.land[biome];
        if list.is_empty() {
            return (fallback, true);
        }
        // Two octaves, so that the boundary between a biome's tiles is not one octave's zero line.
        let n = 0.7 * self.moisture.noise(x / 64.0, y / 64.0)
            + 0.3 * self.moisture.noise(x / 16.0 + 101.5, y / 16.0 - 37.25);
        let m = (n + 1.0) / 2.0;
        let k = (m * list.len() as f64).floor();
        let k = if k < 0.0 { 0 } else { (k as usize).min(list.len() - 1) };
        (list[k], true)
    }

    /// Generates chunk `(cx, cy)` of `surface` (§5.18, §15.9): the sim's inline generation and the workers'
    /// answer are this record.
    pub fn chunk(&self, surface: SurfaceIndex, cx: i32, cy: i32) -> ChunkData {
        let (theta, sunlight) = self.climate(cx, cy);
        let mut tiles = [TileId(0); 1024];
        let mut resources = Vec::new();
        let mut patches = Vec::new();
        self.patches(cx, cy, &mut patches);
        for ly in 0..CHUNK {
            for lx in 0..CHUNK {
                let (tx, ty) = (cx * CHUNK + lx, cy * CHUNK + ly);
                let i = (ly * CHUNK + lx) as usize;
                let (tile, land) = self.tile(tx, ty, theta);
                tiles[i] = tile;
                if !land {
                    continue;
                }
                let (x, y) = (f64::from(tx) + 0.5, f64::from(ty) + 0.5);
                // Resources on land only: the first patch whose noisy edge covers the tile.
                for p in &patches {
                    let (dx, dy) = (x - p.x, y - p.y);
                    let r = p.r * (1.0 + EDGE * self.edge.noise(x / 10.0, y / 10.0));
                    if dx * dx + dy * dy >= r * r {
                        continue;
                    }
                    let n = self.richness.noise(x / 8.0, y / 8.0);
                    let amount = (p.amount * (1.0 + 0.1 * n)).floor();
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
