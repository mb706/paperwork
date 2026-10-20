//! Tiles and resources as the rules see them (10 §4.4, §5.18; golden README rules 1–3): a modified chunk's
//! record, else a generated (pristine) chunk's tiles from the regeneration cache, else nothing (a tile in no
//! generated chunk is unwalkable and unbuildable).
//!
//! A rule that reads tiles first **touches** them ([`World::touch_tiles`]): the pristine chunks under them are
//! regenerated into the cache if they are not there yet (worldgen is pure, so the cache is derived, unsaved
//! state; R28: a load regenerates nothing until a rule or the view touches a chunk). A rule that changes a
//! pristine chunk first makes it **modified** ([`World::make_modified`]): the chunk's generated content becomes
//! its `CHUNKS` record, rule version 0, and the change raises it from there.

use crate::chunks::{tile_chunk, tile_index};
use crate::world::World;
use schema::{ResourceTile, SurfaceIndex, TileId, chunk_key};

impl World {
    /// The tile at `(tx, ty)`: a modified chunk's, else a touched pristine chunk's; `None` in no generated chunk.
    pub fn tile_at(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<TileId> {
        if let Some(c) = self.chunks.at_tile(surface, tx, ty) {
            return Some(c.tile(tx, ty));
        }
        let key = chunk_key(tile_chunk(tx), tile_chunk(ty));
        if !self.chunks.is_generated(surface, key) {
            return None;
        }
        let g = self.regen.get(surface, key);
        debug_assert!(g.is_some(), "a rule read pristine chunk {:#x} without touching it", key.0);
        g.map(|g| g.tiles[tile_index(tx, ty)])
    }

    /// Walkable (§4.4, §5.18; rules 3, 11): in the map, generated, and a walkable tile.
    pub fn walkable(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> bool {
        self.tile_at(surface, tx, ty).is_some_and(|t| {
            self.in_map(tx, ty) && self.protos.tile.walkable.get(usize::from(t.0)).copied().unwrap_or(false)
        })
    }

    /// Buildable (rules 3, 20): in the map, generated, and a buildable tile.
    pub fn buildable(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> bool {
        self.tile_at(surface, tx, ty).is_some_and(|t| {
            self.in_map(tx, ty) && self.protos.tile.buildable.get(usize::from(t.0)).copied().unwrap_or(false)
        })
    }

    /// The resource on tile `(tx, ty)` (§4.4: resources are per tile), if any.
    pub fn resource_at(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<ResourceTile> {
        let i = tile_index(tx, ty) as u16;
        let list = if let Some(c) = self.chunks.at_tile(surface, tx, ty) {
            &c.rec.resources
        } else {
            let key = chunk_key(tile_chunk(tx), tile_chunk(ty));
            if !self.chunks.is_generated(surface, key) {
                return None;
            }
            let g = self.regen.get(surface, key);
            debug_assert!(g.is_some(), "a rule read pristine chunk {:#x} without touching it", key.0);
            &g?.resources
        };
        list.binary_search_by(|r| r.tile.cmp(&i)).ok().map(|k| list[k])
    }

    /// Regenerates into the cache every pristine chunk under the tiles `[tx0, tx1) × [ty0, ty1)`.
    pub fn touch_tiles(&mut self, surface: SurfaceIndex, tx0: i32, ty0: i32, tx1: i32, ty1: i32) {
        if tx1 <= tx0 || ty1 <= ty0 {
            return;
        }
        for cy in tile_chunk(ty0)..=tile_chunk(ty1 - 1) {
            for cx in tile_chunk(tx0)..=tile_chunk(tx1 - 1) {
                let key = chunk_key(cx, cy);
                if self.chunks.is_generated(surface, key) && !self.chunks.is_modified(surface, key) {
                    self.regen_touch(surface, key);
                }
            }
        }
    }

    /// Makes every pristine chunk under the tiles `[tx0, tx1) × [ty0, ty1)` modified (a rule is about to change
    /// it): its generated content becomes its `CHUNKS` record.
    pub fn make_modified(&mut self, surface: SurfaceIndex, tx0: i32, ty0: i32, tx1: i32, ty1: i32) {
        if tx1 <= tx0 || ty1 <= ty0 {
            return;
        }
        for cy in tile_chunk(ty0)..=tile_chunk(ty1 - 1) {
            for cx in tile_chunk(tx0)..=tile_chunk(tx1 - 1) {
                let key = chunk_key(cx, cy);
                if self.chunks.is_generated(surface, key) && !self.chunks.is_modified(surface, key) {
                    let rec = self.regen_record(surface, key);
                    self.chunks.insert_modified(rec).expect("a generated chunk becomes modified");
                }
            }
        }
    }

    /// Takes one unit from the resource on `(tx, ty)` of a modified chunk (rules 6, 24): the rule version rises;
    /// the resource view version rises when the band changes or the tile is depleted, which removes it.
    /// Returns whether it was depleted.
    pub fn deplete_resource(&mut self, surface: SurfaceIndex, tx: i32, ty: i32) -> bool {
        let i = tile_index(tx, ty) as u16;
        let c = self.chunks.at_tile_mut(surface, tx, ty).expect("a modified chunk under a mined resource");
        let k = c.rec.resources.binary_search_by(|r| r.tile.cmp(&i)).expect("a resource on the mined tile");
        let before = crate::rules::resource_band(c.rec.resources[k].amount);
        c.rec.resources[k].amount -= 1;
        c.rec.rule_version = c.rec.rule_version.wrapping_add(1);
        if c.rec.resources[k].amount == 0 {
            c.rec.resources.remove(k);
            c.view.resources = c.view.resources.wrapping_add(1);
            return true;
        }
        if crate::rules::resource_band(c.rec.resources[k].amount) != before {
            c.view.resources = c.view.resources.wrapping_add(1);
        }
        false
    }
}
