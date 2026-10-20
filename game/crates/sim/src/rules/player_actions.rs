//! The M0 player actions (§15.3, §5.1–§5.2; I §3.2–§3.9; rules 16–25). Each checks everything before it
//! changes anything, so a refusal changes nothing (§15.3).

use super::inventory::{self, EMPTY_HAND, Inv, NONE16, clear, hand_origin, stack_size};
use super::{Ctx, Refusal, RuleResult, RuleScratch, fail, fail_at, fine_pos, in_reach, tile_box};
use crate::r#gen::{CraftEntry, CreationEntry, MiningMode, MiningState};
use crate::spatial::Box2;
use crate::world::{NewEntity, World};
use schema::events::{EntityBuiltEvent, EntityBuiltFlags, EventPayload, FlyingTextEvent};
use schema::{
    Action, BuildAction, BuildMode, CraftFlags, Direction, EntityFlags, EntityRef, FailReason, FinePos,
    FlyingText, GameSetting, InvSlot, InventoryType, ItemKey, MiningTarget, PlayerIndex, PlayerSetting,
    RecipeId, ResourceKind, Seq, Serial, StackKind, SurfaceIndex, TilePos2,
};

/// A crafting queue holds at most 256 entries, and an entry at most 65,535 crafts (state.yaml `CraftEntry`).
const QUEUE_MAX: usize = 256;
/// The creation ring keeps the last 256 creating actions (§4.3).
const CREATION_RING: usize = 256;

impl World {
    pub(crate) fn apply_player_action(
        &mut self,
        ctx: &mut Ctx<'_>,
        pi: PlayerIndex,
        seq: Seq,
        act: &Action<'_>,
    ) -> RuleResult {
        match act {
            Action::StartWalking(a) => {
                let p = self.player_mut(pi);
                p.walking = true;
                p.walking_dir = a.dir;
                Ok(())
            }
            Action::StopWalking(_) => {
                self.player_mut(pi).walking = false;
                Ok(())
            }
            Action::BeginMining(a) => self.begin_mining(pi, &a.target),
            Action::BeginMiningTerrain(a) => self.begin_mining_terrain(pi, a.kind, a.pos),
            Action::StopMining(_) => {
                self.player_mut(pi).mining = MiningState::default();
                Ok(())
            }
            Action::Build(a) => self.build(ctx, pi, seq, a),
            Action::ClearCursor(_) => {
                self.clear_cursor(ctx, pi, seq);
                Ok(())
            }
            Action::CursorTransfer(a) => self.cursor_transfer(pi, &a.slot, false, ctx.scratch),
            Action::CursorSplit(a) => self.cursor_transfer(pi, &a.slot, true, ctx.scratch),
            Action::StackTransfer(a) => self.stack_transfer(ctx, pi, seq, &a.from, &a.to, false),
            Action::StackSplit(a) => self.stack_transfer(ctx, pi, seq, &a.from, &a.to, true),
            Action::InventoryTransfer(a) => self.inventory_transfer(ctx, pi, seq, &a.from, &a.to, false),
            Action::InventorySplit(a) => self.inventory_transfer(ctx, pi, seq, &a.from, &a.to, true),
            Action::FastEntityTransfer(a) => self.fast_transfer(ctx, pi, seq, &a.target, false),
            Action::FastEntitySplit(a) => self.fast_transfer(ctx, pi, seq, &a.target, true),
            Action::SetInventoryBar(a) => self.set_inventory_bar(pi, &a.target, a.inv, a.bar),
            Action::Craft(a) => self.craft(pi, a.recipe, a.count, ctx.scratch),
            Action::CancelCraft(a) => self.cancel_craft(pi, a.index, a.count, ctx.scratch),
            Action::SetPlayerSetting(a) => {
                if a.value > 1 {
                    return Err(fail(FailReason::InvalidSetting));
                }
                let on = a.value == 1;
                match a.setting {
                    PlayerSetting::AutoSortInventory => {
                        self.player_mut(pi).auto_sort = on;
                        self.sort_main(pi, ctx.scratch);
                    }
                    PlayerSetting::PickGhostCursor => self.player_mut(pi).pick_ghost_cursor = on,
                }
                Ok(())
            }
            Action::SetGameSetting(a) => {
                if a.value > 1 {
                    return Err(fail(FailReason::InvalidSetting));
                }
                match a.setting {
                    GameSetting::TrimmedCollision => self.globals.game.trimmed_collision = a.value == 1,
                }
                Ok(())
            }
            // Outside M0's capability manifest (refused as `unsupported` before this), or system actions.
            Action::ChangePickingState(_)
            | Action::RotateEntity(_)
            | Action::FlipEntity(_)
            | Action::StopDragBuild(_)
            | Action::RemoveCables(_)
            | Action::WireDragging(_)
            | Action::Pipette(_)
            | Action::SetGhostCursor(_)
            | Action::QuickBarPickSlot(_)
            | Action::QuickBarSetSlot(_)
            | Action::ChangeActiveQuickBar(_)
            | Action::DropItem(_)
            | Action::SetFilter(_)
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
            | Action::Distribute(_)
            | Action::PlaceBlueprint(_)
            | Action::Rename(_)
            | Action::SetHallMode(_)
            | Action::LaunchEmpty(_)
            | Action::SetResearchScheduling(_)
            | Action::PlayerJoined(_)
            | Action::PlayerLeft(_)
            | Action::ReleaseInputs(_)
            | Action::SnapshotMarker(_)
            | Action::DebugDump(_) => {
                unreachable!("{} is outside M0's player actions", act.action_type().name())
            }
        }
    }

    // ------------------------------------------------------------------------------------------- mining (§5.1)

    /// `begin_mining` (I §3.7; rule 23): an entity with a mining time, in reach. Beginning on the target
    /// already being mined keeps its progress.
    fn begin_mining(&mut self, pi: PlayerIndex, target: &EntityRef) -> RuleResult {
        let row = self.resolve(pi, target).ok_or(fail(FailReason::TargetGone))?;
        let proto = usize::from(self.entities.proto[row as usize].0);
        let mining_time = self.protos.entity.mining_time[proto];
        // A NaN or non-positive mining time is not minable (`!(t > 0)` in the model).
        if mining_time.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
            return Err(fail_at(FailReason::NotMinable, self.entity_pos(row)));
        }
        if !in_reach(self.player(pi), &self.collision_box(row), self.reach()) {
            return Err(fail_at(FailReason::OutOfReach, self.entity_pos(row)));
        }
        let serial = self.entities.serial[row as usize];
        let p = self.player_mut(pi);
        let same = p.mining.mode == MiningMode::Entity && p.mining.serial == serial;
        let progress = if same { p.mining.progress } else { 0.0 };
        p.mining = MiningState { mode: MiningMode::Entity, serial, pos: FinePos { x: 0, y: 0 }, progress };
        Ok(())
    }

    /// `begin_mining_terrain` (I §3.7): a solid resource tile within the resource reach; a tile (only placed
    /// tiles are minable, and M0 places none); world objects and ground items (none in M0).
    ///
    /// **Reach first** (C2b-r1 finding 7): a target out of reach is refused before any terrain is read, so a
    /// refused action never makes the sim generate a distant pristine chunk. (The golden model reads the
    /// resource first; every golden case has the same outcome either way.)
    fn begin_mining_terrain(&mut self, pi: PlayerIndex, kind: MiningTarget, pos: FinePos) -> RuleResult {
        let (tx, ty) = (pos.x.div_euclid(256), pos.y.div_euclid(256));
        match kind {
            MiningTarget::ResourceTile => {
                let reach = self.protos.entity.resource_reach_distance[self.character_proto()];
                if !in_reach(self.player(pi), &tile_box(tx, ty), reach) {
                    return Err(fail_at(FailReason::OutOfReach, pos));
                }
                let surface = self.player(pi).surface;
                let Some(res) = self.resource_at(surface, tx, ty) else {
                    return Err(fail_at(FailReason::NothingToMine, pos));
                };
                if self.protos.resource.kind[usize::from(res.resource.0)] != ResourceKind::Solid {
                    return Err(fail_at(FailReason::NotMinable, pos));
                }
                // Beginning on the tile already being mined keeps its progress (rule 23).
                let p = self.player(pi);
                let same = p.mining.mode == MiningMode::ResourceTile
                    && (p.mining.pos.x.div_euclid(256), p.mining.pos.y.div_euclid(256)) == (tx, ty);
                let progress = if same { p.mining.progress } else { 0.0 };
                self.player_mut(pi).mining =
                    MiningState { mode: MiningMode::ResourceTile, serial: Serial::NONE, pos, progress };
                Ok(())
            }
            MiningTarget::Tile => {
                // Placed tiles are mined within the entity reach (I §3.1); M0 places none, so a tile there is
                // never minable, and whether one is there needs no tile read: its chunk is generated.
                if !in_reach(self.player(pi), &tile_box(tx, ty), self.reach()) {
                    return Err(fail_at(FailReason::OutOfReach, pos));
                }
                let surface = self.player(pi).surface;
                if !self.tile_exists(surface, tx, ty) {
                    return Err(fail_at(FailReason::NothingToMine, pos));
                }
                Err(fail_at(FailReason::NotMinable, pos))
            }
            // M0's map has neither world objects nor ground items.
            MiningTarget::WorldObject | MiningTarget::GroundItem => {
                Err(fail_at(FailReason::NothingToMine, pos))
            }
        }
    }

    // ------------------------------------------------------------------------------------------- building (§5.2)

    /// `build` (I §3.3; rule 20). Checks: the mode, the hand, the centre's parity, reach to the collision box,
    /// the map, the tiles, buildings in the way (the lowest serial), characters in the way (the lowest serial).
    fn build(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex, seq: Seq, a: &BuildAction) -> RuleResult {
        let at = FinePos { x: a.pos.x2.wrapping_mul(128), y: a.pos.y2.wrapping_mul(128) };
        // Ghosts and super-forced building are not in M0 (§12).
        if a.mode != BuildMode::Normal {
            return Err(fail_at(FailReason::Unsupported, at));
        }
        let hand = self.player(pi).hand;
        let item = usize::from(a.item.0 >> 3);
        let places = self.protos.item.places_entity.get(item).copied();
        let proto = match places {
            Some(e) if !hand.ghost && hand.count > 0 && hand.key == a.item && !e.is_none() => e,
            _ => return Err(fail_at(FailReason::NoItemInHand, at)),
        };
        let pr = usize::from(proto.0);
        if pr >= self.protos.entity.len() {
            return Err(fail_at(FailReason::NoItemInHand, at));
        }
        let e = &self.protos.entity;
        let (w, h) = (i64::from(e.size_w[pr]), i64::from(e.size_h[pr]));
        if (a.pos.x2 & 1 == 1) != (w % 2 == 1) || (a.pos.y2 & 1 == 1) != (h % 2 == 1) {
            return Err(fail_at(FailReason::Malformed, at));
        }
        let (cx, cy) = (f64::from(a.pos.x2) / 2.0, f64::from(a.pos.y2) / 2.0);
        let b = Box2 {
            x0: cx + e.collision_x0[pr],
            y0: cy + e.collision_y0[pr],
            x1: cx + e.collision_x1[pr],
            y1: cy + e.collision_y1[pr],
        };
        let reach = e.build_distance[self.character_proto()];
        if !in_reach(self.player(pi), &b, reach) {
            return Err(fail_at(FailReason::OutOfReach, at));
        }
        // In reach, so the footprint lies within a few chunks of the character: i32 tiles.
        let tx0 = ((i64::from(a.pos.x2) - w) / 2) as i32;
        let ty0 = ((i64::from(a.pos.y2) - h) / 2) as i32;
        let (tx1, ty1) = (tx0 + w as i32, ty0 + h as i32);
        for tx in tx0..tx1 {
            for ty in ty0..ty1 {
                if !self.in_map(tx, ty) {
                    return Err(fail_at(FailReason::OutOfMap, at));
                }
            }
        }
        let surface = SurfaceIndex(0);
        for tx in tx0..tx1 {
            for ty in ty0..ty1 {
                if !self.buildable(surface, tx, ty) {
                    return Err(fail_at(FailReason::CannotBuildOnTile, at));
                }
            }
        }
        if let Some(s) = self.lowest_serial_overlapping(surface, &b) {
            return Err(Refusal { reason: FailReason::EntityInTheWay, pos: Some(at), serial: s });
        }
        // A building never covers a character (Factorio's buildings collide with the player layer).
        let mut blocker: Option<Serial> = None;
        for q in self.players.iter() {
            if !q.character.is_none()
                && self.character_box(q.x, q.y).overlaps(&b)
                && blocker.is_none_or(|s| q.character < s)
            {
                blocker = Some(q.character);
            }
        }
        if let Some(s) = blocker {
            return Err(Refusal { reason: FailReason::EntityInTheWay, pos: Some(at), serial: s });
        }

        // The world must have room for the entity (C2b-r1 finding 5): checked before anything changes, so an
        // exhausted serial counter or a full pool is a refusal (an engine limit: `unsupported`), not a trap.
        if self.creation_room(proto).is_err() {
            return Err(fail_at(FailReason::Unsupported, at));
        }
        let e = &self.protos.entity;
        let dir = if e.rotatable[pr] { a.dir } else { Direction::North };
        let flip = u8::from(e.flippable[pr] && a.flip);
        self.make_modified(surface, tx0, ty0, tx1, ty1);
        let new = NewEntity {
            proto,
            surface: 0,
            x2: a.pos.x2,
            y2: a.pos.y2,
            dir,
            flip,
            quality: (a.item.0 & 7) as u8,
            built_by: 16 + pi.0 as u8,
            flags: EntityFlags::EMPTY,
            built_tick: ctx.tick,
        };
        let (serial, _) = self.create_entity(&new).unwrap_or_else(|e| panic!("a checked build failed: {e}"));
        let p = self.player_mut(pi);
        p.creation_ring.push(CreationEntry { seq, first_serial: serial, count: 1 });
        if p.creation_ring.len() > CREATION_RING {
            p.creation_ring.remove(0);
        }
        // The hand loses the item; auto-replenish from the main inventory (I §3.2), else a ghost cursor or empty.
        p.hand.count -= 1;
        if p.hand.count == 0 {
            self.refill_hand(pi, a.item, true);
            self.sort_main(pi, ctx.scratch);
        }
        ctx.emit(
            seq,
            pi,
            EventPayload::EntityBuilt(EntityBuiltEvent {
                serial,
                proto,
                dir,
                flags: EntityBuiltFlags::EMPTY,
                pos: TilePos2 { x2: a.pos.x2, y2: a.pos.y2 },
            }),
        );
        Ok(())
    }

    // ------------------------------------------------------------------------------------------- the hand and transfers (I §3.2, §3.8)

    /// Q (I §3.2; rule 19): a ghost cursor clears; a stack goes back to its origin slot first, the rest into the
    /// main inventory, and what does not fit stays in the hand with "Cannot put away …". Never a refusal.
    fn clear_cursor(&mut self, ctx: &mut Ctx<'_>, pi: PlayerIndex, seq: Seq) {
        let hand = self.player(pi).hand;
        if hand.ghost {
            self.player_mut(pi).hand = EMPTY_HAND;
            return;
        }
        if hand.count == 0 {
            return;
        }
        let key = hand.key;
        let main = self.main_inv(pi);
        let mut left = self.put_back(main.r, hand_origin(&hand), key, i64::from(hand.count));
        let free = Inv { origin: None, ..main };
        left -= inventory::insert(&mut self.heap, &self.protos, &free, key, left);
        self.player_mut(pi).hand = if left > 0 {
            crate::r#gen::Hand { key, ghost: false, origin: NONE16, count: left as i32 }
        } else {
            EMPTY_HAND
        };
        self.sort_main(pi, ctx.scratch);
        if left > 0 {
            let pos = fine_pos(self.player(pi).x, self.player(pi).y);
            ctx.emit(
                seq,
                pi,
                EventPayload::FlyingText(FlyingTextEvent {
                    text: FlyingText::CannotPutAway,
                    item: key,
                    count: left as i32,
                    total: -1,
                    pos,
                }),
            );
        }
    }

    /// LMB (`split` false) and RMB (`split` true) on a slot (I §3.8's table; rules 16, 19).
    fn cursor_transfer(
        &mut self,
        pi: PlayerIndex,
        at: &InvSlot,
        split: bool,
        scratch: &mut RuleScratch,
    ) -> RuleResult {
        let (inv, _, index) = self.resolve_slot(pi, at)?;
        let is_main = inv.r == self.player(pi).main;
        let hand = self.player(pi).hand;
        let s = self.heap.block(inv.r)[index as usize];
        if hand.count == 0 {
            // An empty hand (a ghost cursor counts as empty and is replaced): all, or half rounded up.
            if s.count == 0 {
                return Ok(());
            }
            let take = if split { (s.count + 1) / 2 } else { s.count };
            let slot = &mut self.heap.block_mut(inv.r)[index as usize];
            slot.count -= take;
            if slot.count == 0 {
                clear(slot);
            }
            self.player_mut(pi).hand = crate::r#gen::Hand {
                key: s.key,
                ghost: false,
                origin: if is_main { index as u16 } else { NONE16 },
                count: take,
            };
            if is_main {
                self.sort_main(pi, scratch);
            }
            return Ok(());
        }
        // The hand holds a stack of X: a click puts items into any slot, past the limit bar too (rule 16).
        let x = hand.key;
        let stack = stack_size(&self.protos, x) as i32;
        let mut h = hand;
        let slot = &mut self.heap.block_mut(inv.r)[index as usize];
        if split {
            // RMB: one X into an empty slot or a slot of X with room; anything else does nothing.
            if slot.count == 0 || (slot.key == x && slot.count < stack) {
                slot.key = x;
                slot.count += 1;
                h.count -= 1;
            }
        } else if slot.count == 0 {
            *slot = schema::Slot { key: x, count: h.count };
            h.count = 0;
        } else if slot.key == x {
            let k = h.count.min(stack - slot.count);
            slot.count += k;
            h.count -= k;
        } else {
            // A different item: swap. The hand's new stack remembers this slot if it is in the main inventory.
            let y = *slot;
            *slot = schema::Slot { key: x, count: h.count };
            h = crate::r#gen::Hand {
                key: y.key,
                ghost: false,
                origin: if is_main { index as u16 } else { NONE16 },
                count: y.count,
            };
        }
        self.player_mut(pi).hand = if h.count == 0 { EMPTY_HAND } else { h };
        Ok(())
    }

    /// Shift+LMB / Shift+RMB: a stack, or half of it rounded up, to the other inventory; what fits moves
    /// (rule 19).
    fn stack_transfer(
        &mut self,
        ctx: &mut Ctx<'_>,
        pi: PlayerIndex,
        seq: Seq,
        from: &InvSlot,
        to: &EntityRef,
        split: bool,
    ) -> RuleResult {
        let (src, _, index) = self.resolve_slot(pi, from)?;
        let (dst, dst_owner) = self.resolve_other(pi, to)?;
        if src.r == dst.r {
            return Err(fail(FailReason::InvalidIndex));
        }
        let s = self.heap.block(src.r)[index as usize];
        if s.count == 0 {
            return Err(fail(FailReason::NothingToTransfer));
        }
        let n = i64::from(if split { (s.count + 1) / 2 } else { s.count });
        let moved = inventory::insert(&mut self.heap, &self.protos, &dst, s.key, n);
        let slot = &mut self.heap.block_mut(src.r)[index as usize];
        slot.count -= moved as i32;
        if slot.count == 0 {
            clear(slot);
        }
        self.sort_main(pi, ctx.scratch);
        if moved < n && dst_owner.is_none() {
            self.not_fitting(ctx, pi, seq, s.key, n - moved);
        }
        Ok(())
    }

    /// Refills an emptied hand from the main inventory (I §3.2 auto-replenish, I §3.8 fast transfer): the
    /// stack of the lowest main slot holding `key`, which becomes the hand's origin slot; else, when `ghost` and
    /// the player's *Pick ghost item if no items are available* is on, a ghost cursor of `key`; else empty. The
    /// caller sorts the inventory.
    pub(crate) fn refill_hand(&mut self, pi: PlayerIndex, key: ItemKey, ghost: bool) {
        let main = self.main_inv(pi);
        let block = self.heap.block_mut(main.r);
        let from = (0..main.size).find(|&i| block[i as usize].key == key && block[i as usize].count > 0);
        let hand = if let Some(i) = from {
            let s = &mut block[i as usize];
            let h = crate::r#gen::Hand { key: s.key, ghost: false, origin: i as u16, count: s.count };
            clear(s);
            h
        } else if ghost && self.player(pi).pick_ghost_cursor {
            crate::r#gen::Hand { key, ghost: true, origin: NONE16, count: 0 }
        } else {
            EMPTY_HAND
        };
        self.player_mut(pi).hand = hand;
    }

    /// Factorio's "Cannot insert Iron plate. Inventory is full." (rule 19): what did not fit the player's
    /// inventory, as a flying text, never a refusal.
    pub(crate) fn not_fitting(&self, ctx: &mut Ctx<'_>, pi: PlayerIndex, seq: Seq, key: ItemKey, n: i64) {
        let p = self.player(pi);
        ctx.emit(
            seq,
            pi,
            EventPayload::FlyingText(FlyingTextEvent {
                text: FlyingText::InventoryFull,
                item: key,
                count: n as i32,
                total: -1,
                pos: fine_pos(p.x, p.y),
            }),
        );
    }

    /// Ctrl+LMB / Ctrl+RMB: every stack of the slot's item, or of everything on an empty slot; or half of each,
    /// rounded up. What fits moves; a message only for the player's inventory, naming the first item short.
    fn inventory_transfer(
        &mut self,
        ctx: &mut Ctx<'_>,
        pi: PlayerIndex,
        seq: Seq,
        from: &InvSlot,
        to: &EntityRef,
        split: bool,
    ) -> RuleResult {
        let (src, _, index) = self.resolve_slot(pi, from)?;
        let (dst, dst_owner) = self.resolve_other(pi, to)?;
        if src.r == dst.r {
            return Err(fail(FailReason::InvalidIndex));
        }
        let s = self.heap.block(src.r)[index as usize];
        let only = (s.count > 0).then_some(s.key);
        let mut next = only.or_else(|| inventory::next_key(&self.heap, &src, None));
        if next.is_none() {
            return Err(fail(FailReason::NothingToTransfer));
        }
        let mut short: Option<(ItemKey, i64)> = None;
        while let Some(k) = next {
            let total = inventory::count(&self.heap, &src, k);
            let want = if split { (total + 1) / 2 } else { total };
            let n = inventory::insert(&mut self.heap, &self.protos, &dst, k, want);
            inventory::remove(&mut self.heap, &src, k, n);
            if n < want && short.is_none() {
                short = Some((k, want - n));
            }
            // The keys above k are those the inventory held before: this loop only takes items out of it.
            next = if only.is_some() { None } else { inventory::next_key(&self.heap, &src, Some(k)) };
        }
        self.sort_main(pi, ctx.scratch);
        if let Some((k, n)) = short
            && dst_owner.is_none()
        {
            self.not_fitting(ctx, pi, seq, k, n);
        }
        Ok(())
    }

    /// Ctrl+click on an entity in the world (I §3.8 "Fast transfer"): the hand into the chest below its bar
    /// (nothing at all when nothing fits), or every item of the chest into the main inventory, with a flying
    /// text per item at the entity.
    fn fast_transfer(
        &mut self,
        ctx: &mut Ctx<'_>,
        pi: PlayerIndex,
        seq: Seq,
        target: &EntityRef,
        split: bool,
    ) -> RuleResult {
        let row = self.resolve_in_reach(pi, target)?;
        let chest = self.chest_inv(row);
        let at = self.entity_pos(row);
        let hand = self.player(pi).hand;
        if hand.count > 0 {
            let want = i64::from(if split { (hand.count + 1) / 2 } else { hand.count });
            let moved = inventory::insert(&mut self.heap, &self.protos, &chest, hand.key, want);
            if moved == 0 {
                return Ok(());
            }
            let p = self.player_mut(pi);
            p.hand.count -= moved as i32;
            // The text names what left and what the inventory holds; then an emptied cursor refills from the
            // inventory (I §3.8, corrected 2026-10-20: "the cursor refills from the inventory"; C2b-r1 finding 6),
            // as building's auto-replenish does, without a ghost cursor.
            let emptied = p.hand.count == 0;
            self.item_delta(ctx, pi, seq, hand.key, -moved, at);
            if emptied {
                self.refill_hand(pi, hand.key, false);
            }
            return Ok(());
        }
        let mut next = inventory::next_key(&self.heap, &chest, None);
        if next.is_none() {
            return Err(fail_at(FailReason::NothingToTransfer, at));
        }
        let main = self.main_inv(pi);
        ctx.scratch.moved.clear();
        let mut short: Option<(ItemKey, i64)> = None;
        while let Some(k) = next {
            let total = inventory::count(&self.heap, &chest, k);
            let want = if split { (total + 1) / 2 } else { total };
            let n = inventory::insert(&mut self.heap, &self.protos, &main, k, want);
            inventory::remove(&mut self.heap, &chest, k, n);
            if n > 0 {
                ctx.scratch.moved.push((k, n));
            }
            if n < want && short.is_none() {
                short = Some((k, want - n));
            }
            next = inventory::next_key(&self.heap, &chest, Some(k));
        }
        self.sort_main(pi, ctx.scratch);
        for i in 0..ctx.scratch.moved.len() {
            let (k, n) = ctx.scratch.moved[i];
            self.item_delta(ctx, pi, seq, k, n, at);
        }
        if let Some((k, n)) = short {
            self.not_fitting(ctx, pi, seq, k, n);
        }
        Ok(())
    }

    /// Flying text `item_delta` (rule 19): `count` moved into (+) or out of (−) the main inventory, `total` its
    /// count there now.
    pub(crate) fn item_delta(
        &self,
        ctx: &mut Ctx<'_>,
        pi: PlayerIndex,
        seq: Seq,
        key: ItemKey,
        count: i64,
        pos: FinePos,
    ) {
        let total = inventory::count(&self.heap, &self.main_inv(pi), key);
        ctx.emit(
            seq,
            pi,
            EventPayload::FlyingText(FlyingTextEvent {
                text: FlyingText::ItemDelta,
                item: key,
                count: count as i32,
                total: total as i32,
                pos,
            }),
        );
    }

    /// The limit bar of a chest (rule 16): slots from `bar` on take nothing by bulk means; `bar` = the size
    /// removes the limit (no entry: the canonical form).
    fn set_inventory_bar(
        &mut self,
        pi: PlayerIndex,
        target: &EntityRef,
        inv: InventoryType,
        bar: u16,
    ) -> RuleResult {
        let row = self.resolve_in_reach(pi, target)?;
        if inv != InventoryType::Chest {
            return Err(fail_at(FailReason::InvalidIndex, self.entity_pos(row)));
        }
        let chest = self.chest_inv(row);
        if u32::from(bar) > chest.size {
            return Err(fail_at(FailReason::InvalidIndex, self.entity_pos(row)));
        }
        self.heap.set_bar(chest.r, (u32::from(bar) < chest.size).then_some(bar));
        Ok(())
    }

    // ------------------------------------------------------------------------------------------- hand crafting (§5.1, I §3.9)

    /// The item ingredients of a hand-craftable recipe as `(key, amount)`, or the refusal (rule 25).
    fn handcraft_ingredients(&self, recipe: RecipeId) -> Result<usize, Refusal> {
        let r = usize::from(recipe.0);
        let rp = &self.protos.recipe;
        if r >= rp.len() {
            return Err(fail(FailReason::InvalidIndex));
        }
        if !rp.enabled_at_start[r] {
            return Err(fail(FailReason::RecipeLocked)); // M0 researches nothing
        }
        let integral = |a: f64| a >= 1.0 && a.floor() == a && a <= f64::from(u16::MAX);
        if !rp.handcraft[r]
            || rp.ingredients.get(r).iter().any(|i| i.kind != StackKind::Item || !integral(i.amount))
        {
            return Err(fail(FailReason::CannotHandcraft));
        }
        Ok(r)
    }

    /// `craft` (rule 25): ingredients come from the main inventory (not the hand) and leave it at enqueue time;
    /// a request above what can be crafted queues what can; the same recipe merges into the last entry. M0's
    /// one recipe has no hand-craftable intermediate, so chain crafting (I §3.9 steps 1–3) is direct crafting.
    fn craft(
        &mut self,
        pi: PlayerIndex,
        recipe: RecipeId,
        want: u32,
        scratch: &mut RuleScratch,
    ) -> RuleResult {
        let r = self.handcraft_ingredients(recipe)?;
        let main = self.main_inv(pi);
        let mut can = i64::MAX;
        for ing in self.protos.recipe.ingredients.get(r) {
            let have = inventory::count(&self.heap, &main, inventory::key_of(ing.id));
            let k = have / ing.amount as i64;
            if k < can {
                can = k;
            }
        }
        let want = i64::from(want);
        let mut n = if want == 0 || want > can { can } else { want };
        if n > 0xFFFF {
            n = 0xFFFF; // one queue entry's count is a u16
        }
        if n == 0 {
            return Err(fail(FailReason::NotEnoughIngredients));
        }
        let q = &self.player(pi).crafting_queue;
        let merge = q.last().is_some_and(|l| {
            l.recipe == recipe && l.flags == CraftFlags::EMPTY && i64::from(l.count) + n <= 0xFFFF
        });
        if !merge && q.len() >= QUEUE_MAX {
            return Err(fail(FailReason::InvalidIndex));
        }
        for i in 0..self.protos.recipe.ingredients.get(r).len() {
            let ing = self.protos.recipe.ingredients.get(r)[i];
            inventory::remove(&mut self.heap, &main, inventory::key_of(ing.id), n * ing.amount as i64);
        }
        self.sort_main(pi, scratch);
        let q = &mut self.player_mut(pi).crafting_queue;
        match q.last_mut() {
            Some(l) if merge => l.count += n as u16,
            _ => q.push(CraftEntry {
                recipe,
                count: n as u16,
                flags: CraftFlags::EMPTY,
                parent: NONE16,
                progress: 0.0,
            }),
        }
        Ok(())
    }

    /// Whether every one of `items` fits the main inventory at once (tried on the block and undone).
    pub(crate) fn fits_all(
        &mut self,
        main: &Inv,
        items: &[(ItemKey, i64)],
        scratch: &mut RuleScratch,
    ) -> bool {
        scratch.saved.clear();
        scratch.saved.extend_from_slice(&self.heap.block(main.r)[..main.size as usize]);
        let mut ok = true;
        for &(k, n) in items {
            if inventory::insert(&mut self.heap, &self.protos, main, k, n) < n {
                ok = false;
            }
        }
        self.heap.block_mut(main.r)[..main.size as usize].copy_from_slice(&scratch.saved);
        ok
    }

    /// `cancel_craft`: refunds the ingredients of `count` units of a queue entry (0 or more than queued: all).
    /// M0 refuses a cancel whose refund does not fit (`inventory_full`; rule 25: the spill is M1's).
    fn cancel_craft(
        &mut self,
        pi: PlayerIndex,
        index: u16,
        want: u16,
        scratch: &mut RuleScratch,
    ) -> RuleResult {
        let Some(e) = self.player(pi).crafting_queue.get(usize::from(index)).copied() else {
            return Err(fail(FailReason::InvalidIndex));
        };
        let r = usize::from(e.recipe.0);
        let m = if want == 0 || want > e.count { e.count } else { want };
        let mut refund = std::mem::take(&mut scratch.moved);
        refund.clear();
        for ing in self.protos.recipe.ingredients.get(r) {
            refund.push((inventory::key_of(ing.id), i64::from(m) * ing.amount as i64));
        }
        let main = self.main_inv(pi);
        let fits = self.fits_all(&main, &refund, scratch);
        if fits {
            for &(k, n) in &refund {
                inventory::insert(&mut self.heap, &self.protos, &main, k, n);
            }
        }
        scratch.moved = refund;
        if !fits {
            return Err(fail(FailReason::InventoryFull));
        }
        self.sort_main(pi, scratch);
        let q = &mut self.player_mut(pi).crafting_queue;
        let entry = &mut q[usize::from(index)];
        entry.count -= m;
        if entry.count == 0 {
            q.remove(usize::from(index));
        }
        Ok(())
    }
}
