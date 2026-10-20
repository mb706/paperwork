//! The scenario DSL (10 §10.2): a world, players acting through the [`TestSequencer`], ticks, assertions on
//! the World and its events, and the D18 checks over the closures the run recorded:
//! [`Scenario::check_equivalence`] runs them again under NO_SLEEP, through a save and a load at seeded ticks,
//! and in heavy mode, comparing the full canonical state after every tick for the first 2,000 ticks (D18 a–c);
//! [`Scenario::write_log`] records the run as a closure log with its start state and final hash, which the
//! replay test replays (D18 e).

use super::{Closures, Variant, check_equivalence, start_from};
use crate::context::SimContext;
use crate::r#gen::Player;
use crate::world::World;
use crate::{SimError, SimResult};
use schema::codec::{Fixed, Packed, Reader, Writer};
use schema::container::{
    CLOSURE_LOG_FORMAT_VERSION, CLOSURE_LOG_MAGIC, ClosureLogFlags, ClosureLogHeader, ClosureRecord,
};
use schema::events::{EventHeader, EventPayload, read_event};
use schema::{ACTION_SCHEMA_VERSION, Action, Hash256, NewWorld, PlayerIndex, SimFlags, Tick};
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

    pub fn world(&self) -> &World {
        self.ctx.world().expect("a scenario has a world")
    }

    /// The current tick (the last one run).
    pub fn tick(&self) -> u32 {
        self.world().current_tick()
    }

    pub fn player(&self, i: u16) -> &Player {
        self.world().players.get(PlayerIndex(i)).unwrap_or_else(|| panic!("no player {i}"))
    }

    /// Queues an action of player `i` for the next tick, held inputs stamped with its current generation.
    pub fn act(&mut self, i: u16, a: Action<'_>) {
        let t = self.tick() + 1;
        self.act_at(t, i, a);
    }

    /// Queues an action of player `i` for tick `t`, held inputs stamped now (D22: a release before `t` fences it).
    pub fn act_at(&mut self, t: u32, i: u16, a: Action<'_>) {
        let g = self.world().players.get(PlayerIndex(i)).map_or(0, |p| p.input_gen);
        self.seq.push(t, PlayerIndex(i), &a.with_input_gen(g));
    }

    /// Queues a system action for the next tick.
    pub fn system(&mut self, a: Action<'_>) {
        let t = self.tick() + 1;
        self.seq.push_system(t, &a);
    }

    /// Queues a system action for tick `t`.
    pub fn system_at(&mut self, t: u32, a: Action<'_>) {
        self.seq.push_system(t, &a);
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

fn enc(e: schema::codec::EncodeError) -> SimError {
    SimError::new(schema::SimStatus::ErrInput, e.to_string())
}
