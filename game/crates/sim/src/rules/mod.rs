//! M0's rules (10 §5.1–§5.2, §15.3; I §3.1–§3.9): phase 1 applies a closure's actions through the action
//! pipeline and then advances each character. Every decision the spec leaves open follows the golden set's
//! reference model (test/golden/model/rules.ts) and its README's "Rules the golden set fixes", which the
//! comments cite as "rule n".
//!
//! **The pipeline** (§15.3; rule 12), per action of the closure, in order:
//! 1. the seq is consumed, refused or not (a player index without a record gets a watermark record);
//! 2. the generated decoder's field validation: `malformed`;
//! 3. the capability manifest (§2.4): `unsupported`;
//! 4. system actions apply here (§15.3: `player_joined`, `player_left`, `release_inputs`, `snapshot_marker`,
//!    `debug_dump`);
//! 5. presence: `player_not_present` without a record, offline, or without a character;
//! 6. input fencing (D22): a held-input action stamped with another input generation is an `input_fenced`
//!    event and nothing else;
//! 7. the action's own rules. A refusal is an `action_failed` event and **changes nothing** (§15.3; GATE-r1
//!    finding 4); the rules check everything before they change anything, and builds can verify it
//!    ([`Ctx::check_refusals`]).
//!
//! After every player action the acting player's main inventory is auto-sorted (rule 17), its inventory
//! version rises when the inventory or the hand changed (rule 14), and an applied action sets
//! `last_action_tick` (rule 13). Never a stopped tick: a closure that passed the preflight always runs whole.

mod character;
pub mod inventory;
mod player_actions;
mod system;

use crate::digest::Counters;
use crate::r#gen::Player;
use crate::presentation::EventSink;
use crate::spatial::Box2;
use crate::world::World;
use inventory::{Inv, Snapshot, hand_origin};
use schema::events::{ActionFailedEvent, EventPayload};
use schema::{
    Action, ClosureAction, EntityRef, EntityRefTag, FailReason, FinePos, InventoryType, ItemKey, PLAYERS,
    PlayerIndex, Seq, Serial, StatKey, StatKind, Tick, action_supported,
};

pub use character::resource_band;

pub use character::NEW_CHARACTER_DIR;

impl World {
    /// Pre-generation (§5.18): a character at `(x, y)` wants the chunks around it generated.
    pub(crate) fn pregen_around(
        &self,
        surface: schema::SurfaceIndex,
        x: f64,
        y: f64,
        wanted: &mut Vec<(schema::SurfaceIndex, i32, i32)>,
    ) {
        let (cx, cy) =
            (crate::chunks::tile_chunk(x.floor() as i32), crate::chunks::tile_chunk(y.floor() as i32));
        self.pregen_wanted(surface, cx, cy, wanted);
    }
}
pub use inventory::{EMPTY_HAND, NONE16};

/// A unit of hand mining or crafting completes in the tick its progress reaches 1 − 10⁻⁹ (rule 22).
pub const UNIT_DONE: f64 = 1.0 - 1e-9;

/// A character's displacement in its last update, in tiles (MOVERS' velocity, §15.4): written by the tick,
/// read by extraction; zero after a load until the character next moves.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Move {
    pub dx: f64,
    pub dy: f64,
}

/// Buffers the rules reuse, so a steady-state tick allocates nothing (§2.5).
#[derive(Clone, Debug, Default)]
pub struct RuleScratch {
    totals: Vec<(ItemKey, i64)>,
    before: Snapshot,
    inner: Snapshot,
    saved: Vec<schema::Slot>,
    moved: Vec<(ItemKey, i64)>,
}

/// What a tick's rules write besides the World: events, the statistics counters, the characters' motion.
pub struct Ctx<'a> {
    pub tick: Tick,
    pub events: &'a mut EventSink,
    pub counters: &'a mut Counters,
    pub scratch: &'a mut RuleScratch,
    pub moves: &'a mut [Move; PLAYERS],
    /// The chunks this tick's characters want generated (§5.18), `(surface, cy, cx)`.
    pub wanted: &'a mut Vec<(schema::SurfaceIndex, i32, i32)>,
    /// Verify that every refused action left the full state hash unchanged (tests; costs a state hash per
    /// action). A refusal that changed something panics, naming the action.
    pub check_refusals: bool,
}

impl Ctx<'_> {
    /// Queues an event of this tick (§15.6). Every field is a typed value, so a failure to encode is a bug.
    pub(crate) fn emit(&mut self, seq: Seq, player: PlayerIndex, payload: EventPayload) {
        if let Err(e) = self.events.push(self.tick, seq, player, &payload) {
            panic!("an event of tick {} does not encode: {e}", self.tick.0);
        }
    }

    /// `action_failed` (§15.6): the reason, where, and the entity concerned (0 none).
    fn failed(&mut self, seq: Seq, player: PlayerIndex, reason: FailReason, pos: FinePos, serial: Serial) {
        self.emit(seq, player, EventPayload::ActionFailed(ActionFailedEvent { reason, pos, serial }));
    }
}

/// Why an action was refused: the reason, where (the acting character when `None`) and the entity concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub reason: FailReason,
    pub pos: Option<FinePos>,
    pub serial: Serial,
}

pub type RuleResult = Result<(), Refusal>;

pub(crate) const fn fail(reason: FailReason) -> Refusal {
    Refusal { reason, pos: None, serial: Serial::NONE }
}

pub(crate) const fn fail_at(reason: FailReason, pos: FinePos) -> Refusal {
    Refusal { reason, pos: Some(pos), serial: Serial::NONE }
}

// ------------------------------------------------------------------------------------------- geometry

/// A position in 1/256 tile (types.yaml `FinePos`): round half up, `floor(v × 256 + 0.5)` (rule 32).
pub fn fine(v: f64) -> i32 {
    (v * 256.0 + 0.5).floor() as i32
}

pub fn fine_pos(x: f64, y: f64) -> FinePos {
    FinePos { x: fine(x), y: fine(y) }
}

/// Where an event about a player happens by default: its character, or the origin without one.
pub fn player_pos(p: Option<&Player>) -> FinePos {
    match p {
        Some(p) if !p.character.is_none() => fine_pos(p.x, p.y),
        _ => FinePos { x: 0, y: 0 },
    }
}

/// A tile's square.
pub const fn tile_box(tx: i32, ty: i32) -> Box2 {
    Box2 { x0: tx as f64, y0: ty as f64, x1: tx as f64 + 1.0, y1: ty as f64 + 1.0 }
}

/// Reach (I §3.1; rule 21): from the character to the target's box, squared, d² ≤ reach².
pub fn in_reach(p: &Player, b: &Box2, reach: f64) -> bool {
    b.dist2(p.x, p.y) <= reach * reach
}

/// The stat key of an item key (types.yaml `StatKey`: `(StatKind << 24) | id`).
pub const fn item_stat(key: ItemKey) -> StatKey {
    StatKey(((StatKind::Item as u32) << 24) | key.0 as u32)
}

impl World {
    /// The character prototype's index (the data stage guarantees one, C1b decision 5).
    pub(crate) fn character_proto(&self) -> usize {
        usize::from(self.protos.well_known.character.expect("the prototypes have a character").0)
    }

    /// The main inventory's size: the character prototype's `inventory_slots` (80, I §4.4).
    pub fn main_size(&self) -> u32 {
        u32::from(self.protos.entity.inventory_slots[self.character_proto()])
    }

    /// The reach for opening, transferring and mining entities (I §3.1).
    pub(crate) fn reach(&self) -> f64 {
        self.protos.entity.reach_distance[self.character_proto()]
    }

    /// A character's collision box at `(x, y)`.
    pub(crate) fn character_box(&self, x: f64, y: f64) -> Box2 {
        let c = self.character_proto();
        let e = &self.protos.entity;
        Box2 {
            x0: x + e.collision_x0[c],
            y0: y + e.collision_y0[c],
            x1: x + e.collision_x1[c],
            y1: y + e.collision_y1[c],
        }
    }

    pub(crate) fn player(&self, pi: PlayerIndex) -> &Player {
        self.players.get(pi).unwrap_or_else(|| panic!("no record of player {}", pi.0))
    }

    pub(crate) fn player_mut(&mut self, pi: PlayerIndex) -> &mut Player {
        self.players.get_mut(pi).unwrap_or_else(|| panic!("no record of player {}", pi.0))
    }

    /// The acting player's main inventory, its origin slot reserved while the hand holds a stack from it.
    pub(crate) fn main_inv(&self, pi: PlayerIndex) -> Inv {
        let p = self.player(pi);
        let size = self.main_size();
        Inv { r: p.main, size, bar: size, origin: hand_origin(&p.hand) }
    }

    /// The chest inventory of the live entity in entity-table row `row`, with its limit bar.
    pub(crate) fn chest_inv(&self, row: u32) -> Inv {
        let r = row as usize;
        let size = u32::from(self.protos.entity.inventory_slots[usize::from(self.entities.proto[r].0)]);
        let inv = self.containers.inv[self.entities.pool_slot[r] as usize];
        let bar = self.heap.bar(inv).map_or(size, u32::from);
        Inv { r: inv, size, bar, origin: None }
    }

    /// An entity's centre as a `FinePos`: x2 / 2 tiles = x2 × 128 positions, exactly.
    pub(crate) fn entity_pos(&self, row: u32) -> FinePos {
        let r = row as usize;
        FinePos { x: self.entities.x2[r].wrapping_mul(128), y: self.entities.y2[r].wrapping_mul(128) }
    }

    /// Auto-sorts a player's main inventory when its setting is on (D11; rule 17).
    pub(crate) fn sort_main(&mut self, pi: PlayerIndex, scratch: &mut RuleScratch) {
        let p = self.player(pi);
        if !p.auto_sort || p.main.is_none() {
            return;
        }
        let (r, origin) = (p.main, hand_origin(&p.hand));
        let size = self.main_size();
        inventory::sort_block(&mut self.heap, &self.protos, r, size, origin, &mut scratch.totals);
    }

    // --------------------------------------------------------------------------------------- references

    /// An entity reference (§15.3, D23): tag 1 through the serial index, tag 2 through the acting player's
    /// creation ring; never by position. Characters are not entities (rule 18). The entity-table row.
    pub(crate) fn resolve(&self, pi: PlayerIndex, r: &EntityRef) -> Option<u32> {
        let serial = match r.tag {
            EntityRefTag::Serial => Serial(r.a),
            EntityRefTag::Creation => {
                let c = self.player(pi).creation_ring.iter().find(|c| c.seq.0 == r.a)?;
                if r.b >= c.count {
                    return None;
                }
                Serial(c.first_serial.0.wrapping_add(u32::from(r.b)))
            }
            EntityRefTag::None => return None,
        };
        self.entity(serial).map(crate::handle::slot)
    }

    /// The entity `r` names, in reach: `target_gone`, then `out_of_reach`.
    pub(crate) fn resolve_in_reach(&self, pi: PlayerIndex, r: &EntityRef) -> Result<u32, Refusal> {
        let row = self.resolve(pi, r).ok_or(fail(FailReason::TargetGone))?;
        if !in_reach(self.player(pi), &self.collision_box(row), self.reach()) {
            return Err(fail_at(FailReason::OutOfReach, self.entity_pos(row)));
        }
        Ok(row)
    }

    /// An inventory slot named by an action (types.yaml `InvSlot`; rule 18): owner tag 0 is the main
    /// inventory and needs `inv = main`; an entity's needs the entity in reach and its own type. Checks:
    /// target, reach, inventory type, slot. Returns the inventory, the owning row and the slot.
    pub(crate) fn resolve_slot(
        &self,
        pi: PlayerIndex,
        s: &schema::InvSlot,
    ) -> Result<(Inv, Option<u32>, u32), Refusal> {
        let (inv, owner) = if s.owner.tag == EntityRefTag::None {
            if s.inv != InventoryType::Main {
                return Err(fail(FailReason::InvalidIndex));
            }
            (self.main_inv(pi), None)
        } else {
            let row = self.resolve_in_reach(pi, &s.owner)?;
            if s.inv != InventoryType::Chest {
                return Err(fail_at(FailReason::InvalidIndex, self.entity_pos(row)));
            }
            (self.chest_inv(row), Some(row))
        };
        if u32::from(s.slot) >= inv.size {
            return Err(match owner {
                Some(row) => fail_at(FailReason::InvalidIndex, self.entity_pos(row)),
                None => fail(FailReason::InvalidIndex),
            });
        }
        Ok((inv, owner, u32::from(s.slot)))
    }

    /// The "other" inventory of a transfer (I §3.8): tag 0 the player's main inventory, else the entity's.
    pub(crate) fn resolve_other(
        &self,
        pi: PlayerIndex,
        r: &EntityRef,
    ) -> Result<(Inv, Option<u32>), Refusal> {
        if r.tag == EntityRefTag::None {
            return Ok((self.main_inv(pi), None));
        }
        let row = self.resolve_in_reach(pi, r)?;
        Ok((self.chest_inv(row), Some(row)))
    }

    // --------------------------------------------------------------------------------------- the pipeline

    /// Applies one action of the closure (§15.3, §4.6 phase 1; rule 12).
    pub(crate) fn apply_action(&mut self, ctx: &mut Ctx<'_>, a: &ClosureAction<'_>) {
        let seq = Seq(a.seq);
        self.consume_seq(a.system, a.player, seq);
        let pos =
            |w: &World| if a.system { FinePos { x: 0, y: 0 } } else { player_pos(w.players.get(a.player)) };
        let Ok(act) = Action::decode(a.ty, a.payload) else {
            ctx.failed(seq, a.player, FailReason::Malformed, pos(self), Serial::NONE);
            return;
        };
        if !action_supported(act.action_type()) {
            ctx.failed(seq, a.player, FailReason::Unsupported, pos(self), Serial::NONE);
            return;
        }
        if a.system {
            self.apply_system(ctx, &act, seq, a.player);
            return;
        }
        let pi = a.player;
        let p = self.player(pi);
        if !p.online || p.character.is_none() {
            ctx.failed(seq, pi, FailReason::PlayerNotPresent, player_pos(Some(p)), Serial::NONE);
            return;
        }
        if act.input_gen().is_some_and(|g| g != p.input_gen) {
            ctx.emit(seq, pi, EventPayload::InputFenced);
            return;
        }
        let check = ctx.check_refusals.then(|| crate::save::state_hash(self).map(|h| h.full).ok()).flatten();
        let size = self.main_size();
        ctx.scratch.before.take(&self.heap, p.main, size, &p.hand);
        let r = self.apply_player_action(ctx, pi, seq, &act);
        self.sort_main(pi, ctx.scratch);
        let p = self.player(pi);
        let changed = ctx.scratch.before.differs(&self.heap, p.main, size, &p.hand);
        let p = self.player_mut(pi);
        if changed {
            p.inventory_version = p.inventory_version.wrapping_add(1);
        }
        match r {
            Ok(()) => p.last_action_tick = ctx.tick,
            Err(f) => {
                if let Some(before) = check {
                    let after = crate::save::state_hash(self).map(|h| h.full).ok();
                    assert_eq!(
                        Some(before),
                        after,
                        "the refused {} (reason {:?}) of player {} at tick {} changed the state (§15.3)",
                        act.action_type().name(),
                        f.reason,
                        pi.0,
                        ctx.tick.0
                    );
                }
                let pos = f.pos.unwrap_or_else(|| player_pos(self.players.get(pi)));
                ctx.failed(seq, pi, f.reason, pos, f.serial);
            }
        }
    }

    /// §15.3 "Identity and seq": every action consumes its seq, refused or not. A player index without a record
    /// gets a watermark record (rule 12).
    pub(crate) fn consume_seq(&mut self, system: bool, player: PlayerIndex, seq: Seq) {
        if system {
            self.globals.last_system_seq = seq;
            return;
        }
        debug_assert!(usize::from(player.0) < PLAYERS, "the preflight bounds player indexes");
        if self.players.get(player).is_none() {
            self.players.insert(system::watermark_player(player));
        }
        if let Some(p) = self.players.get_mut(player) {
            p.last_seq = seq;
        }
    }
}

pub use system::watermark_player;
