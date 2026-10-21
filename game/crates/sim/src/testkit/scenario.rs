//! The scenario DSL (10 §10.2): a world, players acting through the [`TestSequencer`], ticks, assertions on
//! the World and its events, and the D18 checks over the closures the run recorded:
//! [`Scenario::check_equivalence`] runs them again under NO_SLEEP, through a save and a load at seeded ticks,
//! and in heavy mode, comparing the full canonical state after every tick for the first 2,000 ticks (D18 a–c);
//! [`Scenario::write_log`] records the run as a closure log with its start state and final hash, which the
//! replay test replays (D18 e).
//!
//! C8 added the rest of §10.2's DSL: [`Scenario::from_layout`] (a start state from an ASCII layout, `layout.rs`),
//! and the helpers `entity_at`, `stats` (`produced`, `consumed`, `handcrafted` by item name), `hash`, `digest`,
//! `reload` (a save and a load into a fresh module mid-run, D18 a's step), `place` (a build through player i's
//! actions) and `insert` (every stack of an item into an entity, by Ctrl+click), each driven through closures.

use super::layout::{self, Layout};
use super::{Closures, Variant, check_equivalence, start_from};
use crate::context::SimContext;
use crate::r#gen::Player;
use crate::rules::inventory::{self, Inv, key_of};
use crate::rules::item_stat;
use crate::world::{NewEntity, World, pool_kind};
use crate::{SimError, SimResult};
use schema::codec::{Fixed, Packed, Reader, Writer};
use schema::container::{
    CLOSURE_LOG_FORMAT_VERSION, CLOSURE_LOG_MAGIC, ClosureLogFlags, ClosureLogHeader, ClosureRecord,
};
use schema::events::{EventHeader, EventPayload, read_event};
use schema::{
    ACTION_SCHEMA_VERSION, Action, BuildAction, BuildFlags, BuildMode, CursorTransferAction, EntityFlags,
    EntityRef, EntityRefTag, Hash256, InvSlot, InventoryTransferAction, InventoryType, ItemKey, MapSettings,
    NewWorld, PlayerIndex, PoolKind, ProtoKind, Seq, Serial, SimFlags, SimStatus, SurfaceIndex, Tick,
    TilePos2,
};
use std::collections::BTreeMap;

use super::sequencer::TestSequencer;

/// The closures a scenario recorded, by tick.
#[derive(Clone, Debug, Default)]
pub struct Recorded(pub BTreeMap<u32, Vec<u8>>);

impl Closures for Recorded {
    fn closure(&self, tick: u32) -> Vec<u8> {
        self.0.get(&tick).cloned().unwrap_or_default()
    }
}

/// A scenario: one module running "as written", its sequencer, and what the run recorded.
pub struct Scenario {
    pub name: String,
    protos: Vec<u8>,
    /// The start state (`sim_save`'s output).
    start: Vec<u8>,
    start_tick: u32,
    pub ctx: SimContext,
    pub seq: TestSequencer,
    closures: Recorded,
    digests: Vec<u64>,
}

impl Scenario {
    /// A scenario on a new world (`sim_new_world`: the spawn area generated inline).
    pub fn new_world(name: &str, protos: &[u8], nw: &NewWorld) -> SimResult<Self> {
        let mut c = SimContext::new();
        c.init_protos(protos, SimFlags::EMPTY)?;
        let mut rec = Vec::new();
        nw.encode(&mut Writer::new(&mut rec))
            .map_err(|e| SimError::new(schema::SimStatus::ErrInput, e.to_string()))?;
        c.new_world(&rec)?;
        let start = c.checkpoint()?;
        Self::from_state(name, protos, &start)
    }

    /// A scenario from a state (`SaveOutput` bytes).
    pub fn from_state(name: &str, protos: &[u8], state: &[u8]) -> SimResult<Self> {
        let mut ctx = start_from(protos, state, SimFlags::EMPTY)?;
        ctx.set_check_refusals(true);
        let seq = TestSequencer::new(&ctx);
        let start_tick = ctx.world().map_or(0, World::current_tick);
        Ok(Self {
            name: name.to_owned(),
            protos: protos.to_vec(),
            start: state.to_vec(),
            start_tick,
            ctx,
            seq,
            closures: Recorded::default(),
            digests: Vec::new(),
        })
    }

    /**
     * A scenario on a layout (10 §10.2, `layout.rs`): a new world with `opts`'s seed (by default without water,
     * so every tile of the grid is land), the layout's entities and their contents created as a fixture, then the
     * state saved and loaded into a fresh module (the loader validates it), as the benchmark factories do. Returns
     * the layout and the serial of each placed entity, in the layout's reading order. Everything after the start
     * goes through closures; players join with `system(player_joined)` and stand on the layout's `@`.
     */
    pub fn from_layout(
        name: &str,
        protos: &[u8],
        text: &str,
        opts: LayoutOpts,
    ) -> SimResult<(Self, Layout, Vec<Serial>)> {
        let layout = layout::parse(text).map_err(|e| SimError::new(SimStatus::ErrInput, e))?;
        let mut nw = NewWorld { seed: opts.seed, ..NewWorld::default() };
        if opts.dry {
            nw.map = MapSettings { water_coverage: 0.0, ..MapSettings::default() };
        }
        let mut c = SimContext::new();
        c.init_protos(protos, SimFlags::EMPTY)?;
        let mut rec = Vec::new();
        nw.encode(&mut Writer::new(&mut rec)).map_err(enc)?;
        c.new_world(&rec)?;
        let serials = place_layout(&mut c, &layout)?;
        let start = c.checkpoint()?;
        Ok((Self::from_state(name, protos, &start)?, layout, serials))
    }

    pub fn world(&self) -> &World {
        self.ctx.world().expect("a scenario has a world")
    }

    /// The entity whose footprint covers tile `(tx, ty)` of the first surface.
    pub fn entity_at(&self, tx: i32, ty: i32) -> Option<Serial> {
        let w = self.world();
        let h = w.entity_on_tile(SurfaceIndex(0), tx, ty)?;
        Some(w.entities.serial[crate::handle::slot(h) as usize])
    }

    /// The production statistics (§5.20) by item name: [`ItemStats::produced`] and the others.
    pub fn stats(&self) -> ItemStats<'_> {
        ItemStats { world: self.world() }
    }

    /// The full state hash (§4.8).
    pub fn hash(&self) -> u64 {
        self.ctx.state_hashes().expect("the state hashes").full
    }

    /// The last tick's digest d_t and the lineage r_t (§4.8).
    pub fn digest(&self) -> (u64, u64) {
        (self.ctx.last_digest(), self.ctx.lineage())
    }

    /// D18 a's step in the middle of a run: the world saved and loaded into a fresh module, which carries on. The
    /// recorded closures and digests continue unchanged (a reload changes nothing; `check_equivalence` proves it).
    pub fn reload(&mut self) {
        let save = self.ctx.checkpoint().expect("sim_save");
        let mut fresh = start_from(&self.protos, &save, self.ctx.flags()).expect("sim_load");
        fresh.set_check_refusals(true);
        self.ctx = fresh;
    }

    /// The lowest main-inventory slot of player `i` holding `key`.
    pub fn slot_of(&self, i: u16, key: ItemKey) -> Option<u16> {
        let p = self.player(i);
        let size = self.world().main_size() as usize;
        self.world().heap.block(p.main)[..size]
            .iter()
            .position(|x| x.key == key && x.count > 0)
            .map(|k| k as u16)
    }

    /// An item key by name, at normal quality.
    pub fn item(&self, name: &str) -> ItemKey {
        let id =
            self.world().protos.names.find(ProtoKind::Item, name).unwrap_or_else(|| panic!("no item {name}"));
        key_of(id)
    }

    /// Places `item` on tile `(tx, ty)` (a 1 × 1 entity) through player `i`'s actions: LMB on its stack (into the
    /// hand), then a build; two ticks. Returns the build's seq (its creation id is `(seq, 0)`).
    pub fn place(&mut self, i: u16, item: &str, tx: i32, ty: i32) -> Seq {
        let key = self.item(item);
        let k = self.slot_of(i, key).unwrap_or_else(|| panic!("{}: player {i} holds no {item}", self.name));
        let main = InvSlot { owner: NONE, inv: InventoryType::Main, slot: k };
        self.act(i, Action::CursorTransfer(CursorTransferAction { slot: main }));
        self.run(1);
        let seq = self.act(
            i,
            Action::Build(BuildAction {
                item: key,
                pos: TilePos2 { x2: 2 * tx + 1, y2: 2 * ty + 1 },
                dir: schema::Direction::North,
                flip: false,
                mode: BuildMode::Normal,
                flags: BuildFlags::EMPTY,
                drag_id: 0,
            }),
        );
        self.run(1);
        seq
    }

    /// Moves every stack of `item` in player `i`'s main inventory into the entity `serial` (Ctrl+LMB on a stack,
    /// I §3.8: "every stack of that item"); one tick.
    pub fn insert(&mut self, i: u16, serial: Serial, item: &str) {
        let key = self.item(item);
        let k = self.slot_of(i, key).unwrap_or_else(|| panic!("{}: player {i} holds no {item}", self.name));
        let from = InvSlot { owner: NONE, inv: InventoryType::Main, slot: k };
        let to = EntityRef { tag: EntityRefTag::Serial, a: serial.0, b: 0 };
        self.act(i, Action::InventoryTransfer(InventoryTransferAction { from, to }));
        self.run(1);
    }

    /// The current tick (the last one run).
    pub fn tick(&self) -> u32 {
        self.world().current_tick()
    }

    pub fn player(&self, i: u16) -> &Player {
        self.world().players.get(PlayerIndex(i)).unwrap_or_else(|| panic!("no player {i}"))
    }

    /// Queues an action of player `i` for the next tick and returns its seq (a creation id's `a`); held inputs
    /// are stamped with the sequencer's input generation.
    pub fn act(&mut self, i: u16, a: Action<'_>) -> Seq {
        let t = self.tick() + 1;
        self.act_at(t, i, a)
    }

    /// Queues an action of player `i` for tick `t`, stamped now (D22: a release queued before `t` fences it).
    pub fn act_at(&mut self, t: u32, i: u16, a: Action<'_>) -> Seq {
        self.seq.push(t, PlayerIndex(i), &a).unwrap_or_else(|e| panic!("{}: {e}", self.name))
    }

    /// Queues a system action for the next tick.
    pub fn system(&mut self, a: Action<'_>) -> Seq {
        let t = self.tick() + 1;
        self.system_at(t, a)
    }

    /// Queues a system action for tick `t`.
    pub fn system_at(&mut self, t: u32, a: Action<'_>) -> Seq {
        self.seq.push_system(t, &a).unwrap_or_else(|e| panic!("{}: {e}", self.name))
    }

    /// Runs `n` ticks.
    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            let t = self.tick() + 1;
            let closure = self.seq.closure(t);
            self.ctx.tick(&closure).unwrap_or_else(|e| panic!("{}: tick {t}: {e}", self.name));
            if !closure.is_empty() {
                self.closures.0.insert(t, closure);
            }
            self.digests.push(self.ctx.last_digest());
        }
    }

    /// Runs until tick `t`.
    pub fn run_until(&mut self, t: u32) {
        let now = self.tick();
        assert!(t >= now, "{}: tick {t} has passed", self.name);
        self.run(t - now);
    }

    /// The queued events, decoded, and empties the queue.
    pub fn events(&mut self) -> Vec<(EventHeader, EventPayload)> {
        let mut out = Vec::new();
        self.ctx.pres.events.drain(&mut out);
        let mut r = Reader::new(&out);
        let mut v = Vec::new();
        while !r.is_empty() {
            v.push(read_event(&mut r).expect("the sim's events decode"));
        }
        v
    }

    /// How many ticks the scenario ran.
    pub fn ticks(&self) -> u32 {
        self.tick() - self.start_tick
    }

    /// D18 (a, b, c): the recorded closures from the start state as written, under NO_SLEEP, through a save
    /// and a load after each tick of `reload_at`, and in heavy mode every `heavy` ticks; the full canonical state
    /// after every tick (the first 2,000) and every d_t and r_t must agree.
    pub fn check_equivalence(&self, reload_at: &[u32], heavy: u32) -> Result<(), String> {
        let mut variants = vec![Variant::NoSleep, Variant::Heavy { every: heavy }];
        variants.extend(reload_at.iter().map(|&at| Variant::Reload { at: self.start_tick + at }));
        check_equivalence(&self.protos, &self.start, &self.closures, self.ticks(), &variants)
    }

    /// The recorded closures.
    pub fn closures(&self) -> &Recorded {
        &self.closures
    }

    /// The start state (`SaveOutput` bytes) and its tick.
    pub fn start_state(&self) -> (&[u8], u32) {
        (&self.start, self.start_tick)
    }

    /// The prototypes the scenario runs with.
    pub fn protos(&self) -> &[u8] {
        &self.protos
    }

    /// The run as a closure log (§8.5, `HAS_DIGESTS`), its start state (`SaveOutput`) and a summary line with the
    /// final full state hash and lineage (D18 e: a replay reaches them).
    pub fn log_files(&self) -> SimResult<(Vec<u8>, Vec<u8>, String)> {
        let start_hash = {
            let c = start_from(&self.protos, &self.start, SimFlags::EMPTY)?;
            c.state_hashes()?.full
        };
        let mut records = Vec::new();
        for (&t, c) in &self.closures.0 {
            ClosureRecord { tick: Tick(t), closure: c }
                .encode(&mut Writer::new(&mut records))
                .map_err(enc)?;
        }
        let header = ClosureLogHeader {
            magic: CLOSURE_LOG_MAGIC,
            format_version: CLOSURE_LOG_FORMAT_VERSION,
            action_schema_version: ACTION_SCHEMA_VERSION,
            flags: ClosureLogFlags::HAS_DIGESTS,
            start_tick: Tick(self.start_tick),
            end_tick: Tick(self.tick()),
            build_hash: Hash256 { bytes: [0; 32] },
            prototypes_hash: Hash256 { bytes: crate::sha256::sha256(&self.protos) },
            start_state_hash: start_hash,
            record_count: self.closures.0.len() as u32,
            record_bytes: records.len() as u32,
            digest_first_tick: Tick(self.start_tick + 1),
            digest_count: self.digests.len() as u32,
            blob_count: 0,
            blob_bytes: 0,
        };
        let mut log = Vec::new();
        let mut w = Writer::new(&mut log);
        header.write(&mut w, "ClosureLogHeader").map_err(enc)?;
        w.bytes(&records);
        for d in &self.digests {
            w.u64(*d);
        }
        let h = self.ctx.state_hashes()?;
        let summary = format!(
            "{} ticks {}..{} state {:016x} r {:016x}\n",
            self.name,
            self.start_tick,
            self.tick(),
            h.full,
            self.ctx.lineage()
        );
        Ok((log, self.start.clone(), summary))
    }
}

const NONE: EntityRef = EntityRef { tag: EntityRefTag::None, a: 0, b: 0 };

/// How [`Scenario::from_layout`] makes its world.
#[derive(Clone, Copy, Debug)]
pub struct LayoutOpts {
    pub seed: u32,
    /// No water (the default), so the grid lies on land.
    pub dry: bool,
}

impl Default for LayoutOpts {
    fn default() -> Self {
        Self { seed: 1, dry: true }
    }
}

/// The production statistics by item name (§5.20).
#[derive(Clone, Copy)]
pub struct ItemStats<'a> {
    world: &'a World,
}

impl ItemStats<'_> {
    fn stat(&self, name: &str) -> Option<&crate::r#gen::Stat> {
        let id = self.world.protos.names.find(ProtoKind::Item, name)?;
        let key = item_stat(key_of(id));
        self.world.stats().iter().find(|s| s.key == key)
    }

    /// Items of `name` produced so far (hand mining and crafting in M0).
    pub fn produced(&self, name: &str) -> f64 {
        self.stat(name).map_or(0.0, |s| s.produced_total)
    }

    pub fn consumed(&self, name: &str) -> f64 {
        self.stat(name).map_or(0.0, |s| s.consumed_total)
    }

    pub fn handcrafted(&self, name: &str) -> f64 {
        self.stat(name).map_or(0.0, |s| s.handcrafted_total)
    }
}

/// Creates a layout's entities and their contents (a fixture, as `bench::place_chests` does).
fn place_layout(ctx: &mut SimContext, l: &Layout) -> SimResult<Vec<Serial>> {
    let bad = |m: String| SimError::new(SimStatus::ErrInput, m);
    let w = ctx.world_mut().ok_or_else(|| bad("no world".to_owned()))?;
    let mut serials = Vec::new();
    for p in &l.placed {
        let e = &p.entry;
        let proto = w
            .protos
            .names
            .find(ProtoKind::Entity, &e.entity)
            .ok_or_else(|| bad(format!("{}: no entity {} in these prototypes", p.ch, e.entity)))?;
        let i = usize::from(proto);
        let (sw, sh) = (i32::from(w.protos.entity.size_w[i]), i32::from(w.protos.entity.size_h[i]));
        let (tx, ty) = p.tile;
        w.make_modified(SurfaceIndex(0), tx, ty, tx + sw, ty + sh);
        let (serial, h) = w
            .create_entity(&NewEntity {
                proto: schema::EntityId(proto),
                surface: 0,
                x2: 2 * tx + sw,
                y2: 2 * ty + sh,
                dir: e.dir,
                flip: 0,
                quality: 0,
                built_by: 16,
                flags: EntityFlags::EMPTY,
                built_tick: Tick(0),
            })
            .map_err(|m| bad(format!("{} at {:?}: {m}", e.entity, p.tile)))?;
        if !e.items.is_empty() {
            let t = w.protos.entity.r#type[i];
            if pool_kind(t) != Some(PoolKind::Container) {
                return Err(bad(format!("{}: items go into containers only", e.entity)));
            }
            let row = w.entities.pool_slot[crate::handle::slot(h) as usize] as usize;
            let r = w.containers.inv[row];
            let size = u32::from(w.protos.entity.inventory_slots[i]);
            let inv = Inv { r, size, bar: size, origin: None };
            for (name, n) in &e.items {
                let item = w
                    .protos
                    .names
                    .find(ProtoKind::Item, name)
                    .ok_or_else(|| bad(format!("no item {name}")))?;
                let put = inventory::insert(&mut w.heap, &w.protos, &inv, key_of(item), i64::from(*n));
                if put != i64::from(*n) {
                    return Err(bad(format!("{}: {n} {name} do not fit ({put} did)", e.entity)));
                }
            }
        }
        serials.push(serial);
    }
    Ok(serials)
}

fn enc(e: schema::codec::EncodeError) -> SimError {
    SimError::new(schema::SimStatus::ErrInput, e.to_string())
}
