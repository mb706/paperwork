//! M0's golden ratio tests (10 §10.3, which lists the M1+ ones; C8): the character's rates against Factorio's
//! numbers, each run on a layout (10 §10.2, `test/layouts/`) or a generated world through closures, frozen in
//! `test/goldens/` (`goldens.rs`), and each a D18 a–c scenario with a recorded session (`finish`).
//!
//! | # | Golden | Factorio |
//! |---|---|---|
//! | GM1 | Hand crafting the iron chest: crafts in 60 s | 0.5 s per craft at crafting speed 1: 120 |
//! | GM2 | Hand mining iron ore: ore in 60 s | mining speed 0.5, mining time 1: 2 s each, 30 |
//! | GM3 | Running: tiles per 600 ticks east, and per axis south-east | 0.15 tiles a tick: 90, and 90 × √½ |
//! | GM4 | Mining an iron chest by hand: ticks | mining time 0.2 s at speed 0.5: 0.4 s, 24 ticks |
//! | GM5 | An iron chest's capacity in iron plates | 32 slots × a stack of 100: 3,200 |

use crate::goldens::Goldens;
use crate::helpers::*;
use schema::events::EventPayload;
use schema::{
    Action, Direction, EntityRef, EntityRefTag, InvSlot, InventoryTransferAction, InventoryType, Serial,
};
use sim::testkit::{LayoutOpts, Scenario};
use std::path::Path;

fn layout(name: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/layouts").join(name))
        .unwrap_or_else(|e| panic!("test/layouts/{name}: {e}"))
}

fn from_layout(name: &str, file: &str) -> (Scenario, Vec<Serial>) {
    let (s, _, serials) = Scenario::from_layout(name, &protos(), &layout(file), LayoutOpts::default())
        .expect("the layout loads");
    (s, serials)
}

/// Everything of the chest's slot 0's item into player `i`'s inventory (Ctrl+LMB on the chest's slot).
fn take_all(s: &mut Scenario, i: u16, chest: Serial) {
    let from = InvSlot {
        owner: EntityRef { tag: EntityRefTag::Serial, a: chest.0, b: 0 },
        inv: InventoryType::Chest,
        slot: 0,
    };
    s.act(i, Action::InventoryTransfer(InventoryTransferAction { from, to: NO_ENTITY }));
    s.run(1);
}

#[test]
fn gm1_hand_crafting_makes_120_chests_a_minute() {
    let (mut s, serials) = from_layout("gm1-hand-crafting", "m0-handcraft.txt");
    s.system(joined(0));
    s.run(1);
    take_all(&mut s, 0, serials[0]);
    let plate = s.item("iron-plate");
    assert_eq!(count(&s, 0, plate), 1608, "the start's 8 and the chest's 1,600");
    let r = recipe(&s, "iron-chest");
    s.act(0, craft(r, 0)); // Shift+LMB: all that can be crafted, 201
    s.run(1);
    let t0 = s.tick();
    s.run(3600);
    let in_a_minute = s.stats().handcrafted("iron-chest");
    let mut g = Goldens::open("m0-gm1-hand-crafting");
    g.check("iron-chest-crafts-in-60-s", in_a_minute, 120.0, 1.0);
    // The rest of the queue: 201 crafts of 30 ticks each, bit-exact (rule 22).
    s.run(81 * 30);
    assert_eq!(s.stats().handcrafted("iron-chest"), 201.0);
    let done = s
        .events()
        .iter()
        .filter_map(|(h, e)| matches!(e, EventPayload::ItemCrafted(_)).then_some(h.tick.0))
        .max()
        .expect("crafts");
    // The craft action's own tick is the first of crafting (rule 10).
    g.check("ticks-for-201-crafts", f64::from(done - t0 + 1), 6030.0, 0.0);
    g.finish();
    finish(&s);
}

#[test]
fn gm2_hand_mining_makes_30_ore_a_minute() {
    let mut s = scenario("gm2-hand-mining", 1945);
    s.system(joined(0));
    s.run(1);
    let g0 = s.world().regen.generator().expect("a generator").clone();
    // The starting patch's tile nearest the spawn point.
    let mut best: Option<(i32, i32, i64)> = None;
    for cy in -2..2 {
        for cx in -2..2 {
            for r in g0.chunk(schema::SurfaceIndex(0), cx, cy).resources {
                let (tx, ty) = (cx * 32 + i32::from(r.tile % 32), cy * 32 + i32::from(r.tile / 32));
                let d = i64::from(tx) * i64::from(tx) + i64::from(ty) * i64::from(ty);
                if best.is_none_or(|b| d < b.2) {
                    best = Some((tx, ty, d));
                }
            }
        }
    }
    let (tx, ty, _) = best.expect("a starting patch");
    // Walk next to it, re-aiming every 8 ticks.
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
    for _ in 0..300 {
        let p = s.player(0);
        let (dx, dy) = (f64::from(tx) + 0.5 - p.x, f64::from(ty) + 0.5 - p.y);
        if dx * dx + dy * dy < 4.0 {
            break;
        }
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
    s.act(0, mine_tile(tx, ty));
    s.run(1);
    let before = s.stats().produced("iron-ore");
    s.run(3600);
    let mut g = Goldens::open("m0-gm2-hand-mining");
    g.check("iron-ore-mined-in-60-s", s.stats().produced("iron-ore") - before, 30.0, 0.0);
    g.finish();
    s.act(0, stop_mining());
    s.run(1);
    finish(&s);
}

#[test]
fn gm3_running_covers_9_tiles_a_second() {
    let (mut s, _) = from_layout("gm3-running", "m0-mine-chest.txt");
    s.system(joined(0));
    s.run(1);
    // West, away from the layout's chest, then south-east: 600 ticks each on the dry map's land.
    let x0 = s.player(0).x;
    s.act(0, walk(Direction::West));
    s.run(600);
    let west = x0 - s.player(0).x;
    s.act(0, stop());
    s.run(1);
    let (x1, y1) = (s.player(0).x, s.player(0).y);
    s.act(0, walk(Direction::SouthWest));
    s.run(600);
    let (dx, dy) = (x1 - s.player(0).x, s.player(0).y - y1);
    s.act(0, stop());
    s.run(1);
    let mut g = Goldens::open("m0-gm3-running");
    g.check("tiles-west-in-600-ticks", west, 90.0, 1e-9);
    g.check("tiles-per-axis-south-west-in-600-ticks", dx, 90.0 * std::f64::consts::FRAC_1_SQRT_2, 1e-6);
    assert!((dx - dy).abs() < 1e-9, "both axes move alike: {dx} {dy}");
    g.finish();
    finish(&s);
}

#[test]
fn gm4_mining_an_iron_chest_takes_24_ticks() {
    let (mut s, serials) = from_layout("gm4-mine-chest", "m0-mine-chest.txt");
    let chest = serials[0];
    s.system(joined(0));
    s.run(1);
    let start = s.tick() + 1;
    s.act(0, mine(serial(chest.0)));
    s.run(40);
    let mined = s
        .events()
        .iter()
        .find_map(|(h, e)| matches!(e, EventPayload::EntityMined(m) if m.serial == chest).then_some(h.tick.0))
        .expect("the chest was mined");
    assert_eq!(s.entity_at(2, 0), None, "the chest is gone");
    assert_eq!(count(&s, 0, s.item("iron-chest")), 1, "and in the inventory");
    let mut g = Goldens::open("m0-gm4-mine-chest");
    // The action's own tick is the first of mining (rule 10: it takes effect in its tick).
    g.check("ticks-to-mine-an-iron-chest", f64::from(mined - start + 1), 24.0, 0.0);
    g.finish();
    s.act(0, stop_mining());
    s.run(1);
    finish(&s);
}

#[test]
fn gm5_an_iron_chest_holds_3200_plates() {
    let (mut s, serials) = from_layout("gm5-chest-capacity", "m0-chest-capacity.txt");
    let (full, empty) = (serials[0], serials[1]);
    s.system(joined(0));
    s.run(1);
    take_all(&mut s, 0, full);
    let plate = s.item("iron-plate");
    assert_eq!(count(&s, 0, plate), 3208);
    s.insert(0, empty, "iron-plate");
    let mut g = Goldens::open("m0-gm5-chest-capacity");
    g.check("iron-plates-in-an-iron-chest", 3208.0 - count(&s, 0, plate) as f64, 3200.0, 0.0);
    g.finish();
    // A full chest takes nothing more, silently (rule 19: not a refusal).
    s.insert(0, empty, "iron-plate");
    assert_eq!(count(&s, 0, plate), 8);
    assert_eq!(s.entity_at(1, 2), Some(empty));
    finish(&s);
}
