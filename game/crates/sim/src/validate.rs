//! What a load checks beyond the decoders (10 §8.1, §8.3), in the order the load needs it: a save that breaks
//! any of these is corrupt (`ERR_LOAD_FORMAT`). C2a-r1 findings 1, 2 and 4.
//!
//! 1. [`check_references`], before any remap: every pool row and its entity name each other (whole handles),
//!    and every inventory reference names a block that exists, so a remap that removes an entity never
//!    follows a dangling reference (whose offsets would differ between native code and wasm32).
//! 2. [`check_entities`], [`check_players`] and [`check_schedules`], after the remap and before the derived
//!    indexes are built: prototypes, pools, surfaces, generations, and coordinates inside the map and the
//!    chunk-key range, so no footprint overflows and no chunk key aliases; positions finite; timers and
//!    worldgen requests in the future.
//! 3. [`check_inventories`], on the built World: each inventory's block is the canonical class for its owner's
//!    size, the slots past the size are empty, every stack is a known item at a known quality and at most a
//!    stack, limit bars and filters lie inside the size, and every hand is well formed.

use crate::chunks::map_bounds;
use crate::r#gen::{ContainerPool, EntityTable, Globals, Hand, Player, SlotHeap as SlotHeapRecord};
use crate::handle;
use crate::heap::{EMPTY_SLOT, class_for, inv_block, inv_class};
use crate::world::{TILE_LIMIT, World, footprint_of, pool_kind};
use schema::{InvRef, ItemKey, PoolKind, Protos, Slot};

fn block_exists(heap: &SlotHeapRecord, r: InvRef) -> bool {
    heap.arenas.iter().any(|a| a.class == inv_class(r) && inv_block(r) < a.blocks)
}

/// Pool rows and entities name each other; inventory references name existing blocks (finding 1).
pub fn check_references(
    entities: &EntityTable,
    containers: &ContainerPool,
    heap: &SlotHeapRecord,
    players: &[Player],
) -> Result<(), String> {
    for row in 0..entities.rows() {
        if !entities.is_live(row) {
            continue;
        }
        let r = row as usize;
        let serial = entities.serial[r].0;
        let h = handle::make(row, entities.r#gen[r]);
        match entities.kind[r] {
            PoolKind::Container => {
                let slot = entities.pool_slot[r];
                if !containers.is_live(slot) || containers.entity[slot as usize] != h {
                    return Err(format!("entity {serial}: its container row {slot} does not name it"));
                }
            }
        }
    }
    for slot in 0..containers.rows() {
        if !containers.is_live(slot) {
            continue;
        }
        let h = containers.entity[slot as usize];
        let row = handle::slot(h);
        let named = entities.is_live(row)
            && entities.r#gen[row as usize] == handle::generation(h)
            && entities.kind[row as usize] == PoolKind::Container
            && entities.pool_slot[row as usize] == slot;
        if !named {
            return Err(format!("container row {slot} names an entity that does not name it"));
        }
        let inv = containers.inv[slot as usize];
        if !block_exists(heap, inv) {
            return Err(format!(
                "container row {slot}: its inventory {:#x} is not a block of the heap",
                inv.0
            ));
        }
    }
    for p in players {
        if !p.main.is_none() && !block_exists(heap, p.main) {
            return Err(format!(
                "player {}: its inventory {:#x} is not a block of the heap",
                p.index.0, p.main.0
            ));
        }
    }
    Ok(())
}

/// Prototypes, pools, surfaces, generations and coordinates of every entity (finding 2).
pub fn check_entities(entities: &EntityTable, protos: &Protos, globals: &Globals) -> Result<(), String> {
    let bounds = map_bounds(globals.map.width, globals.map.height);
    let surfaces = globals.surfaces.len();
    for row in 0..entities.rows() {
        let r = row as usize;
        let g = entities.r#gen[r];
        if !entities.is_live(row) {
            if g > handle::GEN_MAX {
                return Err(format!("entity-table row {row}: generation {g}"));
            }
            continue;
        }
        let serial = entities.serial[r].0;
        if g == 0 || g > handle::GEN_MAX {
            return Err(format!("entity {serial}: generation {g}"));
        }
        if serial >= globals.next_serial.0 {
            return Err(format!("entity {serial} is not below the serial counter {}", globals.next_serial.0));
        }
        let proto = entities.proto[r];
        let Some(&t) = protos.entity.r#type.get(usize::from(proto.0)) else {
            return Err(format!("entity {serial}: no entity prototype {}", proto.0));
        };
        if pool_kind(t) != Some(entities.kind[r]) {
            return Err(format!("entity {serial}: a {t:?} in the {:?} pool", entities.kind[r]));
        }
        if usize::from(entities.surface[r]) >= surfaces {
            return Err(format!("entity {serial}: no surface {}", entities.surface[r]));
        }
        let (x2, y2) = (entities.x2[r], entities.y2[r]);
        let Some(f) = footprint_of(protos, proto, x2, y2) else {
            return Err(format!(
                "entity {serial}: centre ({x2}, {y2}) does not fit its size or the chunk range"
            ));
        };
        if !(bounds.contains(f.tx0, f.ty0) && bounds.contains(f.tx1 - 1, f.ty1 - 1)) {
            return Err(format!("entity {serial}: centre ({x2}, {y2}) lies outside the map"));
        }
    }
    Ok(())
}

/// Every player's position is finite and inside the chunk-key range, on an existing surface (finding 2).
pub fn check_players(players: &[Player], globals: &Globals) -> Result<(), String> {
    let lim = TILE_LIMIT as f64;
    for p in players {
        let i = p.index.0;
        if !(p.x.is_finite() && p.y.is_finite() && p.x.abs() < lim && p.y.abs() < lim) {
            return Err(format!("player {i}: position ({}, {}) outside the chunk range", p.x, p.y));
        }
        if usize::from(p.surface.0) >= globals.surfaces.len() {
            return Err(format!("player {i}: no surface {}", p.surface.0));
        }
        if (p.character.0 == 0) != p.main.is_none() {
            return Err(format!("player {i}: a character without an inventory, or an inventory without one"));
        }
    }
    Ok(())
}

/// Work timers and worldgen requests lie in the future, and requests name chunks of the key range (finding 2).
pub fn check_schedules(w: &World) -> Result<(), String> {
    let t = w.current_tick();
    if let Some(k) = w.timers().first()
        && k.0.0 <= t
    {
        return Err(format!("a work timer due at tick {} in a save at tick {t}", k.0.0));
    }
    for &(commit, _, cy, cx) in w.pending().iter() {
        if commit.0 <= t {
            return Err(format!("a worldgen request committing at tick {} in a save at tick {t}", commit.0));
        }
        if !(-32_768..32_768).contains(&cx) || !(-32_768..32_768).contains(&cy) {
            return Err(format!("a worldgen request for chunk ({cx}, {cy}) outside the key range"));
        }
    }
    Ok(())
}

/// A stack's key names a known item at a known quality (tier index 0–4, §4.3) and holds at most a stack.
fn check_stack(protos: &Protos, s: &Slot, what: &str) -> Result<(), String> {
    if *s == EMPTY_SLOT {
        return Ok(());
    }
    let item = usize::from(s.key.0 >> 3);
    let Some(&stack) = protos.item.stack_size.get(item) else {
        return Err(format!("{what}: no item {item}"));
    };
    if s.key.0 & 7 > 4 {
        return Err(format!("{what}: quality {}", s.key.0 & 7));
    }
    if s.count < 1 || s.count as u32 > stack {
        return Err(format!("{what}: {} of an item that stacks to {stack}", s.count));
    }
    Ok(())
}

/// One inventory of `size` slots in block `r`: the canonical class, an empty tail, valid stacks, a bar and
/// filters inside the size.
fn check_inventory(w: &World, r: InvRef, size: u32, what: &str) -> Result<(), String> {
    if class_for(size) != Some(inv_class(r)) {
        return Err(format!("{what}: {size} slots in a block of class {}", inv_class(r)));
    }
    let block = w.heap.block(r);
    for (i, s) in block.iter().enumerate() {
        if i as u32 >= size && *s != EMPTY_SLOT {
            return Err(format!("{what}: slot {i} lies past its {size} slots"));
        }
        check_stack(&w.protos, s, what)?;
    }
    if let Some(b) = w.heap.bar(r)
        && u32::from(b) >= size
    {
        return Err(format!("{what}: a limit bar at {b} of {size} slots"));
    }
    for f in w.heap.filters(r) {
        if u32::from(f.slot) >= size {
            return Err(format!("{what}: a filter on slot {} of {size}", f.slot));
        }
        check_stack(&w.protos, &Slot { key: f.key, count: 1 }, what)?;
    }
    Ok(())
}

/// A hand (I §3.2): empty (`{none, no ghost, no origin, 0}`), a ghost cursor of a known item, or a stack of at
/// most a stack size whose origin, if any, is a slot of the main inventory.
fn check_hand(w: &World, h: &Hand, main_size: u32, what: &str) -> Result<(), String> {
    let empty = Hand { key: ItemKey::NONE, ghost: false, origin: 0xFFFF, count: 0 };
    if *h == empty {
        return Ok(());
    }
    if h.ghost {
        let ok = h.count == 0 && h.origin == 0xFFFF;
        check_stack(&w.protos, &Slot { key: h.key, count: 1 }, what)?;
        return if ok { Ok(()) } else { Err(format!("{what}: a ghost cursor holding items")) };
    }
    check_stack(&w.protos, &Slot { key: h.key, count: h.count }, what)?;
    if h.origin != 0xFFFF && u32::from(h.origin) >= main_size {
        return Err(format!("{what}: origin slot {} of {main_size}", h.origin));
    }
    Ok(())
}

/// Every inventory and hand of the built World (finding 4).
pub fn check_inventories(w: &World) -> Result<(), String> {
    for slot in 0..w.containers.rows() {
        if !w.containers.is_live(slot) {
            continue;
        }
        let row = handle::slot(w.containers.entity[slot as usize]) as usize;
        let size = u32::from(w.protos.entity.inventory_slots[usize::from(w.entities.proto[row].0)]);
        let what = format!("entity {}'s inventory", w.entities.serial[row].0);
        check_inventory(w, w.containers.inv[slot as usize], size, &what)?;
    }
    let character = w.protos.well_known.character;
    for p in w.players.iter() {
        if p.main.is_none() {
            check_hand(w, &p.hand, 0, &format!("player {}'s hand", p.index.0))?;
            continue;
        }
        let Some(c) = character else {
            return Err("a player has a character, but the prototypes have none".to_owned());
        };
        let size = u32::from(w.protos.entity.inventory_slots[usize::from(c.0)]);
        check_inventory(w, p.main, size, &format!("player {}'s inventory", p.index.0))?;
        check_hand(w, &p.hand, size, &format!("player {}'s hand", p.index.0))?;
    }
    Ok(())
}
