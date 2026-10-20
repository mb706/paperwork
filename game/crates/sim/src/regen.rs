//! Worldgen inside the sim (10 §4.4, §5.18, §15.9; D12, R28): the regeneration cache of pristine chunks, the
//! pre-generation requests and the inline chunk commits of phase 3.
//!
//! - **Pristine chunks** are generated but unmodified: only their `GENERATED` record is saved, and their
//!   tiles and resources are a pure function of the world ([`worldgen::Generator`]). The cache holds the
//!   ones a rule has touched since the world was loaded; it is derived state, never saved, and bounded
//!   (an evicted chunk is regenerated when touched again, with the same bytes).
//! - **Requests** (§5.18 "the commit protocol"): when a character enters a chunk, every chunk within the
//!   pre-generation radius (7 chunks, Chebyshev) that lies in the map and is neither generated nor pending is
//!   requested. A tick's requests are scheduled in ascending `(surface, cy, cx)`; each takes the first tick
//!   from t + 30 on with fewer than 8 commits scheduled. A request is world state (`WORLDGEN_PENDING`).
//! - **Commits** (phase 3): every request due this tick, in `(surface, cy, cx)` order, takes the worker's
//!   answer if one arrived (`sim_supply_chunk`, checked against the world hash and the pending set) and
//!   otherwise generates the chunk inline; the chunk becomes generated (pristine).

use crate::r#gen::{Chunk, GeneratedChunk};
use crate::world::{PendingKey, World};
use schema::{ChunkData, ChunkKey, ChunkRequest, SurfaceIndex, Tick, chunk_key};
use std::sync::Arc;

/// Chunks kept in the cache before the oldest is evicted (a 15 × 15 pre-generation square is 225).
pub const CACHE_CHUNKS: usize = 2048;
/// The pre-generation radius around a character, in chunks (§5.18).
pub const PREGEN_RADIUS: i32 = 7;
/// The earliest commit tick of a request made in tick t is t + this (§5.18).
pub const COMMIT_DELAY: u32 = 30;
/// The most chunks one tick commits (§5.18, B1-r1 16).
pub const COMMITS_PER_TICK: usize = 8;

/// The regeneration cache (derived, unsaved) and the world's generator.
#[derive(Clone, Debug, Default)]
pub struct RegenCache {
    generator: Option<Arc<worldgen::Generator>>,
    /// Ascending by `(surface, key)`; the second field orders evictions (insertion order).
    entries: Vec<(SurfaceIndex, ChunkKey, u64, Arc<ChunkData>)>,
    stamp: u64,
    /// How many chunks this cache generated (tests: a load regenerates nothing until a rule touches it).
    pub generated: u64,
}

impl RegenCache {
    pub fn set_generator(&mut self, g: Arc<worldgen::Generator>) {
        self.generator = Some(g);
        self.entries.clear();
    }

    pub fn generator(&self) -> Option<&Arc<worldgen::Generator>> {
        self.generator.as_ref()
    }

    fn find(&self, surface: SurfaceIndex, key: ChunkKey) -> Result<usize, usize> {
        self.entries.binary_search_by(|e| (e.0, e.1).cmp(&(surface, key)))
    }

    pub fn get(&self, surface: SurfaceIndex, key: ChunkKey) -> Option<&ChunkData> {
        self.find(surface, key).ok().map(|i| &*self.entries[i].3)
    }

    /// Stores a chunk's generated content, evicting the oldest entry when the cache is full.
    pub fn put(&mut self, data: Arc<ChunkData>) {
        let (surface, key) = (data.surface, data.key);
        self.stamp += 1;
        match self.find(surface, key) {
            Ok(i) => self.entries[i] = (surface, key, self.stamp, data),
            Err(i) => {
                self.entries.insert(i, (surface, key, self.stamp, data));
                if self.entries.len() > CACHE_CHUNKS {
                    let oldest = (0..self.entries.len()).min_by_key(|&j| self.entries[j].2).unwrap_or(0);
                    self.entries.remove(oldest);
                }
            }
        }
    }

    /// Generates chunk `(surface, key)` with the world's generator.
    pub fn generate(&mut self, surface: SurfaceIndex, key: ChunkKey) -> Arc<ChunkData> {
        let g = self.generator.as_ref().expect("a world with pristine chunks has a generator");
        let (cx, cy) = schema::chunk_xy(key);
        self.generated += 1;
        Arc::new(g.chunk(surface, cx, cy))
    }
}

/// Worker answers held for the pending requests (`sim_supply_chunk`), by `(surface, key)`.
#[derive(Clone, Debug, Default)]
pub struct Answers {
    list: Vec<Arc<ChunkData>>,
}

impl Answers {
    pub fn clear(&mut self) {
        self.list.clear();
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    fn find(&self, surface: SurfaceIndex, key: ChunkKey) -> Result<usize, usize> {
        self.list.binary_search_by(|a| (a.surface, a.key).cmp(&(surface, key)))
    }

    /// Holds an answer (a second answer for the same chunk replaces the first: both are the same record).
    pub fn put(&mut self, data: ChunkData) {
        match self.find(data.surface, data.key) {
            Ok(i) => self.list[i] = Arc::new(data),
            Err(i) => self.list.insert(i, Arc::new(data)),
        }
    }

    pub fn take(&mut self, surface: SurfaceIndex, key: ChunkKey) -> Option<Arc<ChunkData>> {
        self.find(surface, key).ok().map(|i| self.list.remove(i))
    }

    /// Drops the answers whose request is gone (committed or never made).
    pub fn retain_pending(&mut self, w: &World) {
        self.list.retain(|a| w.is_pending(a.surface, a.key));
    }
}

/// The `CHUNKS` record of a pristine chunk's generated content (rule version 0: nothing changed it yet).
pub fn chunk_record(d: &ChunkData) -> Chunk {
    Chunk {
        surface: d.surface,
        key: d.key,
        tiles: d.tiles,
        hidden_tiles: Vec::new(),
        resources: d.resources.clone(),
        trees: d.trees.clone(),
        objects: d.objects.clone(),
        ground_items: Vec::new(),
        leaf_timer: 0.0,
        rule_version: 0,
    }
}

impl World {
    /// Makes sure the pristine chunk `(surface, key)` is in the regeneration cache.
    pub(crate) fn regen_touch(&mut self, surface: SurfaceIndex, key: ChunkKey) {
        if self.regen.get(surface, key).is_none() {
            let d = self.regen.generate(surface, key);
            self.regen.put(d);
        }
    }

    /// The `CHUNKS` record a pristine chunk becomes when a rule changes it.
    pub(crate) fn regen_record(&mut self, surface: SurfaceIndex, key: ChunkKey) -> Chunk {
        self.regen_touch(surface, key);
        chunk_record(self.regen.get(surface, key).expect("touched"))
    }

    /// Whether a request for `(surface, key)` is pending.
    pub fn is_pending(&self, surface: SurfaceIndex, key: ChunkKey) -> bool {
        let (cx, cy) = schema::chunk_xy(key);
        self.pending_chunks.binary_search(&(surface, cy, cx)).is_ok()
    }

    /// How many commits are scheduled for tick `t`.
    fn commits_at(&self, t: u32) -> usize {
        let at = self.pending().count_below(&(Tick(t), SurfaceIndex(0), i32::MIN, i32::MIN));
        let hi = t.checked_add(1).map_or(self.pending().len(), |n| {
            self.pending().count_below(&(Tick(n), SurfaceIndex(0), i32::MIN, i32::MIN))
        });
        hi - at
    }

    /// Whether chunk `(cx, cy)` has a tile inside the map (rule 2: pre-generation requests no chunk outside it).
    pub fn chunk_in_map(&self, cx: i32, cy: i32) -> bool {
        let b = crate::chunks::map_bounds(self.globals.map.width, self.globals.map.height);
        let (x0, y0) = (i64::from(cx) * 32, i64::from(cy) * 32);
        x0 < b.x1 && x0 + 32 > b.x0 && y0 < b.y1 && y0 + 32 > b.y0
    }

    /// Collects into `out` the chunks around `(ccx, ccy)` that pre-generation must request (§5.18): in the map,
    /// neither generated nor pending.
    pub(crate) fn pregen_wanted(
        &self,
        surface: SurfaceIndex,
        ccx: i32,
        ccy: i32,
        out: &mut Vec<(SurfaceIndex, i32, i32)>,
    ) {
        let r = PREGEN_RADIUS;
        for cy in ccy.saturating_sub(r)..=ccy.saturating_add(r) {
            for cx in ccx.saturating_sub(r)..=ccx.saturating_add(r) {
                if !(-32_768..32_768).contains(&cx) || !(-32_768..32_768).contains(&cy) {
                    continue;
                }
                let key = chunk_key(cx, cy);
                if self.chunk_in_map(cx, cy)
                    && !self.chunks.is_generated(surface, key)
                    && !self.is_pending(surface, key)
                {
                    out.push((surface, cy, cx));
                }
            }
        }
    }

    /// Schedules this tick's requests (sorted, deduplicated by the caller's list) and reports each through
    /// `issued` (`sim_pending_chunks`).
    pub(crate) fn schedule_requests(
        &mut self,
        t: u32,
        wanted: &mut Vec<(SurfaceIndex, i32, i32)>,
        issued: &mut Vec<ChunkRequest>,
    ) {
        wanted.sort_unstable();
        wanted.dedup();
        let mut due = t.saturating_add(COMMIT_DELAY);
        for &(surface, cy, cx) in wanted.iter() {
            if self.is_pending(surface, chunk_key(cx, cy)) {
                continue;
            }
            while self.commits_at(due) >= COMMITS_PER_TICK {
                due = due.saturating_add(1);
            }
            let k: PendingKey = (Tick(due), surface, cy, cx);
            self.add_pending(k);
            issued.push(ChunkRequest { surface, cx, cy, commit_tick: Tick(due) });
        }
        wanted.clear();
    }

    /// Phase 3 (§4.6, §5.18): commits every request due at tick `t`, a worker's answer or inline generation.
    pub(crate) fn commit_chunks(&mut self, t: u32, answers: &mut Answers) {
        while let Some(&k) = self.pending().first() {
            if k.0.0 != t {
                debug_assert!(k.0.0 > t, "a request due in the past");
                break;
            }
            self.remove_pending(&k);
            let (_, surface, cy, cx) = k;
            let key = chunk_key(cx, cy);
            let data = match answers.take(surface, key) {
                Some(a) => a,
                None => self.regen.generate(surface, key),
            };
            self.commit_generated(data);
        }
    }

    /// Makes every pristine chunk modified (`sim_save` with BAKE, §4.4).
    pub fn bake_pristine(&mut self) {
        let keys: Vec<(SurfaceIndex, ChunkKey)> = self
            .chunks
            .generated()
            .iter()
            .filter(|g| !self.chunks.is_modified(g.surface, g.key))
            .map(|g| (g.surface, g.key))
            .collect();
        for (surface, key) in keys {
            let rec = self.regen_record(surface, key);
            self.chunks.insert_modified(rec).expect("a pristine chunk becomes modified");
        }
    }

    /// Adds a generated chunk: its `GENERATED` record and its content in the cache.
    pub(crate) fn commit_generated(&mut self, data: Arc<ChunkData>) {
        let rec = GeneratedChunk {
            surface: data.surface,
            key: data.key,
            kappa: worldgen::chunk_kappa(&self.protos, &data.tiles),
            theta: data.theta,
            sunlight: data.sunlight,
        };
        self.chunks.insert_generated(rec).expect("a new chunk is not generated yet");
        self.regen.put(data);
    }
}
