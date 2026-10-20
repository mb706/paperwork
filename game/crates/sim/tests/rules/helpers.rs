//! Shared helpers of the rule scenarios: the golden prototypes, action constructors, and [`finish`].

use schema::{
    Action, BeginMiningAction, BeginMiningTerrainAction, BuildAction, BuildFlags, BuildMode, CraftAction,
    Direction, EntityRef, EntityRefTag, FastEntityTransferAction, FinePos, GameSetting, InvSlot,
    InventoryType, ItemKey, JoinFlags, MiningTarget, NewWorld, PlayerIndex, PlayerJoinedAction,
    PlayerLeftAction, PlayerSetting, RecipeId, ReleaseInputsAction, Serial, SetGameSettingAction,
    SetPlayerSettingAction, StartWalkingAction, StopMiningAction, StopWalkingAction, TilePos2,
};
use sim::testkit::Scenario;
use std::path::{Path, PathBuf};

pub fn protos() -> Vec<u8> {
    std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/golden/m0/protos/prototypes.bin"))
        .expect("the golden prototypes")
}

pub fn golden(rel: &str) -> Vec<u8> {
    std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/golden/m0").join(rel)).expect(rel)
}

pub fn logs_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/logs")
}

/// A new world with `seed` and default settings (an unbounded map).
pub fn world(seed: u32) -> NewWorld {
    NewWorld { seed, ..NewWorld::default() }
}

/// A scenario on a new world with `seed`.
pub fn scenario(name: &str, seed: u32) -> Scenario {
    Scenario::new_world(name, &protos(), &world(seed)).expect("a new world")
}

/// A scenario from the golden start state (`states/tick-0000.sections`: the 96 × 96 golden map, two chests,
/// player 0 near chest A).
pub fn golden_scenario(name: &str) -> Scenario {
    Scenario::from_state(name, &protos(), &golden("states/tick-0000.sections")).expect("the golden start")
}

pub fn joined(i: u16) -> Action<'static> {
    Action::PlayerJoined(PlayerJoinedAction { player: PlayerIndex(i), flags: JoinFlags::EMPTY })
}

pub fn left(i: u16) -> Action<'static> {
    Action::PlayerLeft(PlayerLeftAction { player: PlayerIndex(i) })
}

pub fn release(i: u16) -> Action<'static> {
    Action::ReleaseInputs(ReleaseInputsAction { player: PlayerIndex(i) })
}

pub fn walk(dir: Direction) -> Action<'static> {
    Action::StartWalking(StartWalkingAction { input_gen: 0, dir })
}

pub fn stop() -> Action<'static> {
    Action::StopWalking(StopWalkingAction { input_gen: 0 })
}

pub const fn serial(s: u32) -> EntityRef {
    EntityRef { tag: EntityRefTag::Serial, a: s, b: 0 }
}

pub const fn creation(seq: u32, k: u16) -> EntityRef {
    EntityRef { tag: EntityRefTag::Creation, a: seq, b: k }
}

pub const NO_ENTITY: EntityRef = EntityRef { tag: EntityRefTag::None, a: 0, b: 0 };

pub fn mine(target: EntityRef) -> Action<'static> {
    Action::BeginMining(BeginMiningAction { input_gen: 0, target })
}

pub fn mine_tile(tx: i32, ty: i32) -> Action<'static> {
    Action::BeginMiningTerrain(BeginMiningTerrainAction {
        input_gen: 0,
        kind: MiningTarget::ResourceTile,
        pos: FinePos { x: tx * 256 + 128, y: ty * 256 + 128 },
    })
}

pub fn stop_mining() -> Action<'static> {
    Action::StopMining(StopMiningAction { input_gen: 0 })
}

/// Builds the item in the hand on tile `(tx, ty)` (a 1 × 1 entity's centre).
pub fn build(item: ItemKey, tx: i32, ty: i32) -> Action<'static> {
    Action::Build(BuildAction {
        item,
        pos: TilePos2 { x2: 2 * tx + 1, y2: 2 * ty + 1 },
        dir: Direction::North,
        flip: false,
        mode: BuildMode::Normal,
        flags: BuildFlags::EMPTY,
        drag_id: 0,
    })
}

pub fn craft(recipe: u16, count: u32) -> Action<'static> {
    Action::Craft(CraftAction { recipe: RecipeId(recipe), count })
}

/// LMB on a main-inventory slot.
pub fn click_main(slot: u16) -> Action<'static> {
    Action::CursorTransfer(schema::CursorTransferAction {
        slot: InvSlot { owner: NO_ENTITY, inv: InventoryType::Main, slot },
    })
}

pub fn fast(target: EntityRef) -> Action<'static> {
    Action::FastEntityTransfer(FastEntityTransferAction { target })
}

pub fn auto_sort(on: bool) -> Action<'static> {
    Action::SetPlayerSetting(SetPlayerSettingAction {
        setting: PlayerSetting::AutoSortInventory,
        value: u32::from(on),
    })
}

pub fn trimmed(on: bool) -> Action<'static> {
    Action::SetGameSetting(SetGameSettingAction {
        setting: GameSetting::TrimmedCollision,
        value: u32::from(on),
    })
}

/// An item key by name, at quality 0.
pub fn item(s: &Scenario, name: &str) -> ItemKey {
    let i = s
        .world()
        .protos
        .names
        .item
        .iter()
        .position(|n| n == name)
        .unwrap_or_else(|| panic!("no item {name}"));
    ItemKey((i as u16) << 3)
}

/// A recipe id by name.
pub fn recipe(s: &Scenario, name: &str) -> u16 {
    s.world().protos.names.recipe.iter().position(|n| n == name).unwrap_or_else(|| panic!("no recipe {name}"))
        as u16
}

/// How many of `key` player `i` holds in its main inventory.
pub fn count(s: &Scenario, i: u16, key: ItemKey) -> i64 {
    let p = s.player(i);
    let size = s.world().main_size() as usize;
    s.world().heap.block(p.main)[..size].iter().filter(|x| x.key == key).map(|x| i64::from(x.count)).sum()
}

/// The live entity with this serial, as `(x2, y2)`.
pub fn entity_at(s: &Scenario, serial: Serial) -> Option<(i32, i32)> {
    let h = s.world().entity(serial)?;
    let r = sim::handle::slot(h) as usize;
    Some((s.world().entities.x2[r], s.world().entities.y2[r]))
}

/// D18 (a, b, c) on the scenario's recorded closures, then its recorded session in `test/logs/` (D18 e).
pub fn finish(s: &Scenario) {
    let n = s.ticks();
    let h = sim::hash::xxh64(s.name.as_bytes());
    let seeded = 1 + (h % u64::from(n.max(1))) as u32;
    let reloads = [seeded.min(n), (n / 2).max(1)];
    let heavy = 7 + ((h >> 32) % 61) as u32;
    s.check_equivalence(&reloads, heavy).unwrap_or_else(|e| panic!("{}: D18: {e}", s.name));
    let (log, start, summary) = s.log_files().expect("the session encodes");
    let dir = logs_dir();
    let files = [
        (format!("{}.pwlog", s.name), log),
        (format!("{}.start", s.name), start),
        (format!("{}.txt", s.name), summary.into_bytes()),
    ];
    if std::env::var("UPDATE_SCENARIO_LOGS").is_ok_and(|v| v == "1") {
        for (f, b) in &files {
            std::fs::write(dir.join(f), b).expect("writes");
        }
        return;
    }
    for (f, b) in &files {
        let got = std::fs::read(dir.join(f))
            .unwrap_or_else(|e| panic!("test/logs/{f}: {e} (UPDATE_SCENARIO_LOGS=1)"));
        assert!(got == *b, "test/logs/{f} no longer matches the run (UPDATE_SCENARIO_LOGS=1 after review)");
    }
}
