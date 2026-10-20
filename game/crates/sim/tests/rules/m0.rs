//! M0's scenarios (10 §12 M0 exit): a chest crafted, placed, filled and mined through actions; a character
//! walking on generated terrain while worldgen requests and commits chunks around it.

use crate::helpers::*;
use schema::events::EventPayload;
use schema::{Direction, Serial};

#[test]
fn m0_chest_lifecycle() {
    let mut s = scenario("m0-chest-lifecycle", 1945);
    s.system(joined(0));
    s.run(1);
    let (chest, plate) = (item(&s, "iron-chest"), item(&s, "iron-plate"));
    assert_eq!(count(&s, 0, plate), 8, "the start inventory");
    let r = recipe(&s, "iron-chest");
    s.act(0, craft(r, 0));
    s.run(1);
    assert_eq!(count(&s, 0, plate), 0, "ingredients leave at enqueue");
    s.run(30);
    assert_eq!(count(&s, 0, chest), 1, "a 0.5-s craft takes 30 ticks");
    // Pick it up (slot 0 after sorting) and build it two tiles east; fill it from the hand next tick.
    s.act(0, click_main(0));
    s.run(1);
    let built_at = s.tick() + 1;
    s.act(0, build(chest, 2, 0));
    s.run(1);
    let events = s.events();
    let built = events
        .iter()
        .find_map(|(h, e)| match e {
            EventPayload::EntityBuilt(b) if h.tick.0 == built_at => Some(b.serial),
            _ => None,
        })
        .expect("entity_built");
    assert_eq!(entity_at(&s, built), Some((5, 1)));
    assert_eq!(s.player(0).hand.count, 0, "the hand emptied");
    // Craft another chest's worth? No plates left: the request is refused, nothing changes.
    s.act(0, craft(r, 1));
    s.run(1);
    assert!(s.events().iter().any(|(_, e)| matches!(e, EventPayload::ActionFailed(f) if f.reason == schema::FailReason::NotEnoughIngredients)));
    // Mine it back: the chest returns to the inventory, the entity goes.
    s.act(0, mine(serial(built.0)));
    s.run(60);
    assert_eq!(entity_at(&s, built), None, "mined");
    assert_eq!(count(&s, 0, chest), 1);
    assert!(s.events().iter().any(|(_, e)| matches!(e, EventPayload::EntityMined(m) if m.serial == built)));
    // Statistics: the chest was produced by hand crafting, the plates consumed.
    let stats = s.world().stats();
    assert!(stats.iter().any(|x| x.handcrafted_total == 1.0 && x.produced_total == 1.0));
    assert!(stats.iter().any(|x| x.consumed_total == 8.0));
    // Trimmed collision is world state, set by an action (D11).
    s.act(0, trimmed(false));
    s.run(1);
    assert!(!s.world().globals.game.trimmed_collision);
    s.run(20);
    finish(&s);
}

/// Hand mining on generated terrain (§5.1, rules 22–24, 26): the character walks to the starting patch, mines
/// three units from a pristine chunk (which becomes modified, its rule version raised per unit), and the ore is
/// production in the statistics.
#[test]
fn m0_hand_mining_on_a_pristine_chunk() {
    let mut s = scenario("m0-hand-mining", 1945);
    s.system(joined(0));
    s.run(1);
    // The starting patch's tile nearest to spawn, from the world's own generator.
    let g = s.world().regen.generator().expect("a generator").clone();
    let mut best: Option<(i32, i32, i64)> = None;
    for cy in -2..2 {
        for cx in -2..2 {
            for r in g.chunk(schema::SurfaceIndex(0), cx, cy).resources {
                let (tx, ty) = (cx * 32 + i32::from(r.tile % 32), cy * 32 + i32::from(r.tile / 32));
                let d = i64::from(tx) * i64::from(tx) + i64::from(ty) * i64::from(ty);
                if best.is_none_or(|b| d < b.2) {
                    best = Some((tx, ty, d));
                }
            }
        }
    }
    let (tx, ty, _) = best.expect("a starting patch");
    // Walk toward it in the nearest of the 8 directions, re-aiming every 8 ticks, until within reach.
    let dirs = [
        Direction::East,
        Direction::SouthEast,
        Direction::South,
        Direction::SouthWest,
        Direction::West,
        Direction::NorthWest,
        Direction::North,
        Direction::NorthEast,
    ];
    for _ in 0..200 {
        let p = s.player(0);
        let (dx, dy) = (f64::from(tx) + 0.5 - p.x, f64::from(ty) + 0.5 - p.y);
        if dx * dx + dy * dy < 4.0 {
            break;
        }
        // The octant of (dx, dy), y pointing south, by comparisons (no atan2 needed).
        let (ax, ay) = (dx.abs(), dy.abs());
        let k = if ay < 0.414 * ax {
            if dx > 0.0 { 0 } else { 4 }
        } else if ax < 0.414 * ay {
            if dy > 0.0 { 2 } else { 6 }
        } else if dx > 0.0 {
            if dy > 0.0 { 1 } else { 7 }
        } else if dy > 0.0 {
            3
        } else {
            5
        };
        s.act(0, walk(dirs[k]));
        s.run(8);
    }
    s.act(0, stop());
    s.run(1);
    let ore = item(&s, "iron-ore");
    assert_eq!(s.world().chunks.modified_count(), 0, "nothing modified yet");
    s.act(0, mine_tile(tx, ty));
    s.run(360);
    s.act(0, stop_mining());
    s.run(1);
    assert_eq!(count(&s, 0, ore), 3, "120 ticks per unit");
    assert_eq!(s.world().chunks.modified_count(), 1, "the mined chunk became modified");
    let c = s.world().chunks.modified().next().expect("one modified chunk");
    assert_eq!(c.rec.rule_version, 3, "one raise per unit");
    let stat = s.world().stats().iter().find(|x| x.produced_total > 0.0).expect("a statistics record");
    assert_eq!(stat.produced_total, 3.0);
    s.run(30);
    finish(&s);
}

#[test]
fn m0_walk_on_generated_terrain() {
    let mut s = scenario("m0-walk-generated", 7);
    let generated0 = s.world().chunks.generated().len();
    assert_eq!(generated0, 225, "new_world generates the 15 × 15 chunks around spawn inline");
    s.system(joined(0));
    s.run(1);
    let start = (s.player(0).x, s.player(0).y);
    // Walk in each direction for a while: east, south, west, north-east; pristine chunks ahead are requested
    // as the character crosses chunk borders and committed 30 ticks later, inline.
    for (dir, ticks) in
        [(Direction::East, 900), (Direction::South, 600), (Direction::NorthEast, 700), (Direction::West, 500)]
    {
        s.act(0, walk(dir));
        s.run(ticks);
    }
    s.act(0, stop());
    s.run(60);
    let p = s.player(0);
    let moved = (p.x - start.0).abs() + (p.y - start.1).abs();
    assert!(moved > 64.0, "the character walked {moved} tiles");
    let generated = s.world().chunks.generated().len();
    assert!(generated > generated0, "chunks were committed: {generated}");
    assert!(s.world().pending().is_empty(), "every request committed");
    // The character never stood on an unwalkable tile.
    let t = s
        .world()
        .tile_at(schema::SurfaceIndex(0), p.x.floor() as i32, p.y.floor() as i32)
        .expect("generated");
    assert!(s.world().protos.tile.walkable[usize::from(t.0)]);
    assert_eq!(s.world().chunks.modified_count(), 0, "walking modifies nothing");
    let _ = Serial::NONE;
    finish(&s);
}
