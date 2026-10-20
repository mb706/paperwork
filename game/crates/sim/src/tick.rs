//! `World::tick` (10 §4.6): exactly one tick, in the fixed phase order, behind the closure preflight (§15.3).
//!
//! The preflight walks the whole closure with temporary watermarks and changes nothing when it fails
//! (`ERR_FRAMING`, `ERR_BLOB_MISSING`; B1-r1 9). Then the phases:
//!
//! | # | Phase | M0 |
//! |---|---|---|
//! | 1 | Input: the closure's actions in order through the action pipeline (rules.rs), then the characters (walking, mining, crafting), then this tick's worldgen requests | §15.3, §5.1, §5.18 |
//! | 2 | Timers: wake timers, then the work timers due, in `(due, serial, event, owner)` order | the scheduler; M0 has no work timers |
//! | 3 | Chunk commits (§5.18): the requests due now, a worker's answer or inline generation | regen.rs |
//! | 4–14 | Energy … units | none in M0 |
//! | 15 | Statistics (§5.20) | stats.rs |
//! | 16 | Digest: d_t, slice_t (r_t is the module's, §4.8) | digest.rs |
//!
//! Per-phase digests (§4.8 item 5): when asked for (simcheck tools), the full state hash after each phase.
//! Per-phase times (`PROFILE`, §10.6; `DEBUG.phase_us`): with the host's clock, the µs each phase took, the
//! preflight counted in phase 1; they go to presentation only (D13: no clock reaches the World).

use crate::digest::{Counters, Slicer, write_preimage};
use crate::hash::xxh64;
use crate::presentation::PresentationState;
use crate::regen::Answers;
use crate::rules::{Ctx, RuleScratch};
use crate::save::state_hash;
use crate::world::World;
use crate::{SimError, SimResult};
use schema::{ChunkRequest, ClosureIter, PreflightError, SimStatus, SurfaceIndex, Tick, preflight};

pub use crate::rules::watermark_player;

/// The phases of §4.6, for per-phase digests.
pub const PHASES: usize = 16;

/// Buffers a tick reuses, so the steady-state tick allocates nothing (§2.5).
#[derive(Clone, Debug, Default)]
pub struct TickScratch {
    pub counters: Counters,
    pub preimage: Vec<u8>,
    pub slicer: Slicer,
    pub rules: RuleScratch,
    /// This tick's pre-generation wishes, `(surface, cy, cx)`.
    pub wanted: Vec<(SurfaceIndex, i32, i32)>,
}

/// What a tick needs besides the World and the closure.
pub struct TickIo<'a> {
    /// Whether a blob was supplied for this tick (`sim_blob_put`, §15.3).
    pub has_blob: &'a dyn Fn(&[u8; 32]) -> bool,
    /// The presentation state the tick writes (§3.6): the event queue and the characters' motion.
    pub pres: &'a mut PresentationState,
    pub scratch: &'a mut TickScratch,
    /// Worker answers for pending requests (`sim_supply_chunk`); phase 3 takes the ones due.
    pub answers: &'a mut Answers,
    /// The requests this tick makes, for `sim_pending_chunks`.
    pub issued: &'a mut Vec<ChunkRequest>,
    /// When set, the full state hash after each phase (§4.8 item 5).
    pub phase_digests: Option<&'a mut [u64; PHASES]>,
    /// With `PROFILE`: the host's clock in ms, read around each phase (presentation's `phase_us`).
    pub clock: Option<fn() -> f64>,
    /// Verify that refusals change nothing (tests; a state hash per action).
    pub check_refusals: bool,
}

/// A tick's digests (§4.8): d_t and slice_t; the module rolls r_t.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TickDigests {
    pub d: u64,
    pub slice: u64,
}

impl World {
    /// Runs exactly the closure of tick `tick + 1` (§15.8 `sim_tick`).
    pub fn tick(&mut self, closure: &[u8], io: &mut TickIo<'_>) -> SimResult<TickDigests> {
        let mut phase = PhaseDigests::new(io.phase_digests.as_deref_mut(), io.clock);
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

        // Phase 1 (§4.6): the closure's batches in order, each batch's actions in seq order (§15.3); then every
        // online character (rule 10); then the worldgen requests of the chunks characters entered (§5.18).
        {
            let TickScratch { counters, rules, wanted, .. } = &mut *io.scratch;
            let mut ctx = Ctx {
                tick: Tick(t),
                events: &mut io.pres.events,
                counters,
                scratch: rules,
                moves: &mut io.pres.moves,
                wanted,
                check_refusals: io.check_refusals,
            };
            for a in ClosureIter::new(closure) {
                self.apply_action(&mut ctx, &a);
            }
            self.characters_tick(&mut ctx);
        }
        self.schedule_requests(t, &mut io.scratch.wanted, io.issued);
        phase.after(1, self);

        // Phase 2: wake timers (they only mark, wake rule 1), then the work timers due now, in their order.
        self.sched.fire_timers(t);
        while let Some(_k) = self.pop_due_timer(t) {
            // M0 declares no work timer (state.yaml TimerEvent: "the values arrive with their systems"); a load
            // refuses timers due before the next tick, so every timer popped here is due now.
        }
        phase.after(2, self);
        // Phase 3 (§5.18): the chunk commits due now.
        self.commit_chunks(t, io.answers);
        phase.after(3, self);
        // Phases 4–14: no system in M0.
        for p in 4..=14 {
            phase.after(p, self);
        }
        // Phase 15 (§5.20): statistics.
        self.flush_stats(t, &io.scratch.counters);
        phase.after(15, self);

        // Phase 16 (§4.8): d_t over §4.8's sequence, then this tick's slice.
        io.scratch.preimage.clear();
        let closure_hash = xxh64(closure);
        write_preimage(self, closure_hash, &io.scratch.counters, &mut io.scratch.preimage).map_err(enc)?;
        let d = xxh64(&io.scratch.preimage);
        let slice = io.scratch.slicer.slice_hash(self, t % schema::SHARDS).map_err(enc)?;
        phase.after(16, self);
        io.pres.phase_us = phase.times();
        Ok(TickDigests { d, slice })
    }
}

fn enc(e: schema::codec::EncodeError) -> SimError {
    SimError::new(SimStatus::ErrOrder, format!("the state cannot be encoded: {e}"))
}

/// Records the full state hash after each phase when asked to, and each phase's time with a clock.
struct PhaseDigests<'a> {
    out: Option<&'a mut [u64; PHASES]>,
    clock: Option<fn() -> f64>,
    last: f64,
    us: [f32; PHASES],
}

impl<'a> PhaseDigests<'a> {
    fn new(out: Option<&'a mut [u64; PHASES]>, clock: Option<fn() -> f64>) -> Self {
        Self { out, clock, last: clock.map_or(0.0, |c| c()), us: [0.0; PHASES] }
    }

    /// The phases' µs, with a clock.
    fn times(&self) -> Option<[f32; PHASES]> {
        self.clock.map(|_| self.us)
    }

    fn after(&mut self, phase: usize, w: &World) {
        if let Some(c) = self.clock {
            self.us[phase - 1] = ((c() - self.last) * 1000.0) as f32;
        }
        self.check(phase, w);
        // The checks below are not the phase's work: the next phase's time starts after them.
        if let Some(c) = self.clock {
            self.last = c();
        }
    }

    fn check(&mut self, phase: usize, w: &World) {
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
