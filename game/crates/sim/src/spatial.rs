//! Spatial queries (10 §4.4): what stands where, by chunk entity lists and the occupancy grid, never by a scan
//! of every entity. Pure functions over `&World` (§5.1 "scratch functions"), allocation-free, so the tick's
//! movement and placement checks and multiplayer's latency state can run them freely.
//!
//! Boxes are in tiles (`f64`), upper bounds exclusive in the sense that boxes which only touch do not overlap
//! (golden README rule 11: "strict overlap"). An entity's collision box is its prototype's box around its
//! centre `(x2 / 2, y2 / 2)`; M0's chests are square, so their direction does not turn it (rotated boxes arrive
//! with the first non-square entity, M1).

use crate::chunks::{tile_chunk, tile_index};
use crate::handle;
use crate::world::World;
use schema::{ChunkKey, EntityHandle, Serial, SurfaceIndex, chunk_key};

/// An axis-aligned box in tiles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Box2 {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Box2 {
    /// Strict overlap: boxes that only touch do not overlap (rule 11).
    pub fn overlaps(&self, o: &Box2) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.y0 < o.y1 && o.y0 < self.y1
    }

    /// The squared distance from a point to the box, 0 inside; written with comparisons (§4.1: no min/max).
    pub fn dist2(&self, px: f64, py: f64) -> f64 {
        let dx = if px < self.x0 {
            self.x0 - px
        } else if px > self.x1 {
            px - self.x1
        } else {
            0.0
        };
        let dy = if py < self.y0 {
            self.y0 - py
        } else if py > self.y1 {
            py - self.y1
        } else {
            0.0
        };
        dx * dx + dy * dy
    }
}

impl World {
    /// The collision box of the live entity in entity-table row `row`.
    pub fn collision_box(&self, row: u32) -> Box2 {
        let r = row as usize;
        let p = usize::from(self.entities.proto[r].0);
        let e = &self.protos.entity;
        let (cx, cy) = (f64::from(self.entities.x2[r]) / 2.0, f64::from(self.entities.y2[r]) / 2.0);
        Box2 {
            x0: cx + e.collision_x0[p],
            y0: cy + e.collision_y0[p],
            x1: cx + e.collision_x1[p],
            y1: cy + e.collision_y1[p],
        }
    }

    /// Calls `f(row)` for every live entity whose collision box overlaps `b` strictly, in ascending row order
    /// within each chunk and chunks in (cx, cy) order; stops when `f` returns `true` and returns whether it did.
    pub fn any_entity_overlapping(
        &self,
        surface: SurfaceIndex,
        b: &Box2,
        f: &mut dyn FnMut(u32) -> bool,
    ) -> bool {
        let reach = self.entity_reach;
        let floor = |v: f64| v.floor() as i32;
        let (cx0, cx1) = (tile_chunk(floor(b.x0 - reach)), tile_chunk(floor(b.x1 + reach)));
        let (cy0, cy1) = (tile_chunk(floor(b.y0 - reach)), tile_chunk(floor(b.y1 + reach)));
        for cx in cx0..=cx1 {
            for cy in cy0..=cy1 {
                let Some(c) = self.chunks.get(surface, chunk_key(cx, cy)) else {
                    continue;
                };
                for &row in &c.entities {
                    if self.collision_box(row).overlaps(b) && f(row) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// The lowest serial among the live entities whose collision box overlaps `b` (rule 20: "buildings in the
    /// way (the lowest serial)").
    pub fn lowest_serial_overlapping(&self, surface: SurfaceIndex, b: &Box2) -> Option<Serial> {
        let mut best: Option<Serial> = None;
        self.any_entity_overlapping(surface, b, &mut |row| {
            let s = self.entities.serial[row as usize];
            if best.is_none_or(|x| s < x) {
                best = Some(s);
            }
            false
        });
        best
    }

    /// The live entities overlapping `b`, ascending by serial (allocates: for queries outside the tick).
    pub fn entities_in_area(&self, surface: SurfaceIndex, b: &Box2) -> Vec<Serial> {
        let mut out = Vec::new();
        self.any_entity_overlapping(surface, b, &mut |row| {
            out.push(self.entities.serial[row as usize]);
            false
        });
        out.sort_unstable();
        out
    }

    /// The object-layer building covering tile `(tx, ty)` (the occupancy grid, O(1)).
    pub fn entity_on_tile(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<EntityHandle> {
        let row = self.chunks.at_tile(surface, tx, ty)?.occupant(tile_index(tx, ty))?;
        Some(handle::make(row, self.entities.r#gen[row as usize]))
    }

    /// The chunk key of the chunk holding a point in tiles.
    pub fn chunk_of(x: f64, y: f64) -> ChunkKey {
        chunk_key(tile_chunk(x.floor() as i32), tile_chunk(y.floor() as i32))
    }
}

/// How far any entity's collision box reaches from its centre (tiles): the bound that decides which chunks'
/// lists a box query visits. Derived from the prototypes once per World.
pub fn max_entity_reach(p: &schema::Protos) -> f64 {
    let e = &p.entity;
    let mut m = 0.0;
    for i in 0..e.len() {
        for v in [e.collision_x0[i], e.collision_y0[i], e.collision_x1[i], e.collision_y1[i]] {
            let a = if v < 0.0 { -v } else { v };
            if a > m {
                m = a;
            }
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_overlap_and_distance() {
        let a = Box2 { x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0 };
        let touching = Box2 { x0: 1.0, y0: 0.0, x1: 2.0, y1: 1.0 };
        assert!(!a.overlaps(&touching), "boxes that touch do not overlap");
        assert!(a.overlaps(&Box2 { x0: 0.99, y0: 0.5, x1: 3.0, y1: 3.0 }));
        assert_eq!(a.dist2(0.5, 0.5), 0.0);
        assert_eq!(a.dist2(4.0, 5.0), 9.0 + 16.0);
        assert_eq!(a.dist2(-1.0, 0.5), 1.0);
    }
}
