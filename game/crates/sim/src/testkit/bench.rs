//! The M0 benchmark scenarios of 10 §10.6, generated in code rather than stored as saves (C2c: no large saves in
//! the repository; `simtool bench` caches the slow one under `target/`). `simtool bench` times them; the sim's
//! allocation gate (§2.5) runs their steady states.
//!
//! | Scenario | Content | Threshold (reference machine; `ci` × [`HOST_FACTOR`]) |
//! |---|---|---|
//! | `m0-walk` | one character walking east for 10 minutes through new land, inline commits only | mean ≤ 0.2 ms, p99 ≤ 2 ms per tick |
//! | `m0-chests-10k` | 10,000 filled chests, a character, 32 chest windows open | tick mean ≤ 0.1 ms; extraction ≤ 0.3 ms; save ≤ 50 ms; load ≤ 300 ms; hash ≤ 20 ms |
//! | `m0-codec` | encode, frame-check and apply 100,000 actions | ≥ 10⁶ actions/s |
//! | `m0-load-30k` | a save with 30,000 generated, mostly pristine chunks | load ≤ 1 s; ≤ 8 regenerations in any of the next 600 ticks |

use super::sequencer::TestSequencer;
use crate::context::SimContext;
use crate::rules::inventory::key_of;
use crate::world::NewEntity;
use crate::{SimError, SimResult};
use schema::codec::{Fixed, MsgList, Packed, Writer};
use schema::packet::{ViewFlags, ViewRequest};
use schema::projections::{ProjectionKind, SubRequest};
use schema::{
    Action, CursorTransferAction, Direction, EntityFlags, EntityId, EntityRef, EntityRefTag, InvSlot,
    InventoryType, JoinFlags, MapSettings, NewWorld, PlayerIndex, PlayerJoinedAction, ProtoKind, Serial,
    SetInventoryBarAction, SimFlags, SimStatus, Slot, StartWalkingAction, StopWalkingAction, SubFlags, SubId,
    SurfaceIndex, Tick, chunk_key,
};

/// `ci`'s budget gate multiplies the reference machine's thresholds by this host factor (§10.6, §11).
pub const HOST_FACTOR: f64 = 2.4;

/// The M0 scenarios, in §10.6's order.
pub const SCENARIOS: [&str; 4] = ["m0-walk", "m0-chests-10k", "m0-codec", "m0-load-30k"];

/// One threshold of §10.6: a metric, its limit on the reference machine, whether it is a floor, and whether it
/// depends on the machine's speed (a count does not, so the host factor leaves it alone).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Threshold {
    pub metric: &'static str,
    pub limit: f64,
    pub unit: &'static str,
    /// A floor (throughput) rather than a ceiling (time).
    pub floor: bool,
    /// A time or a rate, which `ci`'s gate scales by [`HOST_FACTOR`].
    pub scales: bool,
}

const fn ceiling(metric: &'static str, limit: f64, unit: &'static str) -> Threshold {
    Threshold { metric, limit, unit, floor: false, scales: true }
}

/// §10.6's thresholds of a scenario.
pub fn thresholds(scenario: &str) -> &'static [Threshold] {
    const WALK: [Threshold; 2] = [ceiling("tick_mean_ms", 0.2, "ms"), ceiling("tick_p99_ms", 2.0, "ms")];
    const CHESTS: [Threshold; 5] = [
        ceiling("tick_mean_ms", 0.1, "ms"),
        ceiling("extract_mean_ms", 0.3, "ms"),
        ceiling("save_ms", 50.0, "ms"),
        ceiling("load_ms", 300.0, "ms"),
        ceiling("hash_ms", 20.0, "ms"),
    ];
    const CODEC: [Threshold; 1] =
        [Threshold { metric: "actions_per_s", limit: 1e6, unit: "actions/s", floor: true, scales: true }];
    const LOAD: [Threshold; 2] = [
        ceiling("load_ms", 1000.0, "ms"),
        Threshold {
            metric: "max_regenerations_per_tick",
            limit: 8.0,
            unit: "chunks",
            floor: false,
            scales: false,
        },
    ];
    match scenario {
        "m0-walk" => &WALK,
        "m0-chests-10k" => &CHESTS,
        "m0-codec" => &CODEC,
        "m0-load-30k" => &LOAD,
        _ => &[],
    }
}

fn input_err(e: impl std::fmt::Display) -> SimError {
    SimError::new(SimStatus::ErrInput, e.to_string())
}

/// The bench worlds: seed 1 and the default map without water, so that a straight walk keeps entering new land
/// and 10,000 chests find 100 × 100 tiles of land.
pub fn dry_world() -> NewWorld {
    NewWorld {
        seed: 1,
        map: MapSettings { water_coverage: 0.0, ..MapSettings::default() },
        ..NewWorld::default()
    }
}

/// A module with the prototypes and a new world.
pub fn new_world(protos: &[u8], nw: &NewWorld) -> SimResult<SimContext> {
    let mut c = SimContext::new();
    c.init_protos(protos, SimFlags::EMPTY)?;
    let mut rec = Vec::new();
    nw.encode(&mut Writer::new(&mut rec)).map_err(input_err)?;
    c.new_world(&rec)?;
    Ok(c)
}

/// A scenario being driven: the module, its sequencer, and the view and subscriptions of its window.
pub struct Bench {
    pub ctx: SimContext,
    pub seq: TestSequencer,
    /// A `ViewRequest` around player 0's character (a 1,920 × 1,080 screen at zoom 1: 60 × 34 tiles).
    pub view: Vec<u8>,
}

impl Bench {
    fn new(ctx: SimContext) -> Self {
        let seq = TestSequencer::new(&ctx);
        Self { ctx, seq, view: view_around(0, 0, 0) }
    }

    /// The next tick's closure (what the sequencer holds for it).
    pub fn next_closure(&mut self) -> Vec<u8> {
        let t = self.tick() + 1;
        self.seq.closure(t)
    }

    pub fn tick(&self) -> u32 {
        self.ctx.world().map_or(0, crate::world::World::current_tick)
    }

    /// Runs `n` ticks with the sequencer's closures.
    pub fn run(&mut self, n: u32) -> SimResult<()> {
        for _ in 0..n {
            let c = self.next_closure();
            self.ctx.tick(&c)?;
        }
        Ok(())
    }

    fn system(&mut self, t: u32, a: &Action<'_>) -> SimResult<()> {
        self.seq.push_system(t, a).map(|_| ()).map_err(|e| input_err(format!("{e:?}")))
    }

    fn act(&mut self, t: u32, i: u16, a: &Action<'_>) -> SimResult<()> {
        self.seq.push(t, PlayerIndex(i), a).map(|_| ()).map_err(|e| input_err(format!("{e:?}")))
    }
}

/// A view request of 60 × 34 tiles centred on tile (x, y), hovering `hovered` (0: nothing), with audio on.
pub fn view_around(x: i32, y: i32, hovered: u32) -> Vec<u8> {
    let v = ViewRequest {
        view_seq: 0,
        surface: SurfaceIndex(0),
        flags: ViewFlags::AUDIO,
        x0: x - 30,
        y0: y - 17,
        x1: x + 30,
        y1: y + 17,
        zoom: 1.0,
        hovered_serial: Serial(hovered),
        audio_half_range: 30.0,
        chart_x0: 0,
        chart_y0: 0,
        chart_x1: 0,
        chart_y1: 0,
    };
    let mut out = Vec::new();
    v.write(&mut Writer::new(&mut out), "ViewRequest").expect("a view request encodes");
    out
}

fn joined(i: u16) -> Action<'static> {
    Action::PlayerJoined(PlayerJoinedAction { player: PlayerIndex(i), flags: JoinFlags::EMPTY })
}

fn id_of(ctx: &SimContext, kind: ProtoKind, name: &str) -> SimResult<u16> {
    let w = ctx.world().ok_or_else(|| input_err("no world"))?;
    w.protos.names.find(kind, name).ok_or_else(|| input_err(format!("the prototypes have no {name}")))
}

/// Places chests with every slot full on the tiles of `tiles` (made modified first), built by player 0 at tick
/// 0; returns their serials in order.
fn place_chests(ctx: &mut SimContext, tiles: impl Iterator<Item = (i32, i32)>) -> SimResult<Vec<u32>> {
    let chest = EntityId(id_of(ctx, ProtoKind::Entity, "iron-chest")?);
    let plate = id_of(ctx, ProtoKind::Item, "iron-plate")?;
    let ore = id_of(ctx, ProtoKind::Item, "iron-ore")?;
    let w = ctx.world_mut().ok_or_else(|| input_err("no world"))?;
    let stack = |id: u16| w.protos.item.stack_size[usize::from(id)] as i32;
    let (plates, ores) = (stack(plate), stack(ore));
    let mut serials = Vec::new();
    for (tx, ty) in tiles {
        w.make_modified(SurfaceIndex(0), tx, ty, tx + 1, ty + 1);
        let e = NewEntity {
            proto: chest,
            surface: 0,
            x2: 2 * tx + 1,
            y2: 2 * ty + 1,
            dir: Direction::North,
            flip: 0,
            quality: 0,
            built_by: 16,
            flags: EntityFlags::EMPTY,
            built_tick: Tick(0),
        };
        let (serial, h) = w.create_entity(&e).map_err(input_err)?;
        let inv = w.containers.inv[w.entities.pool_slot[crate::handle::slot(h) as usize] as usize];
        for (k, s) in w.heap.block_mut(inv).iter_mut().enumerate() {
            *s = if k % 2 == 0 {
                Slot { key: key_of(plate), count: plates }
            } else {
                Slot { key: key_of(ore), count: ores }
            };
        }
        serials.push(serial.0);
    }
    Ok(serials)
}

/// Round-trips the module through `sim_save` and `sim_load`, so a scenario starts from a state the loader
/// accepts (§8.2's validation) rather than from what a factory wrote.
fn reloaded(protos: &[u8], ctx: &SimContext) -> SimResult<SimContext> {
    super::reload(protos, ctx)
}

/// `m0-walk`: a dry new world; player 0 joins at tick 1 and walks east from tick 2 on, entering a new chunk
/// column every 213 ticks (32 tiles at 0.15 tiles per tick), each requesting 15 chunks that commit inline
/// (8 per tick) 30 ticks later.
pub fn m0_walk(protos: &[u8]) -> SimResult<Bench> {
    let mut b = Bench::new(new_world(protos, &dry_world())?);
    b.system(1, &joined(0))?;
    b.act(2, 0, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir: Direction::East }))?;
    Ok(b)
}

/// `m0-chests-10k`: a dry new world with 10,000 iron chests in a 100 × 100 block east of the spawn point (tiles
/// x 2–101, y −50–49), every slot full of iron plates and ore; player 0 standing at the spawn point; 32 chest
/// windows (`INVENTORY`) open on the chests of the block's first column, nearest first; the view around the
/// character, hovering the nearest chest. Returned after the join tick, from a reloaded state.
pub fn m0_chests_10k(protos: &[u8]) -> SimResult<(Bench, Vec<u32>)> {
    let mut ctx = new_world(protos, &dry_world())?;
    let serials = place_chests(&mut ctx, (0..10_000).map(|i| (2 + i / 100, -50 + i % 100)))?;
    let mut b = Bench::new(reloaded(protos, &ctx)?);
    b.system(1, &joined(0))?;
    b.run(1)?;
    // The first column holds serials[0..100] at y −50 … 49; the 32 nearest the character are y −16 … 15.
    let windows: Vec<u32> = serials[34..66].to_vec();
    let reqs: Vec<SubRequest<'_>> = windows
        .iter()
        .enumerate()
        .map(|(i, &s)| SubRequest {
            sub_id: SubId(i as u32 + 1),
            kind: ProjectionKind::Inventory,
            flags: SubFlags::EMPTY,
            target: s,
            p0: u32::from(InventoryType::Chest.value()),
            p1: 0,
            p2: 0,
            p3: 0,
            tail: None,
        })
        .collect();
    let mut input = Vec::new();
    schema::SubscribeInput { subs: MsgList::from_slice(&reqs) }
        .encode(&mut Writer::new(&mut input))
        .map_err(input_err)?;
    b.ctx.subscribe(&input)?;
    b.view = view_around(0, 0, serials[50]);
    Ok((b, windows))
}

/// `m0-codec`'s players and their actions per tick (4 × 25 = 100: 1,000 ticks make 100,000 actions).
pub const CODEC_PLAYERS: u16 = 4;
pub const CODEC_ACTIONS_PER_PLAYER: u32 = 25;

/// `m0-codec`: a dry new world with one chest beside the spawn point (tile (2, 0)) and four players at the spawn
/// point, joined at tick 1, each with ten stacks of iron plates in its main inventory. [`codec_tick`] queues a
/// tick's 100 actions, all of which the rules accept.
pub fn m0_codec(protos: &[u8]) -> SimResult<(Bench, u32)> {
    let mut ctx = new_world(protos, &dry_world())?;
    let chest = place_chests(&mut ctx, std::iter::once((2, 0)))?[0];
    let mut b = Bench::new(reloaded(protos, &ctx)?);
    for i in 0..CODEC_PLAYERS {
        b.system(1, &joined(i))?;
    }
    b.run(1)?;
    let plate = key_of(id_of(&b.ctx, ProtoKind::Item, "iron-plate")?);
    let w = b.ctx.world_mut().ok_or_else(|| input_err("no world"))?;
    let stack = w.protos.item.stack_size[usize::from(plate.0 >> 3)] as i32;
    for i in 0..CODEC_PLAYERS {
        let main = w.players.get(PlayerIndex(i)).ok_or_else(|| input_err("a player"))?.main;
        for s in w.heap.block_mut(main).iter_mut().take(10) {
            *s = Slot { key: plate, count: stack };
        }
    }
    // A fresh sequencer: the factory's world changed under the old one only in inventories.
    let ctx = reloaded(protos, &b.ctx)?;
    Ok((Bench::new(ctx), chest))
}

/// Queues `m0-codec`'s actions for tick `t`: per player, walking started and stopped twice, ten cursor
/// transfers out of a main-inventory slot and back, and the chest's limit bar.
pub fn codec_tick(b: &mut Bench, t: u32, chest: u32) -> SimResult<()> {
    let main = |slot: u16| InvSlot {
        owner: EntityRef { a: 0, b: 0, tag: EntityRefTag::None },
        inv: InventoryType::Main,
        slot,
    };
    let target = EntityRef { a: chest, b: 0, tag: EntityRefTag::Serial };
    for i in 0..CODEC_PLAYERS {
        let east = if t.is_multiple_of(2) { Direction::East } else { Direction::West };
        b.act(t, i, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir: east }))?;
        b.act(t, i, &Action::StopWalking(StopWalkingAction { input_gen: 0 }))?;
        for k in 0..20u16 {
            b.act(t, i, &Action::CursorTransfer(CursorTransferAction { slot: main(k / 2) }))?;
        }
        b.act(
            t,
            i,
            &Action::SetInventoryBar(SetInventoryBarAction {
                target,
                inv: InventoryType::Chest,
                bar: (t % 33) as u16,
            }),
        )?;
        b.act(t, i, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir: Direction::North }))?;
        b.act(t, i, &Action::StopWalking(StopWalkingAction { input_gen: 0 }))?;
    }
    Ok(())
}

/// `m0-load-30k`'s chunk count.
pub const LOAD_CHUNKS: usize = 30_000;
/// The version of [`m0_load_state`]: raise it with any change to the factory, so `simtool bench` rebuilds its
/// cached state (2: the dry map).
pub const LOAD_FACTORY_VERSION: u32 = 2;

/// `m0-load-30k`'s state (`SaveOutput`) with `chunks` generated chunks ([`LOAD_CHUNKS`] for the scenario; tests
/// use fewer): the dry map (so that the walk after the load keeps crossing pristine chunks), the chunks in a
/// square around the spawn point, every hundredth of them modified (a chunk record in the save), and player 0
/// at the spawn point. About 0.25 ms of worldgen per chunk: `simtool bench` caches the scenario's.
pub fn m0_load_state(protos: &[u8], chunks: usize) -> SimResult<Vec<u8>> {
    let mut ctx = new_world(protos, &dry_world())?;
    let w = ctx.world_mut().ok_or_else(|| input_err("no world"))?;
    let surface = SurfaceIndex(0);
    let mut n = w.chunks.generated().len();
    let mut k = 0usize;
    // The smallest square that holds them (174 × 174 for 30,000), filled row by row from its top.
    let mut side = 1;
    while side * side < chunks {
        side += 1;
    }
    let half = (side / 2) as i32;
    'square: for cy in -half..half + 1 {
        for cx in -half..half + 1 {
            if n >= chunks {
                break 'square;
            }
            let key = chunk_key(cx, cy);
            if w.chunks.is_generated(surface, key) {
                continue;
            }
            let data = w.regen.generate(surface, key);
            w.commit_generated(data);
            n += 1;
            k += 1;
            if k.is_multiple_of(100) {
                w.make_modified(surface, cx * 32, cy * 32, cx * 32 + 32, cy * 32 + 32);
            }
        }
    }
    let mut b = Bench::new(reloaded(protos, &ctx)?);
    b.system(1, &joined(0))?;
    b.run(1)?;
    b.ctx.checkpoint()
}

/// Drives `m0-load-30k` after its load: player 0 walks east from the next tick on.
pub fn m0_load_30k_walk(ctx: SimContext) -> SimResult<Bench> {
    let mut b = Bench::new(ctx);
    let t = b.tick() + 1;
    b.act(t, 0, &Action::StartWalking(StartWalkingAction { input_gen: 0, dir: Direction::East }))?;
    Ok(b)
}
