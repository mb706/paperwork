//! `World::tick` (10 §4.6): exactly one tick, in the fixed phase order, behind the closure preflight (§15.3).
//!
//! The preflight walks the whole closure with temporary watermarks and changes nothing when it fails
//! (`ERR_FRAMING`, `ERR_BLOB_MISSING`; B1-r1 9). Then the phases:
//!
//! | # | Phase | M0 |
//! |---|---|---|
//! | 1 | Input: the closure's actions in order, each seq consumed first; then the characters | seqs (C2a); the action pipeline and the characters arrive in C2b |
//! | 2 | Timers: wake timers, then the work timers due, in `(due, serial, event, owner)` order | the scheduler (C2a); M0 has no work timers |
//! | 3 | Chunk commits (§5.18) | C2b |
//! | 4–14 | Energy … units | none in M0 |
//! | 15 | Statistics (§5.20) | C2b |
//! | 16 | Digest: d_t, slice_t (r_t is the module's, §4.8) | C2a |
//!
//! Per-phase digests (§4.8 item 5): when asked for (simcheck tools), the full state hash after each phase.

use crate::digest::{Counters, Slicer, write_preimage};
use crate::r#gen::{Hand, MiningState, Player};
use crate::hash::xxh64;
use crate::presentation::EventSink;
use crate::save::state_hash;
use crate::world::World;
use crate::{SimError, SimResult};
use schema::{
    ClosureIter, Direction, InvRef, ItemKey, PLAYERS, PlayerIndex, PreflightError, Seq, SimStatus,
    SurfaceIndex, Tick, preflight,
};

/// The phases of §4.6, for per-phase digests.
pub const PHASES: usize = 16;

/// Buffers a tick reuses, so the steady-state tick allocates nothing (§2.5).
#[derive(Clone, Debug, Default)]
pub struct TickScratch {
    pub counters: Counters,
    pub preimage: Vec<u8>,
    pub slicer: Slicer,
}

/// What a tick needs besides the World and the closure.
pub struct TickIo<'a> {
    /// Whether a blob was supplied for this tick (`sim_blob_put`, §15.3).
    pub has_blob: &'a dyn Fn(&[u8; 32]) -> bool,
    /// The event queue the tick writes (§3.6: borrowed from the presentation state).
    pub events: &'a mut EventSink,
    pub scratch: &'a mut TickScratch,
    /// When set, the full state hash after each phase (§4.8 item 5).
    pub phase_digests: Option<&'a mut [u64; PHASES]>,
}

/// A tick's digests (§4.8): d_t and slice_t; the module rolls r_t.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TickDigests {
    pub d: u64,
    pub slice: u64,
}

/// A player record without a character (golden rule 12): what the World keeps for a player index that sent an
/// action before it joined, so that its seqs stay consumed across ticks, saves and its later join. Offline,
/// every other field at its default (no inventory, an empty hand).
pub fn watermark_player(index: PlayerIndex) -> Player {
    Player {
        index,
        online: false,
        character: schema::Serial::NONE,
        input_gen: 0,
        last_seq: Seq(0),
        creation_ring: Vec::new(),
        inventory_version: 0,
        main: InvRef::NONE,
        hand: Hand { key: ItemKey::NONE, ghost: false, origin: 0xFFFF, count: 0 },
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

impl World {
    /// Runs exactly the closure of tick `tick + 1` (§15.8 `sim_tick`).
    pub fn tick(&mut self, closure: &[u8], io: &mut TickIo<'_>) -> SimResult<TickDigests> {
        let t = self
            .current_tick()
            .checked_add(1)
            .ok_or_else(|| SimError::new(SimStatus::ErrOrder, "the tick counter is exhausted"))?;
        preflight(closure, t, &self.players.last_seqs(), self.globals.last_system_seq.0, io.has_blob)
            .map_err(|e| match e {
                PreflightError::Framing { at, reason } => {
                    SimError::new(SimStatus::ErrFraming, format!("closure of tick {t}, byte {at}: {reason}"))
                }
                PreflightError::BlobMissing { at } => SimError::new(
                    SimStatus::ErrBlobMissing,
                    format!("closure of tick {t}, byte {at}: a blob was not supplied"),
                ),
            })?;
        self.globals.tick = Tick(t);
        self.sched.begin_tick(t);
        io.scratch.counters.clear();
        let mut phase = PhaseDigests::new(io.phase_digests.as_deref_mut());

        // Phase 1 (§4.6): the closure's batches in order, each batch's actions in seq order (§15.3).
        for a in ClosureIter::new(closure) {
            self.consume_seq(a.system, a.player, Seq(a.seq));
            // C2b: decode (`malformed`), the capability manifest (`unsupported`), presence, input fencing (D22)
            // and the action's own rules, refusals as events.
        }
        // C2b: the online characters, ascending by player index: walking, mining, crafting (golden rule 10).
        phase.after(1, self);

        // Phase 2: wake timers (they only mark, wake rule 1), then the work timers due now, in their order.
        self.sched.fire_timers(t);
        while let Some(_k) = self.pop_due_timer(t) {
            // M0 declares no work timer (state.yaml TimerEvent: "the values arrive with their systems"); a load
            // refuses timers due before the next tick, so every timer popped here is due now.
        }
        phase.after(2, self);
        // Phase 3: chunk commits (C2b). Phases 4–14: no system in M0. Phase 15: statistics (C2b).
        for p in 3..=15 {
            phase.after(p, self);
        }

        // Phase 16 (§4.8): d_t over §4.8's sequence, then this tick's slice.
        io.scratch.preimage.clear();
        let closure_hash = xxh64(closure);
        write_preimage(self, closure_hash, &io.scratch.counters, &mut io.scratch.preimage).map_err(enc)?;
        let d = xxh64(&io.scratch.preimage);
        let slice = io.scratch.slicer.slice_hash(self, t % schema::SHARDS).map_err(enc)?;
        phase.after(16, self);
        Ok(TickDigests { d, slice })
    }

    /// §15.3 "Identity and seq": every action consumes its seq, refused or not. A player index without a record
    /// gets a watermark record (golden rule 12).
    fn consume_seq(&mut self, system: bool, player: PlayerIndex, seq: Seq) {
        if system {
            self.globals.last_system_seq = seq;
            return;
        }
        debug_assert!(usize::from(player.0) < PLAYERS, "the preflight bounds player indexes");
        if self.players.get(player).is_none() {
            self.players.insert(watermark_player(player));
        }
        if let Some(p) = self.players.get_mut(player) {
            p.last_seq = seq;
        }
    }
}

fn enc(e: schema::codec::EncodeError) -> SimError {
    SimError::new(SimStatus::ErrOrder, format!("the state cannot be encoded: {e}"))
}

/// Records the full state hash after each phase when asked to.
struct PhaseDigests<'a> {
    out: Option<&'a mut [u64; PHASES]>,
}

impl<'a> PhaseDigests<'a> {
    fn new(out: Option<&'a mut [u64; PHASES]>) -> Self {
        Self { out }
    }

    fn after(&mut self, phase: usize, w: &World) {
        // D6: no NaN in state; builds with simcheck look after every phase (§2.3).
        if cfg!(feature = "simcheck")
            && let Some((what, i)) = w.nan_scan()
        {
            panic!("D6: NaN in {what} {i} after phase {phase} of tick {}", w.current_tick());
        }
        if let Some(out) = self.out.as_deref_mut() {
            out[phase - 1] = state_hash(w).map_or(0, |h| h.full);
        }
    }
}
