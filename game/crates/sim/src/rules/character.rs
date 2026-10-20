//! The characters' part of phase 1 (§5.1; rules 10, 11, 22, 23, 25, 26): after the closure's actions, every
//! online character in ascending player index walks, then mines, then crafts. §4.6 lists no phase for
//! characters, so an action applied in tick t takes effect in tick t (R23: a release at tick t stops the
//! character at t). Offline characters neither walk, mine nor craft.

use super::inventory::{self, Inv};
use super::{Ctx, Move, UNIT_DONE, fine_pos, in_reach, item_stat, tile_box};
use crate::digest::Counters;
use crate::r#gen::{MiningMode, MiningState};
use crate::world::World;
use schema::events::{EntityMinedEvent, EventPayload, ItemCraftedEvent};
use schema::{Direction, ItemKey, PLAYERS, PlayerIndex, Seq, TilePos2};

/// A new character faces south (Direction 8), towards the camera (rule 8).
pub const NEW_CHARACTER_DIR: Direction = Direction::South;

/// The 8 walking directions (§5.1), y pointing south: unit vectors for `Direction / 2`; diagonals move √½ per
/// axis (`Math.SQRT1_2`, rule 11).
const S: f64 = std::f64::consts::FRAC_1_SQRT_2;
const WALK: [(f64, f64); 8] =
    [(0.0, -1.0), (S, -S), (1.0, 0.0), (S, S), (0.0, 1.0), (-S, S), (-1.0, 0.0), (-S, -S)];

/// The richness band of a resource tile (rule 24; §15.4 `CHUNK_RESOURCES`): Factorio's ore stage counts,
/// band 0 (the richest) from 15,000 down to band 7 below 150.
pub fn resource_band(amount: u32) -> u8 {
    const STAGES: [u32; 7] = [15_000, 9_500, 5_500, 2_900, 1_300, 400, 150];
    STAGES.iter().position(|&s| amount >= s).map_or(7, |i| i as u8)
}

impl World {
    /// Advances every character after the closure's actions (rule 10).
    pub(crate) fn characters_tick(&mut self, ctx: &mut Ctx<'_>) {
        for i in 0..PLAYERS {
            let pi = PlayerIndex(i as u16);
            let Some(p) = self.players.get(pi) else {
                continue;
            };
            if !p.online || p.character.is_none() {
                ctx.moves[i] = Move::default();
                continue;
            }
            self.walk_tick(ctx, pi);
            let size = self.main_size();
            let p = self.player(pi);
            ctx.scratch.before.take(&self.heap, p.main, size, &p.hand);
            self.mine_tick(ctx, pi);
            self.sort_main(pi, ctx.scratch);
            let p = self.player(pi);
            if ctx.scratch.before.differs(&self.heap, p.main, size, &p.hand) {
                let p = self.player_mut(pi);
                p.inventory_version = p.inventory_version.wrapping_add(1);
            }
            self.craft_tick(ctx, pi);
        }
    }

    /// Whether a character at `(x, y)` collides (§4.4, §5.1; rule 11): its box overlaps a tile that is not
    /// walkable or a building's collision box (strict overlap). Characters do not block each other; trimmed
    /// collision exempts chests from nothing they block.
    fn blocked(&self, x: f64, y: f64) -> bool {
        let b = self.character_box(x, y);
        let surface = schema::SurfaceIndex(0);
        let (tx0, ty0) = (b.x0.floor() as i32, b.y0.floor() as i32);
        let mut tx = tx0;
        while f64::from(tx) < b.x1 {
            let mut ty = ty0;
            while f64::from(ty) < b.y1 {
                if !self.walkable(surface, tx, ty) {
                    return true;
                }
                ty += 1;
            }
            tx += 1;
        }
        self.any_entity_overlapping(surface, &b, &mut |_| true)
    }

    /// One tick of walking (§5.1; rule 11): `running_speed` × the walking speed of the tile under the
    /// character, along the direction. The whole step, else (diagonals only) its x part, else its y part,
    /// else none; no movement up to contact.
    fn walk_tick(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex) {
        let i = usize::from(pi.0);
        let p = self.player(pi);
        if !p.walking {
            ctx.moves[i] = Move::default();
            return;
        }
        let (x, y, dir, surface) = (p.x, p.y, p.walking_dir, p.surface);
        // The tiles the step can touch: the character's box grown by a step (well under a tile).
        let b = self.character_box(x, y);
        self.touch_tiles(
            surface,
            b.x0.floor() as i32 - 1,
            b.y0.floor() as i32 - 1,
            b.x1.floor() as i32 + 2,
            b.y1.floor() as i32 + 2,
        );
        let tile_speed = match self.tile_at(surface, x.floor() as i32, y.floor() as i32) {
            Some(t) => self.protos.tile.walking_speed[usize::from(t.0)],
            None => 0.0,
        };
        let speed = self.protos.entity.running_speed[self.character_proto()] * tile_speed;
        let (ux, uy) = WALK[usize::from(dir.value() >> 1)];
        let (dx, dy) = (speed * ux, speed * uy);
        let (mut mx, mut my) = (0.0, 0.0);
        if !self.blocked(x + dx, y + dy) {
            mx = dx;
            my = dy;
        } else if dx != 0.0 && dy != 0.0 {
            if !self.blocked(x + dx, y) {
                mx = dx;
            } else if !self.blocked(x, y + dy) {
                my = dy;
            }
        }
        let p = self.player_mut(pi);
        p.x += mx;
        p.y += my;
        ctx.moves[i] = Move { dx: mx, dy: my };
        let (nx, ny) = (p.x, p.y);
        if World::chunk_of(nx, ny) != World::chunk_of(x, y) {
            self.pregen_around(surface, nx, ny, ctx.wanted);
        }
    }

    /// One tick of a character's hand mining (§5.1: progress = mining_speed ÷ (mining_time × 60) per tick, no
    /// bonuses in M0; rules 22, 23).
    fn mine_tick(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex) {
        let p = self.player(pi);
        let m = p.mining;
        let ch = self.character_proto();
        let (time, target, tile) = match m.mode {
            MiningMode::None => return,
            MiningMode::Entity => {
                // Mining stops, silently, when its target is gone or out of reach.
                let row = self.entity(m.serial).map(crate::handle::slot);
                match row {
                    Some(row) if in_reach(p, &self.collision_box(row), self.reach()) => {
                        let proto = usize::from(self.entities.proto[row as usize].0);
                        (self.protos.entity.mining_time[proto], Some(row), None)
                    }
                    _ => {
                        self.player_mut(pi).mining = MiningState::default();
                        return;
                    }
                }
            }
            MiningMode::ResourceTile => {
                let (tx, ty) = (m.pos.x.div_euclid(256), m.pos.y.div_euclid(256));
                let reach = self.protos.entity.resource_reach_distance[ch];
                match self.resource_at(p.surface, tx, ty) {
                    Some(res) if in_reach(p, &tile_box(tx, ty), reach) => {
                        (self.protos.resource.mining_time[usize::from(res.resource.0)], None, Some((tx, ty)))
                    }
                    _ => {
                        self.player_mut(pi).mining = MiningState::default();
                        return;
                    }
                }
            }
            MiningMode::WorldObject | MiningMode::GroundItem | MiningMode::Tile => {
                unreachable!("M0 begins no other mining")
            }
        };
        // Bit-exact: speed / (time × 60), evaluated in this order (rule 22).
        let rate = self.protos.entity.mining_speed[ch] / (time * 60.0);
        let p = self.player_mut(pi);
        if p.mining.progress < UNIT_DONE {
            p.mining.progress += rate;
        }
        if p.mining.progress < UNIT_DONE {
            return;
        }
        let main = self.main_inv(pi);
        if let Some(row) = target {
            self.mine_entity(ctx, pi, row, &main);
        } else if let Some((tx, ty)) = tile {
            self.mine_resource(ctx, pi, tx, ty, &main);
        }
    }

    /// A unit that cannot deliver its result restarts, and mining goes on while the input is held (rule 23).
    fn restart_mining(&mut self, pi: PlayerIndex) {
        let m = &mut self.player_mut(pi).mining;
        m.progress = if m.progress - 1.0 < 0.0 { 0.0 } else { m.progress - 1.0 };
    }

    /// Flying texts for what a mining unit moved, one per key in ascending order, at the character.
    fn mined_texts(&self, ctx: &mut Ctx<'_>, pi: PlayerIndex) {
        let p = self.player(pi);
        let pos = fine_pos(p.x, p.y);
        ctx.scratch.moved.sort_unstable_by_key(|x| x.0);
        for i in 0..ctx.scratch.moved.len() {
            let (k, n) = ctx.scratch.moved[i];
            self.item_delta(ctx, pi, Seq(0), k, n, pos);
        }
    }

    /// Mining an entity completes (rule 23): its contents move first, its first slots first, as far as they fit;
    /// the entity goes, with its own item, only when all of it fits.
    fn mine_entity(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex, row: u32, main: &Inv) {
        let chest = self.chest_inv(row);
        ctx.scratch.moved.clear();
        let mut short: Option<(ItemKey, i64)> = None;
        for i in 0..chest.size as usize {
            let s = self.heap.block(chest.r)[i];
            if s.count == 0 {
                continue;
            }
            let n = inventory::insert(&mut self.heap, &self.protos, main, s.key, i64::from(s.count));
            if n > 0 {
                add_moved(&mut ctx.scratch.moved, s.key, n);
            }
            let slot = &mut self.heap.block_mut(chest.r)[i];
            slot.count -= n as i32;
            if slot.count == 0 {
                inventory::clear(slot);
            } else if short.is_none() {
                short = Some((s.key, i64::from(slot.count)));
            }
        }
        let r = row as usize;
        let proto = self.entities.proto[r];
        let item_key = ItemKey(
            (self.protos.entity.item[usize::from(proto.0)].0 << 3) | u16::from(self.entities.quality[r]),
        );
        if short.is_none() && inventory::room(&self.heap, &self.protos, main, item_key, 1) == 1 {
            inventory::insert(&mut self.heap, &self.protos, main, item_key, 1);
            add_moved(&mut ctx.scratch.moved, item_key, 1);
            self.sort_main(pi, ctx.scratch);
            let (serial, x2, y2) = (self.entities.serial[r], self.entities.x2[r], self.entities.y2[r]);
            ctx.emit(
                Seq(0),
                pi,
                EventPayload::EntityMined(EntityMinedEvent { serial, proto, pos: TilePos2 { x2, y2 } }),
            );
            let h = crate::handle::make(row, self.entities.r#gen[r]);
            self.destroy_entity(h);
            self.mined_texts(ctx, pi);
            self.player_mut(pi).mining = MiningState::default();
            return;
        }
        self.sort_main(pi, ctx.scratch);
        self.mined_texts(ctx, pi);
        let (k, n) = short.unwrap_or((item_key, 1));
        self.not_fitting(ctx, pi, Seq(0), k, n);
        self.restart_mining(pi);
    }

    /// Mining a resource tile completes (rules 23, 24, 26): one unit of its yield into the main inventory, or
    /// `inventory_full` and a restart; the ore is production; a depleted tile stops mining.
    fn mine_resource(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex, tx: i32, ty: i32, main: &Inv) {
        let surface = self.player(pi).surface;
        let res = self.resource_at(surface, tx, ty).expect("checked above");
        let key = inventory::key_of(self.protos.resource.yield_id[usize::from(res.resource.0)]);
        if inventory::room(&self.heap, &self.protos, main, key, 1) < 1 {
            self.not_fitting(ctx, pi, Seq(0), key, 1);
            self.restart_mining(pi);
            return;
        }
        self.make_modified(surface, tx, ty, tx + 1, ty + 1);
        inventory::insert(&mut self.heap, &self.protos, main, key, 1);
        self.sort_main(pi, ctx.scratch);
        Counters::add(&mut ctx.counters.produced, item_stat(key), 1.0);
        let depleted = self.deplete_resource(surface, tx, ty);
        ctx.scratch.moved.clear();
        ctx.scratch.moved.push((key, 1));
        self.mined_texts(ctx, pi);
        if depleted {
            self.player_mut(pi).mining = MiningState::default();
            return;
        }
        let m = &mut self.player_mut(pi).mining;
        m.progress = if m.progress - 1.0 < 0.0 { 0.0 } else { m.progress - 1.0 };
    }

    /// One tick of the head of a character's crafting queue (I §3.9; rules 22, 25, 26).
    fn craft_tick(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex) {
        let Some(e) = self.player(pi).crafting_queue.first().copied() else {
            return;
        };
        let r = usize::from(e.recipe.0);
        // Bit-exact: speed / (energy_required × 60), in this order (no bonuses in M0).
        let speed = self.protos.entity.crafting_speed[self.character_proto()];
        let rate = speed / (self.protos.recipe.energy_required[r] * 60.0);
        let waited = e.progress >= UNIT_DONE; // completed in an earlier tick: paused since
        let head = &mut self.player_mut(pi).crafting_queue[0];
        if head.progress < UNIT_DONE {
            head.progress += rate;
        }
        if head.progress < UNIT_DONE {
            return;
        }
        let main = self.main_inv(pi);
        let mut products = std::mem::take(&mut ctx.scratch.moved);
        products.clear();
        for x in self.protos.recipe.products.get(r) {
            products.push((inventory::key_of(x.id), x.amount as i64));
        }
        // Crafting pauses while the product cannot fit, and says so once, in the tick the unit completes.
        if !self.fits_all(&main, &products, ctx.scratch) {
            if !waited && let Some(&(k, n)) = products.first() {
                self.not_fitting(ctx, pi, Seq(0), k, n);
            }
            ctx.scratch.moved = products;
            return;
        }
        let size = self.main_size();
        let p = self.player(pi);
        ctx.scratch.inner.take(&self.heap, p.main, size, &p.hand);
        for &(k, n) in &products {
            inventory::insert(&mut self.heap, &self.protos, &main, k, n);
        }
        self.sort_main(pi, ctx.scratch);
        for &(k, n) in &products {
            Counters::add(&mut ctx.counters.produced, item_stat(k), n as f64);
            Counters::add(&mut ctx.counters.handcrafted, item_stat(k), n as f64);
            self.player_mut(pi).hand_crafted += n as f64;
        }
        for ing in self.protos.recipe.ingredients.get(r) {
            Counters::add(&mut ctx.counters.consumed, item_stat(inventory::key_of(ing.id)), ing.amount);
        }
        ctx.emit(Seq(0), pi, EventPayload::ItemCrafted(ItemCraftedEvent { recipe: e.recipe, count: 1 }));
        let p = self.player(pi);
        let pos = fine_pos(p.x, p.y);
        for &(k, n) in &products {
            self.item_delta(ctx, pi, Seq(0), k, n, pos);
        }
        let p = self.player(pi);
        if ctx.scratch.inner.differs(&self.heap, p.main, size, &p.hand) {
            let p = self.player_mut(pi);
            p.inventory_version = p.inventory_version.wrapping_add(1);
        }
        let q = &mut self.player_mut(pi).crafting_queue;
        q[0].count -= 1;
        q[0].progress = if q[0].progress - 1.0 < 0.0 { 0.0 } else { q[0].progress - 1.0 };
        if q[0].count == 0 {
            q.remove(0);
        }
        ctx.scratch.moved = products;
    }
}

/// Adds `n` of `key` to a moved-items list (insertion order; sorted when the texts are written).
fn add_moved(list: &mut Vec<(ItemKey, i64)>, key: ItemKey, n: i64) {
    match list.iter_mut().find(|x| x.0 == key) {
        Some(x) => x.1 += n,
        None => list.push((key, n)),
    }
}
