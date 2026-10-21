//! The cross-engine session (10 §10.4 #6, D18 d; C8): one 10,000-tick closure log that the cross-engine trace
//! replays natively (`simtool replay --trace`), in Node, Chrome and Firefox (`e2e/trace.spec.ts`, the trace page
//! `test/trace.html`). It is meant to touch every M0 code path whose arithmetic could differ between engines:
//!
//! - a new world (worldgen v0's noise, climate and ore spots) with water, so walks collide with shores;
//! - player 0 plays M0's opening: crafts the chest, walks to the starting iron patch, hand-mines ore (pristine
//!   chunks become modified), builds the chest, fills it by Shift-click and by fast transfer, takes a stack back,
//!   mines the chest with its contents and builds it again elsewhere;
//! - players 1 and 2 walk far in changing directions through new land (pre-generation requests, inline commits
//!   at 8 per tick); player 1 leaves and comes back; player 2's inputs are released mid-walk with a later walk
//!   already in flight, which is fenced (D22);
//! - player 3 sends noise: typed actions with live and stale targets, splits, settings, crafts and cancels;
//! - `finish` checks D18 a–c on the whole run and records it as `test/logs/m0-cross-engine-10k.*` (D18 e).

use crate::helpers::*;
use schema::events::{EventHeader, EventPayload};
use schema::{
    Action, CancelCraftAction, CursorSplitAction, Direction, InvSlot, InventoryType, ItemKey, PlayerIndex,
    PlayerSetting, Serial, SetInventoryBarAction, StackSplitAction, StackTransferAction,
};
use sim::rng::Xoshiro128;
use sim::testkit::Scenario;

const END: u32 = 10_000;
const DIRS: [Direction; 8] = [
    Direction::East,
    Direction::SouthEast,
    Direction::South,
    Direction::SouthWest,
    Direction::West,
    Direction::NorthWest,
    Direction::North,
    Direction::NorthEast,
];

struct Gen(Xoshiro128);

impl Gen {
    fn n(&mut self, k: u32) -> u32 {
        self.0.next_u32() % k
    }
}

/// The lowest main-inventory slot of player `i` holding `key`.
fn slot_of(s: &Scenario, i: u16, key: ItemKey) -> Option<u16> {
    let p = s.player(i);
    let size = s.world().main_size() as usize;
    s.world().heap.block(p.main)[..size].iter().position(|x| x.key == key && x.count > 0).map(|k| k as u16)
}

/// The direction of the octant from player `i` toward the centre of tile `(tx, ty)`, or None within `near` tiles.
fn aim(s: &Scenario, i: u16, tx: i32, ty: i32, near: f64) -> Option<Direction> {
    let p = s.player(i);
    let (dx, dy) = (f64::from(tx) + 0.5 - p.x, f64::from(ty) + 0.5 - p.y);
    if dx * dx + dy * dy < near * near {
        return None;
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
    Some(DIRS[k])
}

/// The starting patch's resource tile nearest the spawn point, from the world's own generator.
fn starting_ore(s: &Scenario) -> (i32, i32) {
    let g = s.world().regen.generator().expect("a generator").clone();
    let mut best: Option<(i32, i32, i64)> = None;
    for cy in -3..3 {
        for cx in -3..3 {
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
    (tx, ty)
}

/// Player 0's opening, one step per tick.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Opening {
    Craft,
    Walk,
    Mine { until: i64 },
    Pick,
    Build { tries: u32 },
    Placed { tries: u32 },
    ShiftFill,
    HandFill,
    FastFill,
    TakeBack,
    PutDown,
    MineChest { since: u32 },
    Idle,
}

/// A long walker: a direction for a leg of 200–700 ticks, sometimes a pause.
struct Walker {
    player: u16,
    leg_ends: u32,
}

impl Walker {
    fn step(&mut self, s: &mut Scenario, g: &mut Gen) {
        let t = s.tick() + 1;
        if t < self.leg_ends || !s.player(self.player).online {
            return;
        }
        self.leg_ends = t + 200 + g.n(500);
        if g.n(6) == 0 {
            s.act(self.player, stop());
        } else {
            let d = DIRS[g.n(8) as usize];
            s.act(self.player, walk(d));
        }
    }
}

/// One noise action for player 3 near `(x, y)`, sometimes naming player 0's chest.
fn noise(g: &mut Gen, s: &Scenario, chest: Option<u32>) -> Action<'static> {
    let p = s.player(3);
    let (x, y) = (p.x.floor() as i32, p.y.floor() as i32);
    let target = match (chest, g.n(4)) {
        (Some(c), 0..=1) => serial(c),
        (_, 2) => serial(1 + g.n(12)),
        _ => creation(p.last_seq.0.saturating_sub(g.n(4)), 0),
    };
    let main = |slot: u16| InvSlot { owner: NO_ENTITY, inv: InventoryType::Main, slot };
    let chest_slot =
        |slot: u16| InvSlot { owner: chest.map_or(NO_ENTITY, serial), inv: InventoryType::Chest, slot };
    match g.n(16) {
        0..=2 => walk(DIRS[g.n(8) as usize]),
        3 => stop(),
        4 => mine_tile(x + g.n(7) as i32 - 3, y + g.n(7) as i32 - 3),
        5 => stop_mining(),
        6 => click_main(g.n(10) as u16),
        7 => Action::CursorSplit(CursorSplitAction { slot: main(g.n(10) as u16) }),
        8 => Action::StackTransfer(StackTransferAction { from: main(g.n(6) as u16), to: target }),
        9 => Action::StackSplit(StackSplitAction { from: chest_slot(g.n(4) as u16), to: NO_ENTITY }),
        10 => fast(target),
        11 => craft(0, g.n(3)),
        12 => Action::CancelCraft(CancelCraftAction { index: 0, count: g.n(2) as u16 }),
        13 => Action::SetPlayerSetting(schema::SetPlayerSettingAction {
            setting: PlayerSetting::AutoSortInventory,
            value: g.n(2),
        }),
        14 => Action::SetInventoryBar(SetInventoryBarAction {
            target,
            inv: InventoryType::Chest,
            bar: g.n(33) as u16,
        }),
        _ => Action::ClearCursor(schema::ClearCursorAction {}),
    }
}

#[test]
fn m0_cross_engine_10k() {
    let mut s = scenario("m0-cross-engine-10k", 1945);
    let mut g = Gen(Xoshiro128::seeded(1945, 18));
    let (chest, ore, plate) = (item(&s, "iron-chest"), item(&s, "iron-ore"), item(&s, "iron-plate"));
    let r_chest = recipe(&s, "iron-chest");
    let patch = starting_ore(&s);
    let generated0 = s.world().chunks.generated().len();
    let mut opening = Opening::Craft;
    let mut built: Option<u32> = None;
    let mut build_seq = 0u32;
    let mut chests_built = 0;
    let mut walkers = [Walker { player: 1, leg_ends: 2 }, Walker { player: 2, leg_ends: 402 }];
    let mut next_noise = 905;
    let mut fenced = 0;
    let mut wait = 0u32;
    // The last tick's events (the queue is drained once per tick).
    let mut events = Vec::new();
    while s.tick() < END {
        let t = s.tick() + 1;
        match t {
            1 => {
                s.system(joined(0));
                s.system(joined(1));
            }
            400 => {
                s.system(joined(2));
            }
            900 => {
                s.system(joined(3));
            }
            // D22: a walk stamped for 3,004 is in flight when player 2's inputs are released at 3,000.
            2_990 => {
                s.act_at(3_004, 2, walk(Direction::North));
            }
            3_000 => {
                s.system(release(2));
            }
            5_200 => {
                s.system(left(1));
            }
            6_400 => {
                s.system(joined(1));
            }
            8_000 => {
                s.system(left(3));
            }
            _ => {}
        }
        // Player 0's opening.
        if t > 1 && wait == 0 {
            opening = match opening {
                Opening::Craft => {
                    s.act(0, craft(r_chest, 1));
                    wait = 32;
                    Opening::Walk
                }
                Opening::Walk => match aim(&s, 0, patch.0, patch.1, 1.6) {
                    Some(d) => {
                        s.act(0, walk(d));
                        wait = 7;
                        Opening::Walk
                    }
                    None => {
                        s.act(0, stop());
                        s.act(0, mine_tile(patch.0, patch.1));
                        Opening::Mine { until: count(&s, 0, ore) + 12 }
                    }
                },
                Opening::Mine { until } => {
                    if count(&s, 0, ore) >= until {
                        s.act(0, stop_mining());
                        if built.is_some() { Opening::ShiftFill } else { Opening::Pick }
                    } else {
                        Opening::Mine { until }
                    }
                }
                Opening::Pick => match slot_of(&s, 0, chest) {
                    Some(k) => {
                        s.act(0, click_main(k));
                        Opening::Build { tries: 0 }
                    }
                    None => Opening::Idle,
                },
                Opening::Build { tries } if tries < 6 => {
                    let p = s.player(0);
                    let (x, y) = (p.x.floor() as i32, p.y.floor() as i32);
                    let (dx, dy) = [(2, 0), (0, 2), (-2, 0), (0, -2), (2, 2), (-2, -2)][tries as usize];
                    build_seq = s.act(0, build(chest, x + dx, y + dy)).0;
                    Opening::Placed { tries }
                }
                Opening::Build { .. } => Opening::Idle,
                Opening::Placed { tries } => {
                    let found = events.iter().find_map(|(h, e): &(EventHeader, EventPayload)| match e {
                        EventPayload::EntityBuilt(b)
                            if h.player == PlayerIndex(0) && h.seq.0 == build_seq =>
                        {
                            Some(b.serial.0)
                        }
                        _ => None,
                    });
                    match found {
                        Some(c) => {
                            built = Some(c);
                            chests_built += 1;
                            s.act(0, mine_tile(patch.0, patch.1));
                            Opening::Mine { until: count(&s, 0, ore) + 6 }
                        }
                        None => Opening::Build { tries: tries + 1 },
                    }
                }
                Opening::ShiftFill => {
                    // Shift+LMB on the ore stack: it moves into the chest. Then mine on.
                    if let (Some(k), Some(c)) = (slot_of(&s, 0, ore), built) {
                        s.act(
                            0,
                            Action::StackTransfer(StackTransferAction {
                                from: InvSlot { owner: NO_ENTITY, inv: InventoryType::Main, slot: k },
                                to: serial(c),
                            }),
                        );
                    }
                    s.act(0, mine_tile(patch.0, patch.1));
                    Opening::HandFill
                }
                Opening::HandFill => {
                    if count(&s, 0, ore) >= 4 {
                        s.act(0, stop_mining());
                        match slot_of(&s, 0, ore) {
                            Some(k) => {
                                s.act(0, click_main(k));
                                Opening::FastFill
                            }
                            None => Opening::HandFill,
                        }
                    } else {
                        Opening::HandFill
                    }
                }
                Opening::FastFill => {
                    // Ctrl+LMB on the chest with ore in the hand: the hand goes in.
                    if let Some(c) = built {
                        s.act(0, fast(serial(c)));
                    }
                    wait = 3;
                    Opening::TakeBack
                }
                Opening::TakeBack => {
                    // LMB on the chest's first slot: its stack comes into the hand.
                    if let Some(c) = built {
                        s.act(
                            0,
                            Action::CursorTransfer(schema::CursorTransferAction {
                                slot: InvSlot { owner: serial(c), inv: InventoryType::Chest, slot: 0 },
                            }),
                        );
                    }
                    wait = 2;
                    Opening::PutDown
                }
                Opening::PutDown => {
                    // Q puts the hand away; then the chest is mined with its contents.
                    s.act(0, Action::ClearCursor(schema::ClearCursorAction {}));
                    if let Some(c) = built {
                        s.act(0, mine(serial(c)));
                    }
                    Opening::MineChest { since: t }
                }
                Opening::MineChest { since } => {
                    let gone = built.is_none_or(|c| entity_at(&s, Serial(c)).is_none());
                    if gone {
                        built = None;
                        s.act(0, stop_mining());
                        if t < END - 1_500 { Opening::Pick } else { Opening::Idle }
                    } else if t > since + 120 {
                        // Refused or out of reach: mine ore instead, and fill the chest again.
                        s.act(0, mine_tile(patch.0, patch.1));
                        Opening::Mine { until: count(&s, 0, ore) + 3 }
                    } else {
                        Opening::MineChest { since }
                    }
                }
                Opening::Idle => {
                    if t.is_multiple_of(400) {
                        s.act(0, walk(DIRS[g.n(8) as usize]));
                    } else if t % 400 == 60 {
                        s.act(0, stop());
                    }
                    Opening::Idle
                }
            };
        } else {
            wait = wait.saturating_sub(1);
        }
        // Players 1 and 2: long walks (player 2 pauses while its release fences the walk in flight).
        for w in &mut walkers {
            if w.player == 2 && (2_990..3_010).contains(&t) {
                continue;
            }
            w.step(&mut s, &mut g);
        }
        // Player 3: noise every 3–9 ticks while online.
        if t >= next_noise && t < 8_000 {
            let a = noise(&mut g, &s, built);
            s.act(3, a);
            next_noise = t + 3 + g.n(7);
        }
        s.run(1);
        events = s.events();
        fenced += events
            .iter()
            .filter(|(h, e)| h.player == PlayerIndex(2) && matches!(e, EventPayload::InputFenced))
            .count();
    }
    assert_eq!(s.tick(), END);
    // The opening happened: ore mined by hand, the chest built at least twice, the start's plates spent on it.
    assert!(chests_built >= 2, "chests built: {chests_built}");
    assert_eq!(count(&s, 0, plate), 0, "the start's 8 plates went into the chest");
    let produced: f64 = s.world().stats().iter().map(|x| x.produced_total).sum();
    assert!(produced >= 30.0, "items produced by hand: {produced}");
    // The walkers reached new land: chunks were requested and committed inline.
    let generated = s.world().chunks.generated().len();
    assert!(generated > generated0 + 300, "chunks generated: {generated0} → {generated}");
    // D22: player 2's walk in flight was fenced.
    assert!(fenced >= 1, "no input_fenced for player 2");
    finish(&s);
}
