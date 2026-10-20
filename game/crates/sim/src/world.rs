//! The World (10 §4.4–§4.5): the authoritative simulation state, exactly what the save sections hold, plus
//! the derived indexes a load rebuilds in canonical order (§8.1 "Derived, rebuilt on load").
//!
//! Only `World::tick` (tick.rs) and loading change a World (D1); everything here that mutates is called from
//! them. The entity lifecycle keeps every derived index in step: the serial index, the per-shard serial
//! buckets of the digest slices (§4.8), each chunk's entity list and occupancy, and the scheduler.

use crate::chunks::{ChunkStore, map_bounds, tile_chunk, tile_chunk_key, tile_index};
use crate::r#gen::{ContainerPool, EntityTable, Globals, Stat, Timer, WorldgenRequest, shard_of_timer};
use crate::handle::{self, SerialIndex};
use crate::heap::SlotHeap;
use crate::index::{BlockList, ShardBuckets};
use crate::players::Players;
use crate::rng::RngStreams;
use crate::sched::Scheduler;
use schema::{
    ChunkKey, Direction, EntityFlags, EntityHandle, EntityId, EntityType, PoolKind, Protos, SHARDS, Serial,
    StatKey, SurfaceIndex, Tick, TileId, TimerEvent, chunk_key,
};
use std::sync::Arc;

/// A work timer's key (§4.6, §8.1): its saved fields in their canonical order `(due, serial, event, owner)`.
pub type TimerKey = (Tick, Serial, TimerEvent, u32);

/// A worldgen request's key (§5.18, §8.1): `(commit_tick, surface, cy, cx)`, the order a tick commits in.
pub type PendingKey = (Tick, SurfaceIndex, i32, i32);

/// The digest shard of a work timer (sections.yaml `timer`).
pub const fn timer_shard(k: &TimerKey) -> u32 {
    shard_of_timer(k.1, k.3)
}

/// The digest shard of a worldgen request: its chunk's key (sections.yaml `chunk`).
pub const fn pending_shard(k: &PendingKey) -> u32 {
    chunk_key(k.3, k.2).0 % SHARDS
}

/// The tiles an entity may occupy: the chunk-key range (§4.4: ±1,048,576 tiles, Factorio's map size).
pub const TILE_LIMIT: i64 = 1 << 20;

/// What a new entity is made of (the entity-table row's columns that its creator chooses).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NewEntity {
    pub proto: EntityId,
    pub surface: u8,
    pub x2: i32,
    pub y2: i32,
    pub dir: Direction,
    pub flip: u8,
    pub quality: u8,
    /// 0 unknown, 1 agent, 2 Constructor, 16 + i player i (S1).
    pub built_by: u8,
    pub flags: EntityFlags,
    pub built_tick: Tick,
}

/// An entity's footprint: the tiles it covers, upper bounds exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Footprint {
    pub tx0: i32,
    pub ty0: i32,
    pub tx1: i32,
    pub ty1: i32,
}

/// [`World::footprint`] without a World. The arithmetic is in `i64`, so no coordinate a save or an action can
/// hold overflows it.
pub fn footprint_of(protos: &Protos, proto: EntityId, x2: i32, y2: i32) -> Option<Footprint> {
    let p = usize::from(proto.0);
    let (w, h) = (i64::from(*protos.entity.size_w.get(p)?), i64::from(*protos.entity.size_h.get(p)?));
    let (x2, y2) = (i64::from(x2), i64::from(y2));
    if (x2 - w).rem_euclid(2) != 0 || (y2 - h).rem_euclid(2) != 0 {
        return None;
    }
    let (tx0, ty0, tx1, ty1) = ((x2 - w) / 2, (y2 - h) / 2, (x2 + w) / 2, (y2 + h) / 2);
    // The centre's tile (x2 >> 1) lies inside [tx0, tx1] for every size, so this bounds it too.
    if tx0 < -TILE_LIMIT || ty0 < -TILE_LIMIT || tx1 > TILE_LIMIT || ty1 > TILE_LIMIT {
        return None;
    }
    Some(Footprint { tx0: tx0 as i32, ty0: ty0 as i32, tx1: tx1 as i32, ty1: ty1 as i32 })
}

/// The pool of an entity type (state.yaml `PoolKind`; M0 has chests only).
pub fn pool_kind(t: EntityType) -> Option<PoolKind> {
    // A type without a pool cannot be created: the milestone's capability manifest excludes it (§2.4).
    if t == EntityType::Chest { Some(PoolKind::Container) } else { None }
}

/// The World.
#[derive(Clone, Debug)]
pub struct World {
    pub protos: Arc<Protos>,
    /// `GLOBALS` (§8.1).
    pub globals: Globals,
    /// `ENTITY_TABLE` (§4.5).
    pub entities: EntityTable,
    /// `POOL_CONTAINER`.
    pub containers: ContainerPool,
    /// `SLOT_HEAP`.
    pub heap: SlotHeap,
    /// `CHUNKS` and `GENERATED`.
    pub chunks: ChunkStore,
    /// `PLAYERS`.
    pub players: Players,
    /// `STATS`, ascending by key (private: its shard index follows every insertion).
    stats: Vec<Stat>,
    /// `TIMERS`: the work timers in fire order (§4.6).
    timers: BlockList<TimerKey>,
    /// `RNG`.
    pub rng: RngStreams,
    /// `WORLDGEN_PENDING`, in commit order (§5.18).
    pending: BlockList<PendingKey>,
    /// Derived: live serial → handle (§4.3).
    pub(crate) serials: SerialIndex,
    /// Derived: per digest shard, the live serials, the statistics keys, the work timers and the worldgen
    /// requests that fall in it (§4.8; C2a-r1 finding 10).
    pub(crate) shards: ShardBuckets<Serial>,
    pub(crate) stat_shards: ShardBuckets<StatKey>,
    pub(crate) timer_shards: ShardBuckets<TimerKey>,
    pub(crate) pending_shards: ShardBuckets<PendingKey>,
    /// Derived: active sets, wake sequence numbers, registrations and wake timers (§4.6).
    pub sched: Scheduler,
    /// Derived from the prototypes: how far any collision box reaches from its entity's centre (spatial.rs).
    pub(crate) entity_reach: f64,
}

impl World {
    /// An empty world with these globals: no chunk, entity or player.
    pub fn new(protos: Arc<Protos>, globals: Globals) -> Self {
        let mut sched = Scheduler::new();
        sched.reset(globals.tick.0);
        let entity_reach = crate::spatial::max_entity_reach(&protos);
        Self {
            protos,
            globals,
            entities: EntityTable::new(),
            containers: ContainerPool::new(),
            heap: SlotHeap::new(),
            chunks: ChunkStore::new(),
            players: Players::new(),
            stats: Vec::new(),
            timers: BlockList::new(),
            rng: RngStreams::default(),
            pending: BlockList::new(),
            serials: SerialIndex::new(),
            shards: ShardBuckets::new(),
            stat_shards: ShardBuckets::new(),
            timer_shards: ShardBuckets::new(),
            pending_shards: ShardBuckets::new(),
            sched,
            entity_reach,
        }
    }

    // ------------------------------------------------------------------------------------------- records

    /// `STATS` in key order.
    pub fn stats(&self) -> &[Stat] {
        &self.stats
    }

    /// The statistics record of `key`, made by `make` when the key is new (its shard index follows).
    pub fn stat_mut(&mut self, key: StatKey, make: impl FnOnce() -> Stat) -> &mut Stat {
        let i = match self.stats.binary_search_by(|x| x.key.cmp(&key)) {
            Ok(i) => i,
            Err(i) => {
                self.stats.insert(i, make());
                self.stat_shards.insert(key.0 % SHARDS, key);
                i
            }
        };
        &mut self.stats[i]
    }

    /// Every statistics record, in key order, for changes that keep the keys (phase 15's flush).
    pub fn stats_mut(&mut self) -> &mut [Stat] {
        &mut self.stats
    }

    /// Replaces `STATS` (a load): sorted by key, each key once.
    pub(crate) fn set_stats(&mut self, stats: Vec<Stat>) {
        self.stat_shards.clear();
        for s in &stats {
            self.stat_shards.insert(s.key.0 % SHARDS, s.key);
        }
        self.stats = stats;
    }

    /// The position of a statistics record in `STATS` (its slice key − 1, rule 38).
    pub(crate) fn stat_position(&self, key: StatKey) -> Option<usize> {
        self.stats.binary_search_by(|x| x.key.cmp(&key)).ok()
    }

    /// The work timers in fire order.
    pub fn timers(&self) -> &BlockList<TimerKey> {
        &self.timers
    }

    /// Schedules a work timer (§4.6: due no earlier than the next tick); `false` when it was there already.
    pub fn add_timer(&mut self, k: TimerKey) -> bool {
        let fresh = self.timers.insert(k);
        if fresh {
            self.timer_shards.insert(timer_shard(&k), k);
        }
        fresh
    }

    pub fn remove_timer(&mut self, k: &TimerKey) -> bool {
        let had = self.timers.remove(k);
        if had {
            self.timer_shards.remove(timer_shard(k), k);
        }
        had
    }

    /// The first work timer if it is due at `tick` or before, removed.
    pub fn pop_due_timer(&mut self, tick: u32) -> Option<TimerKey> {
        let k = *self.timers.first()?;
        if k.0.0 > tick {
            return None;
        }
        self.remove_timer(&k);
        Some(k)
    }

    /// The worldgen requests in commit order.
    pub fn pending(&self) -> &BlockList<PendingKey> {
        &self.pending
    }

    /// A worldgen request (§5.18); `false` when it was there already.
    pub fn add_pending(&mut self, k: PendingKey) -> bool {
        let fresh = self.pending.insert(k);
        if fresh {
            self.pending_shards.insert(pending_shard(&k), k);
        }
        fresh
    }

    pub fn remove_pending(&mut self, k: &PendingKey) -> bool {
        let had = self.pending.remove(k);
        if had {
            self.pending_shards.remove(pending_shard(k), k);
        }
        had
    }

    /// Replaces the work timers and the worldgen requests (a load); the decoders checked their order.
    pub(crate) fn set_timers_and_pending(
        &mut self,
        timers: &[TimerKey],
        pending: &[PendingKey],
    ) -> Result<(), String> {
        self.timers = BlockList::from_sorted(timers).ok_or("TIMERS out of order")?;
        self.pending = BlockList::from_sorted(pending).ok_or("WORLDGEN_PENDING out of order")?;
        self.timer_shards.clear();
        for k in timers {
            self.timer_shards.insert(timer_shard(k), *k);
        }
        self.pending_shards.clear();
        for k in pending {
            self.pending_shards.insert(pending_shard(k), *k);
        }
        Ok(())
    }

    /// How many work timers, statistics records and worldgen requests fall in digest shard `shard`.
    pub fn timer_shards_len(&self, shard: u32) -> usize {
        self.timer_shards.bucket(shard).len()
    }

    pub fn stat_shards_len(&self, shard: u32) -> usize {
        self.stat_shards.bucket(shard).len()
    }

    pub fn pending_shards_len(&self, shard: u32) -> usize {
        self.pending_shards.bucket(shard).len()
    }

    /// The `WORLDGEN_PENDING` record of a request's key.
    pub fn pending_record(k: &PendingKey) -> WorldgenRequest {
        WorldgenRequest { commit_tick: k.0, surface: k.1, cy: k.2, cx: k.3 }
    }

    /// The tick the world is at (the last tick run; 0 for a new world).
    pub fn current_tick(&self) -> u32 {
        self.globals.tick.0
    }

    // ------------------------------------------------------------------------------------------- entities

    /// The handle of a live entity, by serial (§4.3; never by position, D23).
    pub fn entity(&self, s: Serial) -> Option<EntityHandle> {
        self.serials.get(s)
    }

    /// Whether `h` names a live entity at its current generation.
    pub fn is_live(&self, h: EntityHandle) -> bool {
        let row = handle::slot(h);
        self.entities.is_live(row) && self.entities.r#gen[row as usize] == handle::generation(h)
    }

    /// The serial of the live entity `h` names; none (0) for a handle whose row was freed or handed out again
    /// (its generation differs), so a stale handle never turns into another entity's serial (C2a-r1 finding 6).
    pub fn serial_of(&self, h: EntityHandle) -> Serial {
        if !self.is_live(h) {
            return Serial::NONE;
        }
        self.entities.serial[handle::slot(h) as usize]
    }

    /// The number of live entities (the digest's `entity_count`, golden rule 27: entity-table rows, not
    /// characters).
    pub fn entity_count(&self) -> u32 {
        self.serials.len() as u32
    }

    /// The live entities' handles in ascending serial (the canonical order of D3).
    pub fn entities_by_serial(&self) -> Vec<EntityHandle> {
        let mut v: Vec<(Serial, EntityHandle)> = (0..self.entities.rows())
            .filter(|&r| self.entities.is_live(r))
            .map(|r| (self.entities.serial[r as usize], handle::make(r, self.entities.r#gen[r as usize])))
            .collect();
        v.sort_unstable_by_key(|x| x.0);
        v.into_iter().map(|x| x.1).collect()
    }

    /// The tiles an entity of `proto` centred at `(x2, y2)` covers; `None` for an unknown prototype, a centre
    /// whose parity does not fit the size (§4.2: odd sizes centre on tile centres, even ones on tile corners),
    /// or a footprint outside the chunk-key range (§4.4), so no chunk key ever aliases (C2a-r1 finding 2).
    pub fn footprint(&self, proto: EntityId, x2: i32, y2: i32) -> Option<Footprint> {
        footprint_of(&self.protos, proto, x2, y2)
    }

    /// The chunk keys a footprint touches, ascending by (cy, cx) walk order and deduplicated.
    fn footprint_chunks(f: &Footprint) -> impl Iterator<Item = ChunkKey> {
        let (cx0, cx1) = (tile_chunk(f.tx0), tile_chunk((f.tx1 - 1).max(f.tx0)));
        let (cy0, cy1) = (tile_chunk(f.ty0), tile_chunk((f.ty1 - 1).max(f.ty0)));
        (cx0..=cx1).flat_map(move |cx| (cy0..=cy1).map(move |cy| schema::chunk_key(cx, cy)))
    }

    /// Creates an entity (§4.5): the lowest free entity-table row, its generation raised (rule 28), the next
    /// serial, a row in its kind's pool and its inventory block; every derived index updated; the rule and
    /// entity view versions of each chunk it touches raised (§4.4, rule 6). The chunks it touches must be
    /// modified (a build first makes a pristine chunk modified). Returns its serial and handle.
    pub fn create_entity(&mut self, e: &NewEntity) -> Result<(Serial, EntityHandle), String> {
        let p = usize::from(e.proto.0);
        let t =
            *self.protos.entity.r#type.get(p).ok_or_else(|| format!("no entity prototype {}", e.proto.0))?;
        let kind = pool_kind(t).ok_or_else(|| format!("entity type {t:?} has no pool in this milestone"))?;
        let f = self
            .footprint(e.proto, e.x2, e.y2)
            .ok_or("the centre's parity does not fit the footprint, or it lies outside the chunk range")?;
        if !(self.in_map(f.tx0, f.ty0) && self.in_map(f.tx1 - 1, f.ty1 - 1)) {
            return Err("the footprint leaves the map".to_owned());
        }
        if usize::from(e.surface) >= self.globals.surfaces.len() {
            return Err(format!("no surface {}", e.surface));
        }
        let surface = SurfaceIndex(u16::from(e.surface));
        for k in Self::footprint_chunks(&f) {
            if !self.chunks.is_modified(surface, k) {
                return Err(format!("chunk {:#x} under the footprint is not modified", k.0));
            }
        }
        let serial = self.globals.next_serial;
        // D7: the serial counter never wraps (serials are never reused, §4.3); 2³² creations end the world.
        let next = serial.0.checked_add(1).ok_or("the serial counter is exhausted")?;
        // Rows first, so that a full pool refuses before anything changes.
        let row = self.entities.alloc().ok_or("the entity table is full")?;
        let pool_slot = match kind {
            PoolKind::Container => self.containers.alloc(),
        };
        let Some(pool_slot) = pool_slot else {
            self.entities.free(row);
            return Err(format!("the {kind:?} pool is full"));
        };
        self.globals.next_serial = Serial(next);
        let r = row as usize;
        let generation = handle::next_generation(self.entities.r#gen[r]);
        let h = handle::make(row, generation);
        let center = tile_chunk_key(e.x2 >> 1, e.y2 >> 1);
        self.entities.proto[r] = e.proto;
        self.entities.kind[r] = kind;
        self.entities.surface[r] = e.surface;
        self.entities.dir[r] = e.dir;
        self.entities.flip[r] = e.flip;
        self.entities.quality[r] = e.quality;
        self.entities.built_by[r] = e.built_by;
        self.entities.x2[r] = e.x2;
        self.entities.y2[r] = e.y2;
        self.entities.chunk[r] = center;
        self.entities.flags[r] = e.flags;
        self.entities.serial[r] = serial;
        self.entities.r#gen[r] = generation;
        self.entities.built_tick[r] = e.built_tick;
        self.entities.pool_slot[r] = pool_slot;
        match kind {
            PoolKind::Container => {
                let slots = u32::from(self.protos.entity.inventory_slots[p]);
                self.containers.entity[pool_slot as usize] = h;
                self.containers.inv[pool_slot as usize] = self.heap.alloc(slots);
            }
        }
        self.serials.insert(serial, h);
        self.shards.insert(serial.0 % SHARDS, serial);
        self.place(row, &f, surface, center, true);
        Ok((serial, h))
    }

    /// Adds or removes an entity's derived chunk entries and raises the versions of the chunks it touches.
    fn place(&mut self, row: u32, f: &Footprint, surface: SurfaceIndex, center: ChunkKey, add: bool) {
        if let Some(c) = self.chunks.get_mut(surface, center) {
            if add {
                c.add_entity(row);
            } else {
                c.remove_entity(row);
            }
        }
        for ty in f.ty0..f.ty1 {
            for tx in f.tx0..f.tx1 {
                if let Some(c) = self.chunks.at_tile_mut(surface, tx, ty) {
                    c.set_occupant(tile_index(tx, ty), add.then_some(row));
                }
            }
        }
        for k in Self::footprint_chunks(f) {
            if let Some(c) = self.chunks.get_mut(surface, k) {
                // §4.4: the rule version rises with every change of a chunk's entities (wrapping, D7).
                c.rec.rule_version = c.rec.rule_version.wrapping_add(1);
                c.view.entities = c.view.entities.wrapping_add(1);
            }
        }
    }

    /// Destroys a live entity (§4.5): its inventory block is freed (zeroed), its pool and entity-table rows
    /// return to their defaults (the handle generation stays, so stale handles fail), and every derived index
    /// forgets it; the chunks it touched get their versions raised. (A pool whose entities sleep drops their
    /// registrations here too, `Scheduler::forget`, §4.6; M0's chests never sleep.)
    pub fn destroy_entity(&mut self, h: EntityHandle) {
        assert!(self.is_live(h), "destroying a dead entity {:#x}", h.0);
        let row = handle::slot(h);
        let r = row as usize;
        let serial = self.entities.serial[r];
        let surface = SurfaceIndex(u16::from(self.entities.surface[r]));
        let center = tile_chunk_key(self.entities.x2[r] >> 1, self.entities.y2[r] >> 1);
        let f = self
            .footprint(self.entities.proto[r], self.entities.x2[r], self.entities.y2[r])
            .unwrap_or(Footprint { tx0: 0, ty0: 0, tx1: 0, ty1: 0 });
        match self.entities.kind[r] {
            PoolKind::Container => {
                let slot = self.entities.pool_slot[r];
                self.heap.free(self.containers.inv[slot as usize]);
                self.containers.free(slot);
            }
        }
        self.entities.free(row);
        self.serials.remove(serial);
        self.shards.remove(serial.0 % SHARDS, &serial);
        self.place(row, &f, surface, center, false);
    }

    /// NO_SLEEP (D18 b, `sim_set_flags` bit 0): every live entity of a pool that updates is active every tick,
    /// and every wake mechanism is bypassed. M0's only pool (chests) has no update, so there is nothing to
    /// activate yet; the pools of M1 activate their live slots here.
    pub fn set_no_sleep(&mut self, on: bool) {
        self.sched.set_no_sleep(on);
    }

    // ------------------------------------------------------------------------------------------- map

    /// The tile at `(tx, ty)` of a modified chunk; `None` outside every modified chunk (a pristine chunk's
    /// tiles come from worldgen's regeneration cache, C2b).
    pub fn tile_at(&self, surface: SurfaceIndex, tx: i32, ty: i32) -> Option<TileId> {
        self.chunks.at_tile(surface, tx, ty).map(|c| c.tile(tx, ty))
    }

    /// Whether `(tx, ty)` lies inside the map (golden rule 1).
    pub fn in_map(&self, tx: i32, ty: i32) -> bool {
        map_bounds(self.globals.map.width, self.globals.map.height).contains(tx, ty)
    }

    // ------------------------------------------------------------------------------------------- derived

    /// Rebuilds every derived index from the saved state, in canonical order (§8.1): the serial index, the
    /// per-shard buckets, each entity's chunk, each chunk's entity list and occupancy, and the scheduler
    /// (every entity awake). Called by loading; the heap's ownership is rebuilt by `SlotHeap::from_record`.
    pub fn rebuild_derived(&mut self) {
        self.serials = SerialIndex::with_capacity(self.entities.rows() as usize);
        self.shards.clear();
        self.chunks.clear_derived();
        self.sched.reset(self.current_tick());
        let mut live: Vec<(Serial, u32)> = Vec::new();
        for row in 0..self.entities.rows() {
            if !self.entities.is_live(row) {
                continue;
            }
            live.push((self.entities.serial[row as usize], row));
        }
        live.sort_unstable();
        for (serial, row) in live {
            let r = row as usize;
            let h = handle::make(row, self.entities.r#gen[r]);
            self.serials.insert(serial, h);
            self.shards.insert(serial.0 % SHARDS, serial);
            let (x2, y2) = (self.entities.x2[r], self.entities.y2[r]);
            let center = tile_chunk_key(x2 >> 1, y2 >> 1);
            self.entities.chunk[r] = center;
            let surface = SurfaceIndex(u16::from(self.entities.surface[r]));
            if let Some(f) = self.footprint(self.entities.proto[r], x2, y2) {
                if let Some(c) = self.chunks.get_mut(surface, center) {
                    c.add_entity(row);
                }
                for ty in f.ty0..f.ty1 {
                    for tx in f.tx0..f.tx1 {
                        if let Some(c) = self.chunks.at_tile_mut(surface, tx, ty) {
                            c.set_occupant(tile_index(tx, ty), Some(row));
                        }
                    }
                }
            }
        }
    }

    /// Checks the cross-section invariants a save must keep (a load refuses a world that breaks them:
    /// ERR_LOAD_FORMAT, "corrupt"). Each live entity: a known prototype of its kind's type, a generation in
    /// 1 … 1,023, a serial below the counter and unique, a centre whose parity fits its size, its chunks
    /// modified, a pool row that names it back; each live pool row: a live entity that names it. Players'
    /// characters: unique serials below the counter that no entity has.
    pub fn check_invariants(&self) -> Result<(), String> {
        let next = self.globals.next_serial.0;
        let surfaces = self.globals.surfaces.len();
        let mut seen: Vec<u32> = Vec::new();
        for row in 0..self.entities.rows() {
            if !self.entities.is_live(row) {
                if self.entities.r#gen[row as usize] > handle::GEN_MAX {
                    return Err(format!(
                        "entity-table row {row}: generation {}",
                        self.entities.r#gen[row as usize]
                    ));
                }
                continue;
            }
            let r = row as usize;
            let serial = self.entities.serial[r].0;
            let g = self.entities.r#gen[r];
            if g == 0 || g > handle::GEN_MAX {
                return Err(format!("entity {serial}: generation {g}"));
            }
            if serial >= next {
                return Err(format!("entity {serial} is not below the serial counter {next}"));
            }
            seen.push(serial);
            let proto = usize::from(self.entities.proto[r].0);
            let Some(&t) = self.protos.entity.r#type.get(proto) else {
                return Err(format!("entity {serial}: no entity prototype {proto}"));
            };
            if pool_kind(t) != Some(self.entities.kind[r]) {
                return Err(format!("entity {serial}: a {t:?} in the {:?} pool", self.entities.kind[r]));
            }
            if usize::from(self.entities.surface[r]) >= surfaces {
                return Err(format!("entity {serial}: no surface {}", self.entities.surface[r]));
            }
            let Some(f) = self.footprint(self.entities.proto[r], self.entities.x2[r], self.entities.y2[r])
            else {
                return Err(format!("entity {serial}: its centre's parity does not fit its size"));
            };
            let surface = SurfaceIndex(u16::from(self.entities.surface[r]));
            if Self::footprint_chunks(&f).any(|k| !self.chunks.is_modified(surface, k)) {
                return Err(format!("entity {serial} stands in a chunk that is not modified"));
            }
            match self.entities.kind[r] {
                PoolKind::Container => {
                    let slot = self.entities.pool_slot[r];
                    let back = self.containers.entity.get(slot as usize).copied();
                    if !self.containers.is_live(slot) || back != Some(handle::make(row, g)) {
                        return Err(format!("entity {serial}: its container row {slot} does not name it"));
                    }
                }
            }
        }
        for slot in 0..self.containers.rows() {
            if !self.containers.is_live(slot) {
                continue;
            }
            let h = self.containers.entity[slot as usize];
            let row = handle::slot(h);
            if !self.is_live(h)
                || self.entities.kind[row as usize] != PoolKind::Container
                || self.entities.pool_slot[row as usize] != slot
            {
                return Err(format!("container row {slot} names an entity that does not name it"));
            }
        }
        seen.sort_unstable();
        if seen.windows(2).any(|w| w[0] == w[1]) {
            return Err("two entities share a serial".to_owned());
        }
        let mut chars: Vec<u32> = Vec::new();
        for p in self.players.iter() {
            let c = p.character.0;
            if c == 0 {
                continue;
            }
            if c >= next || seen.binary_search(&c).is_ok() || chars.contains(&c) {
                return Err(format!(
                    "player {}: character serial {c} is reused or not below the counter",
                    p.index.0
                ));
            }
            chars.push(c);
        }
        Ok(())
    }

    /// D6: the first NaN in the state a tick writes every tick (the pools' float columns, the players'
    /// positions and progress), as `(where, index)`. Builds with `simcheck` run it after every phase, so a NaN
    /// names its phase in tests instead of desyncing later; the encoders refuse NaN everywhere else (saves,
    /// digests, the boundary).
    pub fn nan_scan(&self) -> Option<(&'static str, u32)> {
        if let Some(x) = self.entities.nan_scan() {
            return Some(x);
        }
        if let Some(x) = self.containers.nan_scan() {
            return Some(x);
        }
        for p in self.players.iter() {
            let i = u32::from(p.index.0);
            if p.x.is_nan() || p.y.is_nan() {
                return Some(("player.position", i));
            }
            if p.mining.progress.is_nan() {
                return Some(("player.mining.progress", i));
            }
            if p.hand_crafted.is_nan() || p.crafting_queue.iter().any(|e| e.progress.is_nan()) {
                return Some(("player.crafting", i));
            }
        }
        None
    }

    /// The `TIMERS` record of a work timer's key.
    #[inline]
    pub fn timer_record(k: &TimerKey) -> Timer {
        Timer { due: k.0, serial: k.1, event: k.2, owner: k.3 }
    }
}
