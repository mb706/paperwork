//! The module's state behind the ABI (10 §3.6, §15.8): `SimContext { world, pres }` and what the exports
//! remember between calls (the prototypes, the lineage, the last digests, the flags, the blobs, the last world
//! call and its load report). `simabi` wraps it in the generated C exports (C2c); native tests and `simtool`
//! call it directly. Every method returns the export's status as a [`SimError`] on failure, and a refused
//! call changes nothing.
//!
//! Outputs are the envelopes' payloads (the bytes after §15.8's `u32 len`), so they compare byte for byte
//! with the golden ABI traces' `out` files (test/golden/README.md "ABI traces").

use crate::digest::lineage0;
use crate::r#gen::{Globals, Surface};
use crate::presentation::PresentationState;
use crate::regen::Answers;
use crate::save::{self, StateHashes, WORLDGEN_VERSION, WorldgenId};
use crate::sha256::sha256;
use crate::tick::{PHASES, TickIo, TickScratch};
use crate::world::World;
use crate::{SimError, SimResult, digest};
use schema::codec::{Fixed, Packed, Writer};
use schema::{
    ChunkRequest, DigestResult, Hash256, InitInput, LoadReport, NewWorld, PlayerMeta, Protos, RemovedProto,
    SaveFlags, SaveInput, SectionHash, Serial, SimFlags, SimMeta, SimStatus, SurfaceIndex, Tick,
};
use std::sync::Arc;

/// `sim_meta`'s record (§15.8).
pub type SimMetaOut = SimMeta;

/// The largest blob (11 §3.2: "a blob is at most 8 MiB"; sections.yaml `LogBlob.length`).
pub const BLOB_MAX_BYTES: usize = 8 << 20;
/// The most blobs held for one tick.
pub const BLOBS_MAX: usize = 64;
/// The most bytes of blobs held for one tick.
pub const BLOBS_MAX_BYTES: usize = 32 << 20;

/// The last world call (§15.8: `sim_load_report` answers only after `sim_load`, until the next world call).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorldCall {
    NewWorld,
    Load,
}

/// The loaded prototypes and what the module derives from them once.
#[derive(Debug)]
struct Loaded {
    protos: Arc<Protos>,
    /// `prototypes.bin` itself: the world hash covers it (§15.9).
    bin: Arc<Vec<u8>>,
    worldgen: WorldgenId,
}

/// The module.
#[derive(Debug, Default)]
pub struct SimContext {
    protos: Option<Loaded>,
    world: Option<World>,
    pub pres: PresentationState,
    /// The digest lineage r (§4.8): the load's or r₀, then rolled by every tick.
    r: u64,
    /// The last tick's d_t and slice_t (0 before any tick of this world in this module).
    d: u64,
    slice: u64,
    flags: SimFlags,
    /// Blobs supplied for the next tick (§15.3), ascending by SHA-256, within the limits below.
    blobs: Vec<([u8; 32], Vec<u8>)>,
    /// Their total size in bytes.
    blob_bytes: usize,
    last_world_call: Option<WorldCall>,
    report: Option<LoadReport>,
    scratch: TickScratch,
    /// Whether ticks record the full state hash after each phase (§4.8 item 5; `simtool bisect`, tests). Not an
    /// ABI flag: 16 full hashes per tick would distort a profile.
    want_phase_digests: bool,
    /// The last tick's per-phase digests, when wanted.
    phase_digests: Option<[u64; PHASES]>,
    /// Worldgen requests issued since the last `sim_pending_chunks` (after a load: every pending request of
    /// the save, §15.8).
    issued: Vec<ChunkRequest>,
    /// Worker answers held for pending requests (`sim_supply_chunk`, §15.9).
    answers: Answers,
    /// The world hash of the current world (§15.9).
    world_hash: u64,
    /// Ticks verify that refusals change nothing (tests).
    check_refusals: bool,
    /// The module's linear memory in bytes, for `DEBUG` (simabi sets it; 0 natively).
    memory_probe: Option<fn() -> u32>,
    /// The host's clock in milliseconds (simabi's `host_now`, simtool's), read only for `PROFILE`'s per-phase
    /// times (§10.6), which go to presentation and never into the World (D13).
    clock: Option<fn() -> f64>,
    /// The pool columns, reused by [`Self::column_fingerprint`].
    cols: Vec<(u32, usize, usize)>,
}

fn order(m: &str) -> SimError {
    SimError::new(SimStatus::ErrOrder, m)
}

fn input(m: impl Into<String>) -> SimError {
    SimError::new(SimStatus::ErrInput, m)
}

impl SimContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// `sim_init` (§15.8): `InitInput` = `u32 protos_len`, `prototypes.bin`, `u32 flags`, `u32 reserved`.
    /// Loads the prototypes (`ERR_PROTOS` when `Protos::load` refuses them); drops any world.
    pub fn init(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        let v = InitInput::decode_exact(input_bytes).map_err(|e| input(format!("InitInput: {e}")))?;
        self.init_protos(v.protos, v.flags)
    }

    /// `sim_init` from its parts.
    pub fn init_protos(&mut self, protos_bin: &[u8], flags: SimFlags) -> SimResult<()> {
        let protos = Protos::load(protos_bin)
            .map_err(|e| SimError::new(SimStatus::ErrProtos, format!("prototypes.bin: {e}")))?;
        let data_hash = save::worldgen_data_hash(protos_bin)
            .ok_or_else(|| SimError::new(SimStatus::ErrProtos, "prototypes.bin lacks a worldgen table"))?;
        *self = Self::default();
        self.protos = Some(Loaded {
            protos: Arc::new(protos),
            bin: Arc::new(protos_bin.to_vec()),
            worldgen: WorldgenId { version: WORLDGEN_VERSION, data_hash },
        });
        self.flags = flags;
        Ok(())
    }

    fn loaded(&self) -> SimResult<&Loaded> {
        self.protos.as_ref().ok_or_else(|| order("sim_init has not run"))
    }

    /// The prototypes `sim_init` loaded.
    pub fn protos(&self) -> Option<&Arc<Protos>> {
        self.protos.as_ref().map(|l| &l.protos)
    }

    /// This build's worldgen identity (§4.4).
    pub fn worldgen(&self) -> Option<WorldgenId> {
        self.protos.as_ref().map(|l| l.worldgen)
    }

    pub fn world(&self) -> Option<&World> {
        self.world.as_ref()
    }

    /// The World, for tests and tools that build scenarios directly (never the ABI).
    pub fn world_mut(&mut self) -> Option<&mut World> {
        self.world.as_mut()
    }

    fn world_or_order(&self) -> SimResult<&World> {
        self.world.as_ref().ok_or_else(|| order("no world: call sim_new_world or sim_load first"))
    }

    /// The digest lineage r (§4.8).
    pub fn lineage(&self) -> u64 {
        self.r
    }

    /// The last tick's slice hash (0 before any tick).
    pub fn last_slice(&self) -> u64 {
        self.slice
    }

    /// The last tick's d_t (0 before any tick).
    pub fn last_digest(&self) -> u64 {
        self.d
    }

    /// The last tick's d_t preimage (§4.8 item 1), for tests and the golden comparison.
    pub fn last_preimage(&self) -> &[u8] {
        &self.scratch.preimage
    }

    /// The full state hash after each phase of the last tick, when [`Self::set_phase_digests`] asked for them.
    pub fn last_phase_digests(&self) -> Option<&[u64; PHASES]> {
        self.phase_digests.as_ref()
    }

    /// Per-phase digests (§4.8 item 5): every later tick records the full state hash after each of its phases,
    /// to name the system in which two runs first differ. Native tools only.
    pub fn set_phase_digests(&mut self, on: bool) {
        self.want_phase_digests = on;
    }

    /// The world hash of a world with these settings under the loaded prototypes (§15.9).
    fn generator_for(&self, globals: &Globals) -> SimResult<Arc<worldgen::Generator>> {
        let l = self.loaded()?;
        let hash = worldgen::world_hash(&l.bin, globals.seed, &globals.map, &globals.world);
        Ok(Arc::new(worldgen::Generator::new(&l.protos, globals.seed, &globals.map, &globals.world, hash)))
    }

    /// Replaces the world (a new game or a load): fresh presentation and digests, the module's flags applied.
    fn install(&mut self, mut world: World, r: u64, call: WorldCall) {
        world.set_no_sleep(self.flags.contains(SimFlags::NO_SLEEP));
        self.answers.clear();
        self.world_hash = world.regen.generator().map_or(0, |g| g.world_hash());
        self.world = Some(world);
        self.r = r;
        self.d = 0;
        self.slice = 0;
        self.pres = PresentationState::default();
        self.pres.events.historical = self.flags.contains(SimFlags::HISTORICAL);
        self.last_world_call = Some(call);
        self.blobs.clear();
        self.blob_bytes = 0;
        self.issued = self.world.as_ref().map_or_else(Vec::new, |w| {
            w.pending()
                .iter()
                .map(|&(commit_tick, surface, cy, cx)| ChunkRequest { surface, cx, cy, commit_tick })
                .collect()
        });
    }

    /// `sim_new_world` (§15.8): one `new_world` record, read strictly; the world at tick 0 with lineage r₀.
    /// C2a: the settings and the empty surface; worldgen's pre-generation arrives with C2b.
    pub fn new_world(&mut self, record: &[u8]) -> SimResult<()> {
        let l = self.loaded()?;
        let nw = NewWorld::decode_exact(record, true).map_err(|e| input(format!("new_world: {e}")))?;
        // Settings that bound generation (C2b-r1 finding 4).
        worldgen::check_settings(&nw.map, &l.protos).map_err(|e| input(format!("new_world: {e}")))?;
        let globals = Globals {
            tick: Tick(0),
            seed: nw.seed,
            map: nw.map,
            world: nw.world,
            game: nw.game,
            surfaces: vec![Surface { index: SurfaceIndex(0) }],
            worldgen_version: l.worldgen.version,
            worldgen_data_hash: Hash256 { bytes: l.worldgen.data_hash },
            next_serial: Serial(1),
            last_system_seq: schema::Seq(0),
        };
        let mut world = World::new(l.protos.clone(), globals);
        world.regen.set_generator(self.generator_for(&world.globals)?);
        // §5.18 stage 10: every chunk within the pre-generation radius of spawn, inline, before tick 1.
        let mut wanted = Vec::new();
        world.pregen_wanted(SurfaceIndex(0), 0, 0, &mut wanted);
        wanted.sort_unstable();
        for (surface, cy, cx) in wanted {
            let d = world.regen.generate(surface, schema::chunk_key(cx, cy));
            world.commit_generated(d);
        }
        self.report = None;
        self.install(world, lineage0(nw.seed), WorldCall::NewWorld);
        Ok(())
    }

    /// The world hash of the current world (§15.9; 0 without a world).
    pub fn world_hash(&self) -> u64 {
        self.world_hash
    }

    /// Ticks verify that every refused action left the state unchanged (§15.3; a state hash per action).
    pub fn set_check_refusals(&mut self, on: bool) {
        self.check_refusals = on;
    }

    /// `sim_load` (§15.8, §8.1–§8.3): `LoadInput`.
    pub fn load(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        let l = self.loaded()?;
        let req = save::parse_load_input(input_bytes, &l.protos)?;
        let mut out = save::load(&l.protos, &l.worldgen, &req)?;
        let generator = self.generator_for(&out.world.globals)?;
        out.world.regen.set_generator(generator);
        self.report = Some(LoadReport { new_lineage: out.new_lineage, r: out.r, removed: out.removed });
        self.install(out.world, out.r, WorldCall::Load);
        Ok(())
    }

    /// `sim_tick` (§15.8): the closure of tick `world.tick + 1`. Blobs are held for this tick only.
    pub fn tick(&mut self, closure: &[u8]) -> SimResult<()> {
        let blobs = std::mem::take(&mut self.blobs);
        let Some(world) = self.world.as_mut() else {
            return Err(order("no world: call sim_new_world or sim_load first"));
        };
        self.blob_bytes = 0;
        let has_blob = |h: &[u8; 32]| blobs.binary_search_by(|b| b.0.cmp(h)).is_ok();
        let mut phases = [0u64; PHASES];
        let profile = self.want_phase_digests;
        let clock = if self.flags.contains(SimFlags::PROFILE) { self.clock } else { None };
        let mut io = TickIo {
            has_blob: &has_blob,
            pres: &mut self.pres,
            scratch: &mut self.scratch,
            answers: &mut self.answers,
            issued: &mut self.issued,
            phase_digests: if profile { Some(&mut phases) } else { None },
            clock,
            check_refusals: self.check_refusals,
        };
        let dg = world.tick(closure, &mut io)?;
        self.answers.retain_pending(world);
        // The shell forgets requests whose commit tick has passed (§15.9); so does the list it has not fetched.
        let now = world.current_tick();
        self.issued.retain(|q| q.commit_tick.0 > now);
        self.d = dg.d;
        self.slice = dg.slice;
        self.r = digest::roll(self.r, dg.d, dg.slice);
        self.phase_digests = profile.then_some(phases);
        Ok(())
    }

    /// `sim_set_flags` (§15.8): bit 0 NO_SLEEP, bit 1 HISTORICAL, bit 2 PROFILE; others `ERR_INPUT`.
    pub fn set_flags(&mut self, flags: u32) -> SimResult<()> {
        let f = SimFlags::from_bits(flags)
            .ok_or_else(|| input(format!("undeclared SimFlags bits {flags:#x}")))?;
        self.flags = f;
        self.pres.events.historical = f.contains(SimFlags::HISTORICAL);
        if let Some(w) = self.world.as_mut() {
            w.set_no_sleep(f.contains(SimFlags::NO_SLEEP));
        }
        Ok(())
    }

    pub fn flags(&self) -> SimFlags {
        self.flags
    }

    /// `sim_blob_put` (§15.3): `u8 sha256[32]`, then the bytes; held for the next tick only. The shell has
    /// checked the hash; a module built with `simcheck` checks it again.
    ///
    /// Bounded before anything is copied (C2a-r1 finding 5): a blob is at most [`BLOB_MAX_BYTES`] (11 §3.2's
    /// 8 MiB; `ERR_INPUT` above), and the blobs held for one tick at most [`BLOBS_MAX`] and
    /// [`BLOBS_MAX_BYTES`] together (`ERR_LIMIT` past either). A blob already held is not copied again.
    pub fn blob_put(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        let v = schema::BlobPut::decode_exact(input_bytes).map_err(|e| input(format!("BlobPut: {e}")))?;
        if v.bytes.len() > BLOB_MAX_BYTES {
            return Err(input(format!("a blob of {} bytes: at most {BLOB_MAX_BYTES}", v.bytes.len())));
        }
        let Err(at) = self.blobs.binary_search_by(|b| b.0.cmp(&v.sha256.bytes)) else {
            return Ok(());
        };
        if self.blobs.len() >= BLOBS_MAX || self.blob_bytes + v.bytes.len() > BLOBS_MAX_BYTES {
            return Err(SimError::new(
                SimStatus::ErrLimit,
                format!(
                    "{} blobs of {} bytes are held for the next tick: at most {BLOBS_MAX} and {BLOBS_MAX_BYTES} bytes",
                    self.blobs.len(),
                    self.blob_bytes
                ),
            ));
        }
        if cfg!(feature = "simcheck") && sha256(v.bytes) != v.sha256.bytes {
            return Err(input("the blob's bytes do not hash to its SHA-256"));
        }
        self.blobs.insert(at, (v.sha256.bytes, v.bytes.to_vec()));
        self.blob_bytes += v.bytes.len();
        Ok(())
    }

    /// The bytes of a blob supplied for this tick.
    pub fn blob(&self, h: &[u8; 32]) -> Option<&[u8]> {
        self.blobs.binary_search_by(|b| b.0.cmp(h)).ok().map(|i| self.blobs[i].1.as_slice())
    }

    /// `sim_pending_chunks` (§15.8, §15.9): the requests issued since the last call; after `sim_load`, every
    /// pending request of the save.
    pub fn pending_chunks(&mut self) -> SimResult<Vec<u8>> {
        let mut out = Vec::new();
        self.pending_chunks_into(&mut out)?;
        Ok(out)
    }

    /// [`Self::pending_chunks`] appended to `out` (the module's steady state allocates nothing, §2.5).
    pub fn pending_chunks_into(&mut self, out: &mut Vec<u8>) -> SimResult<()> {
        self.world_or_order()?;
        schema::PendingChunks { requests: schema::codec::List::from_slice(&self.issued) }
            .encode(&mut Writer::new(out))
            .map_err(enc)?;
        self.issued.clear();
        Ok(())
    }

    /// `sim_supply_chunk` (§15.8, §15.9): one `chunk_data` record, read strictly. An answer to no pending
    /// request (late, or never asked for) or for another world is ignored (rule 45); one that answers a pending
    /// request is held until its commit tick, which takes it instead of generating the chunk inline. An answer
    /// with this world's hash but impossible content (a tile or resource the prototypes lack, resources out of
    /// order) is `ERR_INPUT`.
    pub fn supply_chunk(&mut self, record: &[u8]) -> SimResult<()> {
        let w = self.world_or_order()?;
        let d =
            schema::ChunkData::decode_exact(record, true).map_err(|e| input(format!("chunk_data: {e}")))?;
        if d.world_hash != self.world_hash || !w.is_pending(d.surface, d.key) {
            return Ok(());
        }
        let tiles = w.protos.tile.len();
        if let Some(t) = d.tiles.iter().find(|t| usize::from(t.0) >= tiles) {
            return Err(input(format!("chunk_data: tile {} of {tiles}", t.0)));
        }
        let resources = w.protos.resource.len();
        let ordered = d.resources.windows(2).all(|p| p[0].tile < p[1].tile);
        let bad = |r: &schema::ResourceTile| {
            usize::from(r.resource.0) >= resources || r.tile >= 1024 || r.amount == 0
        };
        if !ordered || d.resources.iter().any(bad) {
            return Err(input("chunk_data: resources out of order, empty or unknown"));
        }
        // Worldgen v0 makes no trees, objects, cliffs or town features (M0's prototypes have none), and its
        // climate is finite: an answer with them did not come from this build's generator.
        if !(d.trees.is_empty() && d.objects.is_empty() && d.cliffs.is_empty() && d.town_features.is_empty())
        {
            return Err(input("chunk_data: features worldgen v0 does not generate"));
        }
        if !(d.theta.is_finite() && d.sunlight.is_finite()) {
            return Err(input("chunk_data: a climate that is not finite"));
        }
        // Builds with simcheck (tests, the dev module) check the answer against the world's own generator
        // (C2b-r1 finding 1): structure cannot prove that a worker generated this world's chunk.
        if cfg!(feature = "simcheck") {
            let (cx, cy) = schema::chunk_xy(d.key);
            let own = w.regen.generator().map(|g| g.chunk(d.surface, cx, cy));
            if own.as_ref() != Some(&d) {
                return Err(input("chunk_data: not the chunk this world generates (simcheck)"));
            }
        }
        self.answers.put(d);
        Ok(())
    }

    /// Sets the probe `DEBUG` reads the module's memory size from (simabi).
    pub fn set_memory_probe(&mut self, f: fn() -> u32) {
        self.memory_probe = Some(f);
    }

    /// Sets the host clock (milliseconds) that `PROFILE` reads between the tick's phases (§10.6's per-phase µs;
    /// `DEBUG.phase_us`).
    pub fn set_clock(&mut self, f: fn() -> f64) {
        self.clock = Some(f);
    }

    /// The last profiled tick's µs per phase (§4.6's 16 phases), with `PROFILE` and a clock.
    pub fn phase_us(&self) -> Option<&[f32; PHASES]> {
        self.pres.phase_us.as_ref()
    }

    fn debug_inputs(&self) -> crate::project::DebugInputs {
        crate::project::DebugInputs {
            d: self.d,
            r: self.r,
            memory_bytes: self.memory_probe.map_or(0, |f| f()),
            phase_us: self.pres.phase_us,
        }
    }

    /// `sim_extract` (§15.4, §15.8): one view request (`ViewRequest`, 52 bytes) → one complete packet.
    pub fn extract(&mut self, view_bytes: &[u8]) -> SimResult<Vec<u8>> {
        let mut out = Vec::new();
        self.extract_into(view_bytes, &mut out)?;
        Ok(out)
    }

    /// [`Self::extract`] appended to `out` and delivered: once its buffers have grown, extraction allocates
    /// nothing (§2.5).
    pub fn extract_into(&mut self, view_bytes: &[u8], out: &mut Vec<u8>) -> SimResult<()> {
        out.extend_from_slice(self.extract_stage(view_bytes)?);
        self.extract_commit();
        Ok(())
    }

    /// `sim_extract`'s first half (C2c-r1 finding 4): builds the next packet and returns it, staging what it
    /// changes in what the main thread holds. Nothing is committed until [`Self::extract_commit`], so a packet
    /// that cannot be handed over (the module's arena cannot grow) loses no delta, record or event.
    pub fn extract_stage(&mut self, view_bytes: &[u8]) -> SimResult<&[u8]> {
        let dbg = self.debug_inputs();
        let Some(world) = self.world.as_ref() else {
            return Err(order("no world: call sim_new_world or sim_load first"));
        };
        let mut r = schema::codec::Reader::new(view_bytes);
        let view = <schema::packet::ViewRequest as Fixed>::read(&mut r, "ViewRequest")
            .and_then(|v| r.finish("ViewRequest").map(|()| v))
            .map_err(|e| input(format!("ViewRequest: {e}")))?;
        let PresentationState { events, moves, extract, .. } = &mut self.pres;
        let io = crate::extract::ExtractIo { events, moves, dbg };
        extract.stage(world, &view, &io).map_err(enc)
    }

    /// `sim_extract`'s second half: the staged packet was delivered.
    pub fn extract_commit(&mut self) {
        let PresentationState { events, extract, .. } = &mut self.pres;
        extract.commit(events);
    }

    /// `sim_subscribe` (§15.5, §15.8): `SubscribeInput`; `ERR_INPUT` for a malformed request or sub_id 0;
    /// `ERR_LIMIT` for a batch over the subscription table's bounds (C2c-r1 finding 1), checked before anything
    /// is copied.
    pub fn subscribe(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        use crate::extract::{SUBSCRIBE_BATCH_MAX, SubscribeError};
        self.world_or_order()?;
        let v = schema::SubscribeInput::decode_exact(input_bytes)
            .map_err(|e| input(format!("SubscribeInput: {e}")))?;
        let limit = || {
            SimError::new(
                SimStatus::ErrLimit,
                format!(
                    "a subscription batch of {} requests: at most {SUBSCRIBE_BATCH_MAX}, and at most \
                     {} refusals waiting for their record",
                    v.subs.len(),
                    crate::extract::REFUSALS_MAX
                ),
            )
        };
        if v.subs.len() > SUBSCRIBE_BATCH_MAX {
            return Err(limit());
        }
        let mut reqs = [schema::projections::SubRequest::default(); SUBSCRIBE_BATCH_MAX];
        let mut n = 0;
        v.subs.for_each(|r| {
            reqs[n] = *r;
            n += 1;
        });
        match self.pres.extract.subscribe(&reqs[..n]) {
            Ok(()) => Ok(()),
            Err(SubscribeError::HoverId) => Err(input("sub_id 0 belongs to the hover projection")),
            Err(SubscribeError::Limit) => Err(limit()),
        }
    }

    /// `sim_unsubscribe` (§15.8): `UnsubscribeInput`; unknown ids are ignored.
    pub fn unsubscribe(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        self.world_or_order()?;
        let v = schema::UnsubscribeInput::decode_exact(input_bytes)
            .map_err(|e| input(format!("UnsubscribeInput: {e}")))?;
        let ids: Vec<u32> = v.ids.iter().map(|x| x.0).collect();
        self.pres.extract.unsubscribe(&ids);
        Ok(())
    }

    /// `sim_query` (§15.5, §15.8): `QueryInput`; `ERR_LIMIT` with 4 running.
    pub fn query(&mut self, input_bytes: &[u8]) -> SimResult<()> {
        let tick = self.world_or_order()?.current_tick();
        let v =
            schema::QueryInput::decode_exact(input_bytes).map_err(|e| input(format!("QueryInput: {e}")))?;
        self.pres.queries.start(v.id.0, v.header.kind, v.header.flags, v.params, tick)
    }

    /// `sim_query_step(units)` (§15.8): `QueryStepOutput` of the queries that finished.
    pub fn query_step(&mut self, units: u32) -> SimResult<Vec<u8>> {
        let (d, r) = (self.d, self.r);
        let Some(world) = self.world.as_ref() else {
            return Err(order("no world: call sim_new_world or sim_load first"));
        };
        let mut out = Vec::new();
        self.pres.queries.step(world, units, d, r, &mut out)?;
        Ok(out)
    }

    /// `sim_query_cancel(id)` (§15.8): an unknown id is ignored.
    pub fn query_cancel(&mut self, id: u32) -> SimResult<()> {
        self.world_or_order()?;
        self.pres.queries.cancel(id);
        Ok(())
    }

    /// `sim_pool_dir` (§15.8): the generated pool directory for the shell's read views, `(column, ptr, len)`
    /// (the pointers are linear-memory addresses in the module; natively they are only distinct).
    pub fn pool_dir(&self) -> SimResult<Vec<u8>> {
        let w = self.world_or_order()?;
        let mut cols = Vec::new();
        w.containers.view_columns(&mut cols);
        w.entities.view_columns(&mut cols);
        cols.sort_unstable_by_key(|c| c.0);
        let list: Vec<schema::PoolColumn> = cols
            .iter()
            .map(|&(column, ptr, len)| schema::PoolColumn { column, ptr: ptr as u32, len: len as u32 })
            .collect();
        let mut out = Vec::new();
        schema::PoolDir { columns: schema::codec::List::from_slice(&list) }
            .encode(&mut Writer::new(&mut out))
            .map_err(enc)?;
        Ok(out)
    }

    /// The pool columns' `(ptr, len)` in a fixed order (simabi's memory epoch rises when one moves, §15.8).
    pub fn column_fingerprint(&mut self) -> u64 {
        let Some(w) = self.world.as_ref() else {
            return 0;
        };
        self.cols.clear();
        w.containers.view_columns(&mut self.cols);
        w.entities.view_columns(&mut self.cols);
        let mut h = crate::hash::Xxh64::new();
        for &(c, p, l) in &self.cols {
            h.u32(c);
            h.u64(p as u64);
            h.u64(l as u64);
        }
        h.digest()
    }

    /// `sim_digest` (§15.8): `DigestResult` = the tick, then d and r.
    pub fn digest(&self) -> SimResult<Vec<u8>> {
        let mut out = Vec::with_capacity(DigestResult::SIZE);
        self.digest_into(&mut out)?;
        Ok(out)
    }

    /// [`Self::digest`] appended to `out`.
    pub fn digest_into(&self, out: &mut Vec<u8>) -> SimResult<()> {
        let w = self.world_or_order()?;
        DigestResult { tick: Tick(w.current_tick()), d: self.d, r: self.r }
            .write(&mut Writer::new(out), "DigestResult")
            .map_err(enc)
    }

    /// The full state hash and each section's (§4.8).
    pub fn state_hashes(&self) -> SimResult<StateHashes> {
        save::state_hash(self.world_or_order()?)
    }

    /// `sim_state_hash` (§15.8): `StateHash` = the full hash, `u32` count, then (section, hash).
    pub fn state_hash(&self) -> SimResult<Vec<u8>> {
        let h = self.state_hashes()?;
        let list: Vec<SectionHash> =
            h.sections.iter().map(|&(section, hash)| SectionHash { section, hash }).collect();
        let mut out = Vec::new();
        schema::StateHash { hash: h.full, sections: schema::codec::List::from_slice(&list) }
            .encode(&mut Writer::new(&mut out))
            .map_err(enc)?;
        Ok(out)
    }

    /// `sim_save` (§15.8): `SaveInput` (`u32` flags, bit 0 BAKE) → `SaveOutput`. A baked save carries a new
    /// lineage over its own state (§4.4, §4.8 item 4); the running world keeps its r.
    pub fn save(&self, input_bytes: &[u8]) -> SimResult<Vec<u8>> {
        let w = self.world_or_order()?;
        let v = SaveInput::decode_exact(input_bytes).map_err(|e| input(format!("SaveInput: {e}")))?;
        let bake = v.flags.contains(SaveFlags::BAKE);
        let sections = if bake && w.chunks.has_pristine() {
            // §4.4: a baked save stores every generated chunk, so it loads under any worldgen version.
            let mut baked = w.clone();
            baked.bake_pristine();
            save::encode_sections(&baked)?
        } else {
            save::encode_sections(w)?
        };
        let r =
            if bake { digest::lineage_of(save::state_hash_of(&sections), w.current_tick()) } else { self.r };
        let mut out = Vec::new();
        save::write_save_output(&sections, r, &mut out)?;
        Ok(out)
    }

    /// `sim_save` without flags (a checkpoint, §8.6).
    pub fn checkpoint(&self) -> SimResult<Vec<u8>> {
        self.save(&0u32.to_le_bytes())
    }

    /// The `sim_meta` record (§15.8): tick, seed, `last_system_seq`, the worldgen version, r and every player's
    /// index, online flag, `last_seq` and input generation.
    pub fn meta_record(&self) -> SimResult<SimMeta> {
        let w = self.world_or_order()?;
        Ok(SimMeta {
            tick: Tick(w.current_tick()),
            seed: w.globals.seed,
            last_system_seq: w.globals.last_system_seq,
            worldgen_version: w.globals.worldgen_version,
            r: self.r,
            players: w
                .players
                .iter()
                .map(|p| PlayerMeta {
                    index: p.index,
                    online: p.online,
                    last_seq: p.last_seq,
                    input_gen: p.input_gen,
                })
                .collect(),
        })
    }

    /// `sim_meta` (§15.8): the record's bytes.
    pub fn meta(&self) -> SimResult<Vec<u8>> {
        let m = self.meta_record()?;
        let mut out = Vec::new();
        m.encode(&mut Writer::new(&mut out)).map_err(enc)?;
        Ok(out)
    }

    /// The load report (rule 43): after `sim_load`, until the next world call.
    pub fn load_report_record(&self) -> SimResult<&LoadReport> {
        match (self.last_world_call, &self.report) {
            (Some(WorldCall::Load), Some(r)) => Ok(r),
            _ => Err(order("sim_load_report answers only after sim_load")),
        }
    }

    /// `sim_load_report` (§15.8): the record's bytes.
    pub fn load_report(&self) -> SimResult<Vec<u8>> {
        let r = self.load_report_record()?;
        let mut out = Vec::new();
        r.encode(&mut Writer::new(&mut out)).map_err(enc)?;
        Ok(out)
    }

    /// The removed prototypes of the last load.
    pub fn removed(&self) -> &[RemovedProto] {
        self.report.as_ref().map_or(&[], |r| r.removed.as_slice())
    }
}

fn enc(e: schema::codec::EncodeError) -> SimError {
    SimError::new(SimStatus::ErrOrder, format!("cannot encode: {e}"))
}
