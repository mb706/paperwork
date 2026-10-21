//! The multi-client harness (D18 f; 10 §10.4 #8, 11 §9 item 2; C8): N worlds in one process fed one closure stream
//! through a simulated sequencer, as a room's clients are fed by the relay. M0 builds it natively; the MP milestone
//! adds the relay's `RoomCore` and a simulated network in front of the same stream.
//!
//! - [`Room`] holds the stream (every tick's closure, what a relay keeps for joins and catch-up), the sequencer
//!   that writes it ([`TestSequencer`]), and the clients.
//! - Every client applies every closure; after each tick their d_t and r_t must agree (the cheap check a room
//!   makes), and after every injected fault [`Room::agree`] compares their **full canonical state**
//!   (A2-r1 #15), naming the first differing section and field.
//! - Each client reads its world its own way ([`Reads`]): extraction every tick with its own view and
//!   subscriptions, never, or at random with queries; D9 and D10 say no read schedule changes the state.
//! - The faults: a join by checkpoint mid-run ([`Room::join`], the snapshot from a donor client), a client that
//!   crashes and comes back from its own last checkpoint and catches up from the stream ([`Room::crash`]), a client
//!   re-synced from another's snapshot ([`Room::resync`]), and NO_SLEEP on one client ([`Room::set_no_sleep`]).

use super::sequencer::TestSequencer;
use super::{canonical_state, diff_states, start_from};
use crate::context::SimContext;
use crate::rng::Xoshiro128;
use crate::{SimError, SimResult};
use schema::codec::{Fixed, MsgList, Packed, Writer};
use schema::packet::{ViewFlags, ViewRequest};
use schema::projections::{ProjectionKind, QueryHeader, QueryKind, SubRequest};
use schema::{
    Action, PlayerIndex, QueryInput, Seq, Serial, SimFlags, SimStatus, SubFlags, SubId, SubscribeInput,
    SurfaceIndex,
};
use std::collections::BTreeMap;

/// How a client reads its world.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reads {
    /// Never: no extraction, no subscription, no query.
    None,
    /// An extraction after every tick, with a view of `half` tiles around player `follow` and the M0 projections
    /// of that player subscribed (HUD, CHARACTER, STATS).
    EveryTick { follow: u16, half: i32 },
    /// Extractions and state-hash queries at random ticks (seeded), with a view that jumps around.
    Random { seed: u32 },
}

/// One client: a world and how it reads it.
pub struct Client {
    pub name: String,
    pub ctx: SimContext,
    pub reads: Reads,
    rng: Xoshiro128,
    subscribed: bool,
    query_id: u32,
    /// The client's own last checkpoint (its autosave): the tick and `sim_save`'s output.
    saved: Option<(u32, Vec<u8>)>,
}

/// A room: one closure stream and the clients it feeds.
pub struct Room {
    protos: Vec<u8>,
    pub seq: TestSequencer,
    pub clients: Vec<Client>,
    stream: BTreeMap<u32, Vec<u8>>,
    tick: u32,
    /// What happened, for failure messages and reports.
    pub log: Vec<String>,
}

fn err(m: String) -> SimError {
    SimError::new(SimStatus::ErrInput, m)
}

impl Client {
    fn new(name: &str, ctx: SimContext, reads: Reads) -> Self {
        let seed = match reads {
            Reads::Random { seed } => seed,
            Reads::None | Reads::EveryTick { .. } => 1,
        };
        Self {
            name: name.to_owned(),
            ctx,
            reads,
            rng: Xoshiro128::seeded(seed, 7),
            subscribed: false,
            query_id: 0,
            saved: None,
        }
    }

    fn view(x: f64, y: f64, half: i32, hovered: u32) -> Vec<u8> {
        let (cx, cy) = (x.floor() as i32, y.floor() as i32);
        let v = ViewRequest {
            view_seq: 0,
            surface: SurfaceIndex(0),
            flags: ViewFlags::AUDIO,
            x0: cx - half,
            y0: cy - half,
            x1: cx + half,
            y1: cy + half,
            zoom: 1.0,
            hovered_serial: Serial(hovered),
            audio_half_range: half as f32,
            chart_x0: 0,
            chart_y0: 0,
            chart_x1: 0,
            chart_y1: 0,
        };
        let mut out = Vec::new();
        v.write(&mut Writer::new(&mut out), "ViewRequest").expect("a view request encodes");
        out
    }

    /// The client's reads after a tick (D9: none of them may change the state).
    fn read(&mut self) -> SimResult<()> {
        match self.reads {
            Reads::None => Ok(()),
            Reads::EveryTick { follow, half } => {
                let Some(w) = self.ctx.world() else { return Ok(()) };
                let Some(p) = w.players.get(PlayerIndex(follow)) else { return Ok(()) };
                let (x, y, character) = (p.x, p.y, p.character.0);
                if !self.subscribed {
                    let subs: Vec<SubRequest<'_>> =
                        [ProjectionKind::Hud, ProjectionKind::Character, ProjectionKind::Stats]
                            .iter()
                            .enumerate()
                            .map(|(i, &kind)| SubRequest {
                                sub_id: SubId(i as u32 + 1),
                                kind,
                                flags: SubFlags::EMPTY,
                                target: u32::from(follow),
                                p0: 0,
                                p1: 0,
                                p2: 0,
                                p3: 0,
                                tail: None,
                            })
                            .collect();
                    let mut input = Vec::new();
                    SubscribeInput { subs: MsgList::from_slice(&subs) }
                        .encode(&mut Writer::new(&mut input))
                        .map_err(|e| err(e.to_string()))?;
                    self.ctx.subscribe(&input)?;
                    self.subscribed = true;
                }
                self.ctx.extract(&Self::view(x, y, half, character))?;
                Ok(())
            }
            Reads::Random { .. } => {
                let roll = self.rng.next_u32() % 10;
                if roll < 3 {
                    let (x, y) = (
                        f64::from(self.rng.next_u32() % 200) - 100.0,
                        f64::from(self.rng.next_u32() % 200) - 100.0,
                    );
                    let half = 8 + (self.rng.next_u32() % 40) as i32;
                    self.ctx.extract(&Self::view(x, y, half, self.rng.next_u32() % 12))?;
                } else if roll == 3 {
                    self.query_id += 1;
                    let q = QueryInput {
                        id: schema::QueryId(self.query_id),
                        header: QueryHeader { kind: QueryKind::Hash, flags: 0 },
                        params: &[],
                    };
                    let mut input = Vec::new();
                    q.encode(&mut Writer::new(&mut input)).map_err(|e| err(e.to_string()))?;
                    // At most 4 queries run at once (ERR_LIMIT): step them as the shell would.
                    if self.ctx.query(&input).is_ok() {
                        self.ctx.query_step(1 + self.rng.next_u32() % 64)?;
                    }
                } else if roll == 4 {
                    self.ctx.query_step(u32::MAX)?;
                }
                Ok(())
            }
        }
    }
}

impl Room {
    /// A room whose founding client `name` starts from `start` (`sim_save`'s output).
    pub fn new(protos: &[u8], start: &[u8], name: &str, reads: Reads) -> SimResult<Self> {
        let ctx = start_from(protos, start, SimFlags::EMPTY)?;
        let seq = TestSequencer::new(&ctx);
        let tick = ctx.world().map_or(0, crate::World::current_tick);
        Ok(Self {
            protos: protos.to_vec(),
            seq,
            clients: vec![Client::new(name, ctx, reads)],
            stream: BTreeMap::new(),
            tick,
            log: Vec::new(),
        })
    }

    /// The last tick the room closed.
    pub fn tick(&self) -> u32 {
        self.tick
    }

    /// Queues player `i`'s action for the next tick.
    pub fn act(&mut self, i: u16, a: Action<'_>) -> Seq {
        self.seq.push(self.tick + 1, PlayerIndex(i), &a).expect("in order")
    }

    /// Queues a system action for the next tick (the relay's joins, leaves and releases).
    pub fn system(&mut self, a: Action<'_>) -> Seq {
        self.seq.push_system(self.tick + 1, &a).expect("in order")
    }

    /// Closes the next tick: every client applies its closure and reads; their d_t and r_t must agree.
    pub fn step(&mut self) -> Result<(), String> {
        let t = self.tick + 1;
        let closure = self.seq.closure(t);
        let mut first: Option<(u64, u64)> = None;
        for c in &mut self.clients {
            c.ctx.tick(&closure).map_err(|e| format!("{}: tick {t}: {e}", c.name))?;
            let dr = (c.ctx.last_digest(), c.ctx.lineage());
            match first {
                None => first = Some(dr),
                Some(f) if f != dr => {
                    return Err(format!(
                        "tick {t}: {}'s d_t {:016x} r_t {:016x} differ from the first client's {:016x} {:016x}",
                        c.name, dr.0, dr.1, f.0, f.1
                    ));
                }
                Some(_) => {}
            }
            c.read().map_err(|e| format!("{}: a read after tick {t}: {e}", c.name))?;
        }
        if !closure.is_empty() {
            self.stream.insert(t, closure);
        }
        self.tick = t;
        Ok(())
    }

    /// Closes `n` ticks.
    pub fn run(&mut self, n: u32) -> Result<(), String> {
        for _ in 0..n {
            self.step()?;
        }
        Ok(())
    }

    fn index(&self, name: &str) -> usize {
        self.clients.iter().position(|c| c.name == name).unwrap_or_else(|| panic!("no client {name}"))
    }

    /// A join by checkpoint (11 §4): `donor`'s world saved now and loaded into a new client, which then follows
    /// the stream.
    pub fn join(&mut self, name: &str, donor: &str, reads: Reads) -> SimResult<()> {
        let snapshot = self.clients[self.index(donor)].ctx.checkpoint()?;
        let ctx = start_from(&self.protos, &snapshot, SimFlags::EMPTY)?;
        self.clients.push(Client::new(name, ctx, reads));
        self.log.push(format!("tick {}: {name} joined from {donor}'s snapshot", self.tick));
        Ok(())
    }

    /// Client `name` keeps a checkpoint now (its autosave).
    pub fn checkpoint(&mut self, name: &str) -> SimResult<()> {
        let i = self.index(name);
        let save = self.clients[i].ctx.checkpoint()?;
        self.clients[i].saved = Some((self.tick, save));
        Ok(())
    }

    /// Client `name` crashes and comes back from its own last checkpoint, catching up through the stream's
    /// closures since (with HISTORICAL set, as the shell's catch-up runs, §3.3), then reading as before.
    pub fn crash(&mut self, name: &str) -> SimResult<()> {
        let i = self.index(name);
        let (from, save) =
            self.clients[i].saved.clone().ok_or_else(|| err(format!("{name} kept no checkpoint")))?;
        let flags = self.clients[i].ctx.flags();
        let mut ctx = start_from(&self.protos, &save, flags)?;
        ctx.set_flags(flags.with(SimFlags::HISTORICAL, true).bits())?;
        for t in from + 1..=self.tick {
            let empty = Vec::new();
            ctx.tick(self.stream.get(&t).unwrap_or(&empty))?;
        }
        ctx.set_flags(flags.bits())?;
        let reads = self.clients[i].reads;
        let mut c = Client::new(name, ctx, reads);
        c.saved = Some((from, save));
        self.clients[i] = c;
        self.log
            .push(format!("tick {}: {name} crashed, came back from tick {from} and caught up", self.tick));
        Ok(())
    }

    /// Client `name` is re-synced from `donor`'s snapshot (11 §5.2's repair): a fresh world in its place.
    pub fn resync(&mut self, name: &str, donor: &str) -> SimResult<()> {
        let i = self.index(name);
        let snapshot = self.clients[self.index(donor)].ctx.checkpoint()?;
        let flags = self.clients[i].ctx.flags();
        let ctx = start_from(&self.protos, &snapshot, flags)?;
        let reads = self.clients[i].reads;
        self.clients[i] = Client::new(name, ctx, reads);
        self.log.push(format!("tick {}: {name} re-synced from {donor}", self.tick));
        Ok(())
    }

    /// NO_SLEEP on client `name` (D18 b inside a room: sleeping is an optimisation, never a rule).
    pub fn set_no_sleep(&mut self, name: &str, on: bool) -> SimResult<()> {
        let i = self.index(name);
        let f = self.clients[i].ctx.flags();
        let f = f.with(SimFlags::NO_SLEEP, on);
        self.clients[i].ctx.set_flags(f.bits())
    }

    /// Full-state agreement: every client's canonical state equals the first's; the first difference is named.
    pub fn agree(&self) -> Result<(), String> {
        let first = &self.clients[0];
        let a = canonical_state(&first.ctx).map_err(|e| e.to_string())?;
        for c in &self.clients[1..] {
            let b = canonical_state(&c.ctx).map_err(|e| e.to_string())?;
            if a != b {
                return Err(format!(
                    "after tick {}: {} and {} differ: {}",
                    self.tick,
                    first.name,
                    c.name,
                    diff_states(&a, &b).unwrap_or_else(|| "the states differ".to_owned())
                ));
            }
        }
        Ok(())
    }
}
