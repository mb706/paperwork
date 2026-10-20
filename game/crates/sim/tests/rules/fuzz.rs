//! Fuzzed action streams (10 §10.4 #9, §15.11: "fuzzed closures that must never trap"): random M0 actions with
//! typed, biased field values (serials and creation ids near the live ones, slots in and past the
//! inventories, positions around the characters, every enum value), malformed payloads, unknown types and
//! system actions, from several players including one that never joined, over the golden map. Every tick must
//! run, every refusal must leave the state as it was (the scenario checks each), and the run must be
//! equivalent under NO_SLEEP, reloads and heavy mode (D18 a–c); the run is a recorded session in `test/logs/`,
//! which the native and WebAssembly replays replay (D18 e).

use crate::helpers::*;
use schema::events::EventPayload;
use schema::{
    Action, ActionType, BuildFlags, BuildMode, CancelCraftAction, CursorSplitAction, Direction, EntityRef,
    EntityRefTag, FastEntitySplitAction, FinePos, GameSetting, InvSlot, InventorySplitAction,
    InventoryTransferAction, InventoryType, ItemKey, MiningTarget, PlayerIndex, PlayerSetting,
    SetInventoryBarAction, StackSplitAction, StackTransferAction, TilePos2,
};
use sim::rng::Xoshiro128;
use std::collections::BTreeMap;

struct Gen(Xoshiro128);

impl Gen {
    fn n(&mut self, k: u32) -> u32 {
        self.0.next_u32() % k
    }

    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.n(xs.len() as u32) as usize]
    }

    /// An entity reference: none, a serial near the live ones (characters 1, 4, 5; chests 2, 3 and those
    /// built later), or a creation id near the player's recent seqs.
    fn entity(&mut self, last_seq: u32) -> EntityRef {
        match self.n(10) {
            0..=1 => EntityRef { tag: EntityRefTag::None, a: 0, b: 0 },
            2..=6 => EntityRef { tag: EntityRefTag::Serial, a: 1 + self.n(14), b: 0 },
            _ => EntityRef {
                tag: EntityRefTag::Creation,
                a: last_seq.saturating_sub(self.n(6)),
                b: self.n(2) as u16,
            },
        }
    }

    fn slot(&mut self, last_seq: u32) -> InvSlot {
        if self.n(2) == 0 {
            let slot = if self.n(5) == 0 { self.n(84) } else { self.n(4) } as u16;
            InvSlot {
                owner: EntityRef { tag: EntityRefTag::None, a: 0, b: 0 },
                inv: InventoryType::Main,
                slot,
            }
        } else {
            let inv = if self.n(5) == 0 { self.pick(&InventoryType::ALL) } else { InventoryType::Chest };
            InvSlot { owner: self.entity(last_seq), inv, slot: self.n(36) as u16 }
        }
    }

    /// A tile around `(x, y)`.
    fn near(&mut self, x: f64, y: f64, r: i32) -> (i32, i32) {
        (
            x.floor() as i32 + self.n(2 * r as u32 + 1) as i32 - r,
            y.floor() as i32 + self.n(2 * r as u32 + 1) as i32 - r,
        )
    }

    /// An item key: mostly the chest (the one item that places an entity), at quality 0 mostly.
    fn item(&mut self) -> ItemKey {
        let id = if self.n(3) == 0 { self.n(3) as u16 } else { 0 };
        ItemKey((id << 3) | if self.n(10) == 0 { self.n(8) as u16 } else { 0 })
    }
}

/// One random M0 player action for a player at `(x, y)` with this watermark and input generation.
fn action(g: &mut Gen, x: f64, y: f64, last_seq: u32, input_gen: u16) -> Action<'static> {
    let stamp = if g.n(8) == 0 { input_gen.wrapping_sub(1) } else { input_gen };
    let a = match g.n(22) {
        0..=2 => walk(g.pick(&Direction::ALL)),
        3 => stop(),
        4 => mine(g.entity(last_seq)),
        5 => {
            let (tx, ty) = g.near(x, y, 4);
            let kind = if g.n(4) == 0 { g.pick(&MiningTarget::ALL) } else { MiningTarget::ResourceTile };
            Action::BeginMiningTerrain(schema::BeginMiningTerrainAction {
                input_gen: 0,
                kind,
                pos: FinePos { x: tx * 256 + g.n(256) as i32, y: ty * 256 + g.n(256) as i32 },
            })
        }
        6 => stop_mining(),
        7..=8 => {
            let (tx, ty) = g.near(x, y, 12);
            let odd = g.n(10) != 0;
            Action::Build(schema::BuildAction {
                item: g.item(),
                pos: TilePos2 { x2: 2 * tx + i32::from(odd), y2: 2 * ty + i32::from(odd) },
                dir: g.pick(&Direction::ALL),
                flip: g.n(4) == 0,
                mode: if g.n(8) == 0 { BuildMode::Ghost } else { BuildMode::Normal },
                flags: BuildFlags::EMPTY,
                drag_id: 0,
            })
        }
        9 => Action::ClearCursor(schema::ClearCursorAction {}),
        10 => Action::CursorTransfer(schema::CursorTransferAction { slot: g.slot(last_seq) }),
        11 => Action::CursorSplit(CursorSplitAction { slot: g.slot(last_seq) }),
        12 => Action::StackTransfer(StackTransferAction { from: g.slot(last_seq), to: g.entity(last_seq) }),
        13 => Action::StackSplit(StackSplitAction { from: g.slot(last_seq), to: g.entity(last_seq) }),
        14 => Action::InventoryTransfer(InventoryTransferAction {
            from: g.slot(last_seq),
            to: g.entity(last_seq),
        }),
        15 => Action::InventorySplit(InventorySplitAction { from: g.slot(last_seq), to: g.entity(last_seq) }),
        16 => fast(g.entity(last_seq)),
        17 => Action::FastEntitySplit(FastEntitySplitAction { target: g.entity(last_seq) }),
        18 => Action::SetInventoryBar(SetInventoryBarAction {
            target: g.entity(last_seq),
            inv: if g.n(4) == 0 { g.pick(&InventoryType::ALL) } else { InventoryType::Chest },
            bar: g.n(36) as u16,
        }),
        19 => craft(g.n(2) as u16, g.n(4)),
        20 => Action::CancelCraft(CancelCraftAction { index: g.n(3) as u16, count: g.n(3) as u16 }),
        _ => {
            if g.n(2) == 0 {
                Action::SetPlayerSetting(schema::SetPlayerSettingAction {
                    setting: g.pick(&PlayerSetting::ALL),
                    value: g.n(3),
                })
            } else {
                Action::SetGameSetting(schema::SetGameSettingAction {
                    setting: g.pick(&GameSetting::ALL),
                    value: g.n(3),
                })
            }
        }
    };
    a.with_input_gen(stamp)
}

#[test]
fn fuzzed_actions_never_trap_and_refusals_change_nothing() {
    let mut s = golden_scenario("fuzz");
    s.system(joined(1));
    s.system(joined(2));
    s.run(1);
    let mut g = Gen(Xoshiro128::seeded(2026, 10));
    for _ in 0..3000 {
        let t = s.tick() + 1;
        for _ in 0..g.n(5) {
            let roll = g.n(100);
            let i = if g.n(12) == 0 { 3 } else { g.n(3) as u16 };
            let (x, y, last, ig) = match s.world().players.get(PlayerIndex(i)) {
                Some(p) => (p.x, p.y, p.last_seq.0, p.input_gen),
                None => (0.0, 0.0, 0, 0),
            };
            if roll < 1 {
                // System actions, joins twice as often as leaves and releases.
                let p = g.n(4) as u16;
                let a = g.pick(&[joined(p), joined(p), left(p), release(p)]);
                s.system_at(t, a);
            } else if roll < 5 {
                // An unknown type, or a known one with a payload of the wrong length: `malformed`.
                let ty = if g.n(2) == 0 { 0x7777 } else { ActionType::Build.value() };
                let p = (0..g.n(24)).map(|_| g.n(256) as u8).collect();
                s.seq.push_raw(t, Some(PlayerIndex(i)), ty, p).expect("in order");
            } else if roll < 8 {
                // Outside M0's manifest: `unsupported`.
                let a = Action::RotateEntity(schema::RotateEntityAction {
                    target: g.entity(last),
                    reverse: false,
                });
                s.seq.push(t, PlayerIndex(i), &a).expect("in order");
            } else {
                let a = action(&mut g, x, y, last, ig);
                let mut p = Vec::new();
                match (a.encode(&mut schema::codec::Writer::new(&mut p)), &a) {
                    (Ok(()), _) => {
                        s.seq
                            .push_raw(t, Some(PlayerIndex(i)), a.action_type().value(), p)
                            .expect("in order");
                    }
                    // The encoder refuses what the decoder refuses (an odd walking direction): its bytes by hand.
                    (Err(_), Action::StartWalking(w)) => {
                        let mut b = w.input_gen.to_le_bytes().to_vec();
                        b.push(w.dir.value());
                        s.seq
                            .push_raw(t, Some(PlayerIndex(i)), ActionType::StartWalking.value(), b)
                            .expect("in order");
                    }
                    (Err(e), other) => panic!("{}: {e}", other.action_type().name()),
                }
            }
        }
        s.run(1);
    }
    let events = s.events();
    let mut kinds = BTreeMap::new();
    for (h, e) in &events {
        let k = match e {
            EventPayload::ActionFailed(f) => format!("failed {:?}", f.reason),
            _ => format!("{:?}", h.r#type),
        };
        *kinds.entry(k).or_insert(0u32) += 1;
    }
    // The stream reached the rules, not only the decoder.
    for k in [
        "EntityBuilt",
        "EntityMined",
        "FlyingText",
        "ItemCrafted",
        "InputFenced",
        "failed Malformed",
        "failed Unsupported",
        "failed PlayerNotPresent",
        "failed TargetGone",
        "failed OutOfReach",
        "failed InvalidIndex",
        "failed NothingToTransfer",
    ] {
        assert!(kinds.get(k).copied().unwrap_or(0) > 0, "no {k}: {kinds:#?}");
    }
    // D18 a–c, and the run as a recorded session (the cross-engine replays get an adversarial log).
    finish(&s);
}
