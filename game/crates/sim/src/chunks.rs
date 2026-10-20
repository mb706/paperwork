//! Chunks (10 §4.4): the modified chunks (`CHUNKS`), the set of generated chunks (`GENERATED`), and what each
//! modified chunk derives for the rules: its entity list and its occupancy grid.
//!
//! - **Keys.** A chunk is named by `(surface, key)`, key = `(cx + 2¹⁵) × 2¹⁶ + (cy + 2¹⁵)` (§4.4). Both lists
//!   are kept sorted by `(surface, key)`, so every walk over chunks is canonical (D3 d) and a record's position,
//!   which names it in the digest slices (golden README rule 38), is a binary search away.
//! - **Pristine chunks** are generated and never modified: they are in `GENERATED` only, and their content is a
//!   pure function of the seed, regenerated lazily (§4.4; C2b's worldgen fills that cache). Every modified
//!   chunk is also generated (`CHUNKS ⊆ GENERATED`).
//! - **Derived per chunk:** the entity list (entity-table slots of the entities whose centre lies in the
//!   chunk, ascending), the occupancy grid (the object-layer building on each tile, as slot + 1), and the view
//!   versions of §15.4 (presentation counters, never read by a rule; golden rule 6: 1 after a load, + 1 per
//!   change of their part).

use crate::r#gen::{Chunk, GeneratedChunk};
use crate::index::ShardBuckets;
use schema::{ChunkKey, SHARDS, SurfaceIndex, TileId, chunk_key, chunk_xy};

/// Tiles per chunk side (§4.4).
pub const CHUNK_TILES: i32 = 32;

/// The chunk coordinate of a tile coordinate (flooring toward −∞).
#[inline]
pub const fn tile_chunk(t: i32) -> i32 {
    t >> 5
}

/// The index of tile `(tx, ty)` in its chunk's 1,024 tiles, row-major (packet.yaml `ChunkTiles`).
#[inline]
pub const fn tile_index(tx: i32, ty: i32) -> usize {
    ((ty & 31) * 32 + (tx & 31)) as usize
}

/// The chunk key of the chunk holding tile `(tx, ty)` (the tile must lie in the key range).
#[inline]
pub const fn tile_chunk_key(tx: i32, ty: i32) -> ChunkKey {
    chunk_key(tile_chunk(tx), tile_chunk(ty))
}

/// Tiles per axis on each side of the origin that chunk keys can name (§4.4: ±32,768 chunks, ±2²⁰ tiles,
/// Factorio's map size).
pub const KEY_TILES: i32 = 1 << 20;

/// Whether tile `(tx, ty)` lies in the chunk-key range; outside it no chunk exists (a key would alias).
#[inline]
pub const fn in_key_range(tx: i32, ty: i32) -> bool {
    tx >= -KEY_TILES && tx < KEY_TILES && ty >= -KEY_TILES && ty < KEY_TILES
}

/// The view versions of §15.4: presentation counters, derived, never saved or read by a rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ViewVersions {
    pub tiles: u32,
    pub entities: u32,
    pub objects: u32,
    pub resources: u32,
}

impl Default for ViewVersions {
    /// Rule 6: every part starts at 1 when a world is loaded or created.
    fn default() -> Self {
        Self { tiles: 1, entities: 1, objects: 1, resources: 1 }
    }
}

/// A modified chunk: its saved record and what it derives.
#[derive(Clone, Debug, PartialEq)]
pub struct ChunkState {
    /// The `CHUNKS` record (§8.1).
    pub rec: Chunk,
    /// Derived: entity-table slots of the entities whose centre lies here, ascending (§4.4).
    pub entities: Vec<u32>,
    /// Derived: per tile, 1 + the slot of the object-layer building covering it, 0 = none (§4.4).
    occupancy: Option<Box<[u32; 1024]>>,
    /// Derived presentation counters (§15.4).
    pub view: ViewVersions,
}

impl ChunkState {
    pub fn new(rec: Chunk) -> Self {
        Self { rec, entities: Vec::new(), occupancy: None, view: ViewVersions::default() }
    }

    pub fn surface(&self) -> SurfaceIndex {
        self.rec.surface
    }

    pub fn key(&self) -> ChunkKey {
        self.rec.key
    }

    /// The chunk's `(cx, cy)`.
    pub fn xy(&self) -> (i32, i32) {
        chunk_xy(self.rec.key)
    }

    /// The entity-table slot of the building on tile index `i`, if any.
    pub fn occupant(&self, i: usize) -> Option<u32> {
        self.occupancy.as_ref().and_then(|o| o[i].checked_sub(1))
    }

    /// Marks tile index `i` as covered by `slot` (`Some`) or free.
    pub fn set_occupant(&mut self, i: usize, slot: Option<u32>) {
        match slot {
            Some(s) => self.occupancy.get_or_insert_with(|| Box::new([0; 1024]))[i] = s + 1,
            None => {
                if let Some(o) = self.occupancy.as_mut() {
                    o[i] = 0;
                }
            }
        }
    }

    pub fn add_entity(&mut self, slot: u32) {
        if let Err(i) = self.entities.binary_search(&slot) {
            self.entities.insert(i, slot);
        }
    }

    pub fn remove_entity(&mut self, slot: u32) {
        if let Ok(i) = self.entities.binary_search(&slot) {
            self.entities.remove(i);
        }
    }

    /// Drops every derived entry (before a rebuild).
    pub fn clear_derived(&mut self) {
        self.entities.clear();
        self.occupancy = None;
    }

    pub fn tile(&self, tx: i32, ty: i32) -> TileId {
        self.rec.tiles[tile_index(tx, ty)]
    }
}

/// The chunk store of every surface.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChunkStore {
    /// `CHUNKS`: modified chunks, ascending by `(surface, key)`. Boxed: an insertion moves pointers, not
    /// 1-KiB chunk records.
    #[allow(clippy::vec_box)]
    modified: Vec<Box<ChunkState>>,
    /// `GENERATED`: every generated chunk, ascending by `(surface, key)`.
    generated: Vec<GeneratedChunk>,
    /// Derived: the generated chunks of each digest shard (chunk key mod 3,600, §4.8), ascending by
    /// `(surface, key)`.
    shards: ShardBuckets<(SurfaceIndex, ChunkKey)>,
}

impl ChunkStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// From a save's records, which the decoders have checked are strictly ascending. Refuses a modified chunk
    /// that is not generated (`CHUNKS ⊆ GENERATED`, §4.4).
    pub fn from_records(chunks: Vec<Chunk>, generated: Vec<GeneratedChunk>) -> Result<Self, String> {
        let mut s = Self {
            modified: chunks.into_iter().map(|c| Box::new(ChunkState::new(c))).collect(),
            generated,
            shards: ShardBuckets::new(),
        };
        for i in 0..s.generated.len() {
            let (surface, key) = (s.generated[i].surface, s.generated[i].key);
            s.shards.insert(key.0 % SHARDS, (surface, key));
        }
        for c in &s.modified {
            if s.generated_index(c.surface(), c.key()).is_err() {
                let (cx, cy) = c.xy();
                return Err(format!(
                    "the modified chunk ({cx}, {cy}) on surface {} is not generated",
                    c.surface().0
                ));
            }
        }
        Ok(s)
    }

    /// The position of a modified chunk in `CHUNKS`, or where it would go.
    pub fn modified_index(&self, surface: SurfaceIndex, key: ChunkKey) -> Result<usize, usize> {
        self.modified.binary_search_by(|c| (c.rec.surface, c.rec.key).cmp(&(surface, key)))
    }

    /// The position of a chunk in `GENERATED`, or where it would go.
    pub fn generated_index(&self, surface: SurfaceIndex, key: ChunkKey) -> Result<usize, usize> {
        self.generated.binary_search_by(|c| (c.surface, c.key).cmp(&(surface, key)))
    }

    pub fn get(&self, surface: SurfaceIndex, key: ChunkKey) -> Option<&ChunkState> {
        self.modified_index(surface, key).ok().map(|i| &*self.modified[i])
    }

    pub fn get_mut(&mut self, surface: SurfaceIndex, key: ChunkKey) -> Option<&mut ChunkState> {
        self.modified_index(surface, key).ok().map(|i| &mut *self.modified[i])
    }

    /// The modified chunk holding tile `(tx, ty)`; none outside the chunk-key range.
    pub fn at_tile(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<&ChunkState> {
        if !in_key_range(tx, ty) {
            return None;
        }
        self.get(surface, tile_chunk_key(tx, ty))
    }

    pub fn at_tile_mut(&mut self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<&mut ChunkState> {
        if !in_key_range(tx, ty) {
            return None;
        }
        self.get_mut(surface, tile_chunk_key(tx, ty))
    }

    pub fn is_generated(&self, surface: SurfaceIndex, key: ChunkKey) -> bool {
        self.generated_index(surface, key).is_ok()
    }

    pub fn is_modified(&self, surface: SurfaceIndex, key: ChunkKey) -> bool {
        self.modified_index(surface, key).is_ok()
    }

    /// The generated chunks whose key falls in digest shard `shard`, ascending by `(surface, key)`.
    pub fn generated_in_shard(&self, shard: u32) -> &[(SurfaceIndex, ChunkKey)] {
        self.shards.bucket(shard)
    }

    /// Records a newly generated chunk (§5.18's commit); refuses one already generated.
    pub fn insert_generated(&mut self, rec: GeneratedChunk) -> Result<(), String> {
        match self.generated_index(rec.surface, rec.key) {
            Ok(_) => Err(format!("chunk {:#x} on surface {} is already generated", rec.key.0, rec.surface.0)),
            Err(i) => {
                let (surface, key) = (rec.surface, rec.key);
                self.generated.insert(i, rec);
                self.shards.insert(key.0 % SHARDS, (surface, key));
                Ok(())
            }
        }
    }

    /// Makes a generated chunk modified with its content `rec` (taken from the generator for a pristine
    /// chunk), and returns it; a chunk already modified is returned as it is.
    pub fn insert_modified(&mut self, rec: Chunk) -> Result<&mut ChunkState, String> {
        if !self.is_generated(rec.surface, rec.key) {
            return Err(format!("chunk {:#x} on surface {} is not generated", rec.key.0, rec.surface.0));
        }
        let i = match self.modified_index(rec.surface, rec.key) {
            Ok(i) => i,
            Err(i) => {
                self.modified.insert(i, Box::new(ChunkState::new(rec)));
                i
            }
        };
        Ok(&mut *self.modified[i])
    }

    /// The modified chunks in `CHUNKS` order.
    pub fn modified(&self) -> impl ExactSizeIterator<Item = &ChunkState> + '_ {
        self.modified.iter().map(|c| &**c)
    }

    pub fn modified_mut(&mut self) -> impl ExactSizeIterator<Item = &mut ChunkState> + '_ {
        self.modified.iter_mut().map(|c| &mut **c)
    }

    /// The modified chunk at position `i` of `CHUNKS`.
    pub fn modified_at(&self, i: usize) -> &ChunkState {
        &self.modified[i]
    }

    pub fn modified_count(&self) -> usize {
        self.modified.len()
    }

    /// `GENERATED` in order.
    pub fn generated(&self) -> &[GeneratedChunk] {
        &self.generated
    }

    /// Whether some generated chunk is pristine (not stored in `CHUNKS`).
    pub fn has_pristine(&self) -> bool {
        self.generated.len() > self.modified.len()
    }

    /// Drops every chunk's derived entries (before a rebuild).
    pub fn clear_derived(&mut self) {
        for c in &mut self.modified {
            c.clear_derived();
        }
    }
}

/// A rectangle of tiles, upper bounds exclusive, in `i64` so that unbounded maps fit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TileRect {
    pub x0: i64,
    pub y0: i64,
    pub x1: i64,
    pub y1: i64,
}

impl TileRect {
    pub const fn contains(&self, tx: i32, ty: i32) -> bool {
        let (x, y) = (tx as i64, ty as i64);
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }
}

/// The map's tile bounds (§5.18, 07 §17): golden README rule 1, Factorio's centred map. Width W covers
/// `x ∈ [−⌊W/2⌋, W − ⌊W/2⌋)`; 0 is unbounded. Every map ends at the chunk-key range (±2²⁰ tiles), where
/// Factorio's ends too (a 2,000,000-tile map), so no tile of the map has an aliased chunk key.
pub fn map_bounds(width: u32, height: u32) -> TileRect {
    const BIG: i64 = KEY_TILES as i64;
    let lo = |size: u32| if size == 0 || i64::from(size / 2) > BIG { -BIG } else { -i64::from(size / 2) };
    let hi = |size: u32| {
        let v = i64::from(size) - i64::from(size / 2);
        if size == 0 || v > BIG { BIG } else { v }
    };
    TileRect { x0: lo(width), x1: hi(width), y0: lo(height), y1: hi(height) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(surface: u16, cx: i32, cy: i32) -> Chunk {
        Chunk { surface: SurfaceIndex(surface), key: chunk_key(cx, cy), ..Chunk::default() }
    }

    fn generated(surface: u16, cx: i32, cy: i32) -> GeneratedChunk {
        GeneratedChunk { surface: SurfaceIndex(surface), key: chunk_key(cx, cy), ..GeneratedChunk::default() }
    }

    #[test]
    fn tile_helpers_floor_toward_negative_infinity() {
        assert_eq!(tile_chunk(-1), -1);
        assert_eq!(tile_chunk(-32), -1);
        assert_eq!(tile_chunk(-33), -2);
        assert_eq!(tile_chunk(31), 0);
        assert_eq!(tile_index(-1, -1), 1023);
        assert_eq!(tile_index(32, 1), 32);
        assert_eq!(tile_index(5, -32), 5);
    }

    #[test]
    fn the_golden_map_is_96_tiles_centred() {
        let b = map_bounds(96, 96);
        assert_eq!((b.x0, b.x1, b.y0, b.y1), (-48, 48, -48, 48));
        assert!(b.contains(-48, 47) && !b.contains(48, 0) && !b.contains(0, -49));
        let odd = map_bounds(5, 0);
        assert_eq!((odd.x0, odd.x1), (-2, 3));
        assert!(odd.contains(0, 1_000_000));
        // Every map ends at the chunk-key range: no tile of the map has an aliased key.
        let huge = map_bounds(4_000_000, 0);
        assert_eq!((huge.x0, huge.x1, huge.y0, huge.y1), (-(1 << 20), 1 << 20, -(1 << 20), 1 << 20));
        assert!(
            !huge.contains(1 << 20, 0)
                && !in_key_range(1 << 20, 0)
                && in_key_range(-(1 << 20), (1 << 20) - 1)
        );
    }

    #[test]
    fn modified_chunks_must_be_generated_and_stay_sorted() {
        let mut s = ChunkStore::new();
        assert!(s.insert_modified(chunk(0, 0, 0)).is_err());
        for (cx, cy) in [(1, 0), (-2, -2), (0, 0), (0, -1)] {
            s.insert_generated(generated(0, cx, cy)).expect("new");
        }
        assert!(s.insert_generated(generated(0, 0, 0)).is_err());
        s.insert_modified(chunk(0, 1, 0)).expect("generated");
        s.insert_modified(chunk(0, -2, -2)).expect("generated");
        let keys: Vec<u32> = s.modified().map(|c| c.key().0).collect();
        assert!(keys.windows(2).all(|w| w[0] < w[1]));
        assert!(s.has_pristine());
        assert_eq!(s.generated_index(SurfaceIndex(0), chunk_key(0, -1)), Ok(1));
        assert!(ChunkStore::from_records(vec![chunk(0, 5, 5)], vec![generated(0, 0, 0)]).is_err());
    }

    #[test]
    fn occupancy_and_entity_lists() {
        let mut c = ChunkState::new(chunk(0, 0, 0));
        assert_eq!(c.occupant(3), None);
        c.set_occupant(3, Some(0));
        assert_eq!(c.occupant(3), Some(0));
        c.set_occupant(3, None);
        assert_eq!(c.occupant(3), None);
        c.add_entity(5);
        c.add_entity(2);
        c.add_entity(5);
        assert_eq!(c.entities, vec![2, 5]);
        c.remove_entity(2);
        assert_eq!(c.entities, vec![5]);
    }
}
