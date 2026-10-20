//! Loading a save made with other prototypes (10 §8.3; golden README rule 42): the shell builds a remap table
//! per prototype kind from the save's name tables (old id → new id, `0xFFFF` removed, with the save's name of
//! each removed id), and the load rewrites every saved field whose type is a prototype id or an item key
//! before the World is built. What disappears is listed in the load report, ascending by (kind, name).
//!
//! The golden model's decisions (rule 42, test/golden/model/remap.ts), for M0's state:
//! - an item key keeps its quality bits; a removed item empties every slot and hand holding it (a ghost
//!   cursor goes without counting) and its statistics record goes; the count is the items lost;
//! - a removed entity prototype removes every entity of it with its inventory, whose items are not counted
//!   again; the count is the entities;
//! - a removed recipe drops its crafting-queue entries (their ingredients were taken at enqueue, §5.1); the
//!   count is the crafts dropped.
//!
//! Beyond the model (its M0 state has none of these, C2 decisions): filters on a removed item go; ground
//! items of a removed item are lost and counted; resource tiles and world objects of a removed prototype go,
//! counted by tile and by object; tiles, resources and world objects are renumbered like everything else;
//! a removed tile cannot be represented, so the load is refused (`ERR_PROTOS`); crafting-queue `parent`
//! links follow their entries.

use crate::r#gen::{Chunk, ContainerPool, EntityTable, Player, SlotHeap as SlotHeapRecord, Stat};
use crate::heap::{EMPTY_SLOT, class_slots, inv_block, inv_class};
use crate::{SimError, SimResult};
use schema::{
    EntityId, ItemKey, ProtoKind, Protos, RecipeId, RemapTable, ResourceId, SimStatus, StatKey, TileId,
    WorldObjectId,
};

/// "Removed" in a remap table.
pub const REMOVED: u16 = 0xFFFF;

/// One parsed remap table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Remap {
    pub kind: ProtoKind,
    /// Old id → new id, `REMOVED` for gone.
    pub ids: Vec<u16>,
    /// The save's name of each removed id, ascending by old id.
    pub removed: Vec<String>,
}

/// A removed prototype the state used (abi.yaml `removed_proto`).
pub use schema::RemovedProto;

fn input(m: impl Into<String>) -> SimError {
    SimError::new(SimStatus::ErrInput, m)
}

/// The number of prototypes this build has of a kind.
pub fn build_count(p: &Protos, k: ProtoKind) -> usize {
    match k {
        ProtoKind::Item => p.item.len(),
        ProtoKind::Fluid => p.fluid.len(),
        ProtoKind::Recipe => p.recipe.len(),
        ProtoKind::Entity => p.entity.len(),
        ProtoKind::Technology => p.technology.len(),
        ProtoKind::Resource => p.resource.len(),
        ProtoKind::Tile => p.tile.len(),
        ProtoKind::WorldObject => p.world_object.len(),
        ProtoKind::Signal => p.signal.len(),
    }
}

/// Checks and parses `LoadInput`'s remap tables: one per kind at most; every new id this build's or removed;
/// as many names as removed ids, each valid UTF-8. Anything else is `ERR_INPUT`.
pub fn parse_tables(tables: &[RemapTable<'_>], protos: &Protos) -> SimResult<Vec<Remap>> {
    let mut out: Vec<Remap> = Vec::with_capacity(tables.len());
    for t in tables {
        let kind = u8::try_from(t.kind)
            .ok()
            .and_then(ProtoKind::from_value)
            .ok_or_else(|| input("RemapTable.kind"))?;
        if out.iter().any(|r| r.kind == kind) {
            return Err(input(format!("two remap tables for {}", kind.name())));
        }
        let ids: Vec<u16> = t.ids.iter().collect();
        let n = build_count(protos, kind);
        if let Some(&bad) = ids.iter().find(|&&v| v != REMOVED && usize::from(v) >= n) {
            return Err(input(format!("remap of {}: new id {bad}, this build has {n}", kind.name())));
        }
        let gone = ids.iter().filter(|&&v| v == REMOVED).count();
        let mut removed = Vec::with_capacity(t.removed.len());
        let mut bad_utf8 = false;
        t.removed.for_each(|r| match core::str::from_utf8(r.name) {
            Ok(s) => removed.push(s.to_owned()),
            Err(_) => bad_utf8 = true,
        });
        if bad_utf8 || removed.len() != gone {
            return Err(input(format!(
                "remap of {}: {gone} removed ids, {} names",
                kind.name(),
                removed.len()
            )));
        }
        out.push(Remap { kind, ids, removed });
    }
    Ok(out)
}

/// The decoded sections a remap rewrites, before the World is built from them.
#[derive(Debug)]
pub struct RawState<'a> {
    pub entities: &'a mut EntityTable,
    pub containers: &'a mut ContainerPool,
    pub heap: &'a mut SlotHeapRecord,
    pub players: &'a mut Vec<Player>,
    pub stats: &'a mut Vec<Stat>,
    pub chunks: &'a mut Vec<Chunk>,
}

struct Tables<'a> {
    remaps: &'a [Remap],
    lost: Vec<RemovedProto>,
}

/// What an old id becomes.
enum Mapped {
    Same,
    To(u16),
    Removed,
}

impl Tables<'_> {
    fn table(&self, k: ProtoKind) -> Option<&Remap> {
        self.remaps.iter().find(|r| r.kind == k)
    }

    fn map(&self, k: ProtoKind, old: u16) -> SimResult<Mapped> {
        let Some(t) = self.table(k) else {
            return Ok(Mapped::Same);
        };
        match t.ids.get(usize::from(old)) {
            None => Err(input(format!("the state uses {} id {old}, outside the save's table", k.name()))),
            Some(&REMOVED) => Ok(Mapped::Removed),
            Some(&v) => Ok(Mapped::To(v)),
        }
    }

    /// Records `n` of the removed `old` of kind `k` as lost.
    fn lose(&mut self, k: ProtoKind, old: u16, n: u32) {
        if n == 0 {
            return;
        }
        let t = self.table(k).expect("a removed id has a table");
        let rank = t.ids[..usize::from(old)].iter().filter(|&&v| v == REMOVED).count();
        let name = t.removed[rank].clone();
        match self.lost.iter_mut().find(|r| r.kind == k && r.name == name) {
            Some(r) => r.count = r.count.saturating_add(n),
            None => self.lost.push(RemovedProto { kind: k, name, count: n }),
        }
    }

    /// An item key: the item remapped, the quality bits kept; `None` when the item is gone.
    fn item_key(&self, key: ItemKey) -> SimResult<Option<ItemKey>> {
        if key.is_none() {
            return Ok(Some(key));
        }
        Ok(match self.map(ProtoKind::Item, key.0 >> 3)? {
            Mapped::Same => Some(key),
            Mapped::To(v) => Some(ItemKey((v << 3) | (key.0 & 7))),
            Mapped::Removed => None,
        })
    }
}

/// Rewrites the state's prototype ids (§8.3); returns the removed prototypes the state used.
pub fn apply(s: &mut RawState<'_>, remaps: &[Remap]) -> SimResult<Vec<RemovedProto>> {
    let mut t = Tables { remaps, lost: Vec::new() };
    // Entities first: a removed prototype takes its entity, its container row and its inventory block.
    for row in 0..s.entities.rows() {
        if !s.entities.is_live(row) {
            continue;
        }
        let r = row as usize;
        let old = s.entities.proto[r].0;
        match t.map(ProtoKind::Entity, old)? {
            Mapped::Same => {}
            Mapped::To(v) => s.entities.proto[r] = EntityId(v),
            Mapped::Removed => {
                t.lose(ProtoKind::Entity, old, 1);
                let slot = s.entities.pool_slot[r];
                if s.containers.is_live(slot) {
                    clear_block(s.heap, s.containers.inv[slot as usize]);
                    s.containers.free(slot);
                }
                s.entities.free(row);
            }
        }
    }
    // Items in every slot (free blocks are empty), the filters, the hands, the statistics.
    if t.table(ProtoKind::Item).is_some() {
        for a in &mut s.heap.arenas {
            for slot in &mut a.slots {
                if slot.count == 0 {
                    continue;
                }
                match t.item_key(slot.key)? {
                    Some(k) => slot.key = k,
                    None => {
                        t.lose(ProtoKind::Item, slot.key.0 >> 3, slot.count as u32);
                        *slot = EMPTY_SLOT;
                    }
                }
            }
        }
        let mut filters = Vec::with_capacity(s.heap.filters.len());
        for f in &s.heap.filters {
            if let Some(k) = t.item_key(f.key)? {
                filters.push(crate::r#gen::SlotFilter { key: k, ..*f });
            }
        }
        s.heap.filters = filters;
        for p in s.players.iter_mut() {
            if p.hand.count == 0 && !p.hand.ghost {
                continue;
            }
            match t.item_key(p.hand.key)? {
                Some(k) => p.hand.key = k,
                None => {
                    if !p.hand.ghost {
                        t.lose(ProtoKind::Item, p.hand.key.0 >> 3, p.hand.count as u32);
                    }
                    p.hand =
                        crate::r#gen::Hand { key: ItemKey::NONE, ghost: false, origin: 0xFFFF, count: 0 };
                }
            }
        }
        for c in s.chunks.iter_mut() {
            let mut kept = Vec::with_capacity(c.ground_items.len());
            for g in &c.ground_items {
                match t.item_key(g.key)? {
                    Some(k) => kept.push(schema::GroundItem { key: k, ..*g }),
                    None => t.lose(ProtoKind::Item, g.key.0 >> 3, u32::from(g.count)),
                }
            }
            kept.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
            c.ground_items = kept;
        }
    }
    let mut stats = Vec::with_capacity(s.stats.len());
    for st in s.stats.drain(..) {
        let kind = st.key.0 >> 24;
        let id = st.key.0 & 0x00FF_FFFF;
        let mapped = match kind {
            1 => t.item_key(ItemKey(id as u16))?.map(|k| u32::from(k.0)),
            3 => match t.map(ProtoKind::Entity, id as u16)? {
                Mapped::Same => Some(id),
                Mapped::To(v) => Some(u32::from(v)),
                Mapped::Removed => None,
            },
            2 => match t.map(ProtoKind::Fluid, id as u16)? {
                Mapped::Same => Some(id),
                Mapped::To(v) => Some(u32::from(v)),
                Mapped::Removed => None,
            },
            _ => Some(id),
        };
        if let Some(n) = mapped {
            stats.push(Stat { key: StatKey((kind << 24) | n), ..st });
        }
    }
    stats.sort_by_key(|x| x.key);
    *s.stats = stats;
    // Recipes in the crafting queues; a dropped entry's dependants lose their parent link.
    for p in s.players.iter_mut() {
        let mut new_index = vec![0xFFFFu16; p.crafting_queue.len()];
        let mut kept = Vec::with_capacity(p.crafting_queue.len());
        for (i, e) in p.crafting_queue.iter().enumerate() {
            match t.map(ProtoKind::Recipe, e.recipe.0)? {
                Mapped::Removed => t.lose(ProtoKind::Recipe, e.recipe.0, u32::from(e.count)),
                Mapped::Same => {
                    new_index[i] = kept.len() as u16;
                    kept.push(*e);
                }
                Mapped::To(v) => {
                    new_index[i] = kept.len() as u16;
                    kept.push(crate::r#gen::CraftEntry { recipe: RecipeId(v), ..*e });
                }
            }
        }
        for e in &mut kept {
            if e.parent != 0xFFFF {
                e.parent = new_index.get(usize::from(e.parent)).copied().unwrap_or(0xFFFF);
            }
        }
        p.crafting_queue = kept;
    }
    // The map's own ids: tiles, resources, world objects.
    for c in s.chunks.iter_mut() {
        for tile in c.tiles.iter_mut() {
            *tile = match t.map(ProtoKind::Tile, u16::from(tile.0))? {
                Mapped::Same => *tile,
                Mapped::To(v) => TileId(v as u8),
                Mapped::Removed => {
                    return Err(SimError::new(
                        SimStatus::ErrProtos,
                        format!(
                            "the save's tile {} is gone from these prototypes, and a map tile cannot be removed",
                            tile.0
                        ),
                    ));
                }
            };
        }
        for h in c.hidden_tiles.iter_mut() {
            h.id = match t.map(ProtoKind::Tile, u16::from(h.id.0))? {
                Mapped::Same => h.id,
                Mapped::To(v) => TileId(v as u8),
                Mapped::Removed => {
                    return Err(SimError::new(
                        SimStatus::ErrProtos,
                        format!("hidden tile {} is gone", h.id.0),
                    ));
                }
            };
        }
        let mut res = Vec::with_capacity(c.resources.len());
        for r in &c.resources {
            match t.map(ProtoKind::Resource, r.resource.0)? {
                Mapped::Same => res.push(*r),
                Mapped::To(v) => res.push(schema::ResourceTile { resource: ResourceId(v), ..*r }),
                Mapped::Removed => t.lose(ProtoKind::Resource, r.resource.0, 1),
            }
        }
        c.resources = res;
        let mut objs = Vec::with_capacity(c.objects.len());
        for o in &c.objects {
            match t.map(ProtoKind::WorldObject, o.object.0)? {
                Mapped::Same => objs.push(*o),
                Mapped::To(v) => objs.push(schema::ObjectState { object: WorldObjectId(v), ..*o }),
                Mapped::Removed => t.lose(ProtoKind::WorldObject, o.object.0, 1),
            }
        }
        // `order: key`: renumbered objects may change their order.
        objs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        c.objects = objs;
    }
    let mut lost = t.lost;
    lost.sort_by(|a, b| (a.kind, a.name.as_bytes()).cmp(&(b.kind, b.name.as_bytes())));
    Ok(lost)
}

/// Empties a block of the raw heap record and drops its bar and filters (an entity removed by the remap).
fn clear_block(h: &mut SlotHeapRecord, r: schema::InvRef) {
    let class = inv_class(r);
    if let Some(a) = h.arenas.iter_mut().find(|a| a.class == class) {
        let n = class_slots(class) as usize;
        let base = inv_block(r) as usize * n;
        if let Some(s) = a.slots.get_mut(base..base + n) {
            s.fill(EMPTY_SLOT);
        }
    }
    h.bars.retain(|b| b.inv != r);
    h.filters.retain(|f| f.inv != r);
}
