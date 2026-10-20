//! System actions (§15.3; rules 8, 9, 12): joins and leaves, released inputs, and the markers that change
//! nothing in the World. Their events carry seq 0 and the player they concern.

use super::inventory::{self, EMPTY_HAND, Inv, hand_origin, stack_size};
use super::{Ctx, NEW_CHARACTER_DIR};
use crate::r#gen::{MiningState, Player};
use crate::world::World;
use schema::events::EventPayload;
use schema::{Action, Direction, InvRef, ItemKey, PlayerIndex, Seq, Serial, SurfaceIndex, Tick};

/// A player record without a character (rule 12): what the World keeps for a player index that sent an action
/// before it joined, so that its seqs stay consumed across ticks, saves and its later join. Offline, every
/// other field at its default (no inventory, an empty hand).
pub fn watermark_player(index: PlayerIndex) -> Player {
    Player {
        index,
        online: false,
        character: Serial::NONE,
        input_gen: 0,
        last_seq: Seq(0),
        creation_ring: Vec::new(),
        inventory_version: 0,
        main: InvRef::NONE,
        hand: EMPTY_HAND,
        surface: SurfaceIndex(0),
        x: 0.0,
        y: 0.0,
        walking: false,
        walking_dir: Direction::North,
        mining: MiningState::default(),
        picking: false,
        crafting_queue: Vec::new(),
        auto_sort: true,
        pick_ghost_cursor: false,
        hand_crafted: 0.0,
        last_action_tick: Tick(0),
    }
}

/// Stops walking, mining and picking and raises the input generation (D22): `release_inputs` and
/// `player_left` (rule 9).
fn release(p: &mut Player) {
    p.walking = false;
    p.mining = MiningState::default();
    p.picking = false;
    p.input_gen = p.input_gen.wrapping_add(1);
}

impl World {
    /// A new player (§15.3 `player_joined`, §5.1; rule 8): a character with the next serial at the spawn point
    /// (0, 0), facing south, an empty hand and the start inventory (`meta.start.inventory`), auto-sort on.
    pub(crate) fn new_player(&mut self, index: PlayerIndex, scratch: &mut super::RuleScratch) -> Player {
        let character = self.globals.next_serial;
        self.globals.next_serial =
            Serial(character.0.checked_add(1).expect("the serial counter is exhausted"));
        let size = self.main_size();
        let main = self.heap.alloc(size);
        let mut p = watermark_player(index);
        p.online = true;
        p.character = character;
        p.main = main;
        p.walking_dir = NEW_CHARACTER_DIR;
        let inv = Inv { r: main, size, bar: size, origin: None };
        for s in &self.protos.start.inventory {
            inventory::insert(
                &mut self.heap,
                &self.protos,
                &inv,
                inventory::key_of(s.item.0),
                i64::from(s.count),
            );
        }
        inventory::sort_block(&mut self.heap, &self.protos, main, size, None, &mut scratch.totals);
        p
    }

    /// Applies a system action of the batch with `seq` (its refusals carry the system batch's player).
    pub(crate) fn apply_system(&mut self, ctx: &mut Ctx<'_>, act: &Action<'_>, seq: Seq, batch: PlayerIndex) {
        match act {
            Action::PlayerJoined(a) => self.player_joined(ctx, a.player, seq, batch),
            Action::PlayerLeft(a) => self.player_left(ctx, a.player),
            Action::ReleaseInputs(a) => {
                if let Some(p) = self.players.get_mut(a.player) {
                    release(p);
                }
            }
            // Nothing in the World (§15.3); the shell acts on them.
            Action::SnapshotMarker(_) | Action::DebugDump(_) => {}
            // Player actions: the preflight refuses them in a system batch.
            Action::StartWalking(_)
            | Action::StopWalking(_)
            | Action::BeginMining(_)
            | Action::BeginMiningTerrain(_)
            | Action::StopMining(_)
            | Action::ChangePickingState(_)
            | Action::Build(_)
            | Action::RotateEntity(_)
            | Action::FlipEntity(_)
            | Action::StopDragBuild(_)
            | Action::RemoveCables(_)
            | Action::WireDragging(_)
            | Action::Pipette(_)
            | Action::ClearCursor(_)
            | Action::SetGhostCursor(_)
            | Action::QuickBarPickSlot(_)
            | Action::QuickBarSetSlot(_)
            | Action::ChangeActiveQuickBar(_)
            | Action::CursorTransfer(_)
            | Action::CursorSplit(_)
            | Action::StackTransfer(_)
            | Action::StackSplit(_)
            | Action::InventoryTransfer(_)
            | Action::InventorySplit(_)
            | Action::FastEntityTransfer(_)
            | Action::FastEntitySplit(_)
            | Action::DropItem(_)
            | Action::SetFilter(_)
            | Action::SetInventoryBar(_)
            | Action::Craft(_)
            | Action::CancelCraft(_)
            | Action::SetupAssemblingMachine(_)
            | Action::ResetAssemblingMachine(_)
            | Action::SetInserterMaxStackSize(_)
            | Action::SetSplitterPriority(_)
            | Action::CopyEntitySettings(_)
            | Action::PasteEntitySettings(_)
            | Action::StartResearch(_)
            | Action::CancelResearch(_)
            | Action::MoveResearch(_)
            | Action::Undo(_)
            | Action::Redo(_)
            | Action::ConsoleCommand(_)
            | Action::SetPlayerSetting(_)
            | Action::SetGameSetting(_)
            | Action::Distribute(_)
            | Action::PlaceBlueprint(_)
            | Action::Rename(_)
            | Action::SetHallMode(_)
            | Action::LaunchEmpty(_)
            | Action::SetResearchScheduling(_) => {
                unreachable!("{} in a system batch", act.action_type().name())
            }
        }
    }

    /// `player_joined` (rule 8): a returning player gets the same character back (11 §4.5); joining while
    /// online changes nothing; whether the character exists decides, not the `returning` flag. A watermark
    /// record keeps its seq watermark and input generation.
    fn player_joined(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex, seq: Seq, batch: PlayerIndex) {
        // A new character needs a serial and an inventory block (C2b-r1 finding 5): without them the join is
        // refused (an engine limit, `unsupported`) and changes nothing, never a trap.
        let needs_character = self.players.get(pi).is_none_or(|p| p.character.is_none());
        if needs_character
            && (self.globals.next_serial.0 == u32::MAX || !self.heap.can_alloc(self.main_size()))
        {
            ctx.emit(
                seq,
                batch,
                EventPayload::ActionFailed(schema::events::ActionFailedEvent {
                    reason: schema::FailReason::Unsupported,
                    pos: schema::FinePos { x: 0, y: 0 },
                    serial: Serial::NONE,
                }),
            );
            return;
        }
        match self.players.get_mut(pi) {
            Some(p) if !p.character.is_none() => {
                if p.online {
                    return;
                }
                p.online = true;
            }
            existing => {
                let kept = existing.map(|p| (p.last_seq, p.input_gen));
                let mut fresh = self.new_player(pi, ctx.scratch);
                if let Some((last_seq, input_gen)) = kept {
                    fresh.last_seq = last_seq;
                    fresh.input_gen = input_gen;
                }
                self.players.insert(fresh);
            }
        }
        let p = self.player(pi);
        self.pregen_around(p.surface, p.x, p.y, ctx.wanted);
        ctx.emit(Seq(0), pi, EventPayload::PlayerJoined);
    }

    /// `player_left` (rule 9; §5.1, R26): inputs released for any player with a record; an online one goes
    /// offline, and its hand returns to the main inventory only if all of it fits (origin slot first),
    /// otherwise it stays in the hand. The character stays, with its inventory and crafting queue.
    fn player_left(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex) {
        let Some(p) = self.players.get_mut(pi) else {
            return;
        };
        release(p);
        if !p.online {
            return;
        }
        p.online = false;
        if p.hand.ghost {
            p.hand = EMPTY_HAND;
        } else if p.hand.count > 0 {
            let size = self.main_size();
            let p = self.player(pi);
            ctx.scratch.before.take(&self.heap, p.main, size, &p.hand);
            let (key, n, origin, main) = (p.hand.key, i64::from(p.hand.count), hand_origin(&p.hand), p.main);
            let free = Inv { r: main, size, bar: size, origin: None };
            if inventory::room(&self.heap, &self.protos, &free, key, n) == n {
                self.player_mut(pi).hand = EMPTY_HAND;
                let left = self.put_back(main, origin, key, n);
                inventory::insert(&mut self.heap, &self.protos, &free, key, left);
                self.sort_main(pi, ctx.scratch);
            }
            let p = self.player(pi);
            if ctx.scratch.before.differs(&self.heap, p.main, size, &p.hand) {
                let p = self.player_mut(pi);
                p.inventory_version = p.inventory_version.wrapping_add(1);
            }
        }
        ctx.emit(Seq(0), pi, EventPayload::PlayerLeft);
    }

    /// Returns up to `n` of `key` to the hand's origin slot of `main` when it is empty or holds the same key
    /// (I §3.2: the reserved slot always takes its own stack back); returns how many are left.
    pub(crate) fn put_back(&mut self, main: InvRef, origin: Option<u32>, key: ItemKey, n: i64) -> i64 {
        let Some(o) = origin else {
            return n;
        };
        let stack = stack_size(&self.protos, key);
        let s = &mut self.heap.block_mut(main)[o as usize];
        if s.count != 0 && s.key != key {
            return n;
        }
        let k = n.min(stack - i64::from(s.count));
        s.key = key;
        s.count += k as i32;
        n - k
    }
}
