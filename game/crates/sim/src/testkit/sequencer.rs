//! The `TestSequencer` (10 §10.2, §15.3, §15.11): what the shell's `LocalSequencer` does for a scenario.
//!
//! - **Identity at send time** (C2b-r1 finding 9): [`TestSequencer::push`] assigns the action its seq when it is
//!   queued and returns it, so a scenario can name a build by creation id before the build runs.
//! - **Per-player order** (D21): a player's actions (and the system's) must be queued for nondecreasing ticks;
//!   queuing one for an earlier tick than the last is refused, as the relay refuses it, instead of being given
//!   an earlier seq that hides the violation.
//! - **Input generations** (D22): the sequencer tracks each player's input generation from the module's
//!   records (`sim_meta`) and from the releases it queues (`release_inputs`, `player_left`), and stamps every
//!   held-input action with it when it is queued. An action queued before a release but scheduled after it is
//!   therefore fenced (R23).
//! - [`TestSequencer::closure`] writes a tick's closure: its actions in send order, consecutive actions of one
//!   player in one batch (§15.3's framing).

use crate::context::SimContext;
use schema::codec::{Fixed, Writer};
use schema::{ACTION_SCHEMA_VERSION, Action, BatchFlags, BatchHeader, PLAYERS, PlayerIndex, Seq, Tick};
use std::collections::BTreeMap;

/// One queued action: its player (`None` for the system), its seq and its framed bytes' parts.
#[derive(Clone, Debug)]
struct Queued {
    player: Option<PlayerIndex>,
    seq: u32,
    ty: u16,
    payload: Vec<u8>,
}

/// A refused enqueue: an action for a tick before the stream's last, or a seq past `u32::MAX`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderError(pub String);

impl core::fmt::Display for OrderError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One stream of seqs: a player's or the system's.
#[derive(Clone, Copy, Debug, Default)]
struct Stream {
    last_seq: u32,
    last_tick: u32,
}

/// The sequencer of a scenario.
#[derive(Clone, Debug, Default)]
pub struct TestSequencer {
    players: Vec<Stream>,
    system: Stream,
    input_gen: Vec<u16>,
    /// Whether the World keeps a record of the player (a join or an action makes one; a release raises the
    /// input generation only of a player with a record, golden rule 9).
    known: Vec<bool>,
    queue: BTreeMap<u32, Vec<Queued>>,
}

impl TestSequencer {
    /// A sequencer that continues from a module's records (`sim_meta`, §15.8): each player's `last_seq` and input
    /// generation, the system's `last_system_seq`, and the module's tick (nothing is queued before it).
    pub fn new(c: &SimContext) -> Self {
        let mut s = Self {
            players: vec![Stream::default(); PLAYERS],
            input_gen: vec![0; PLAYERS],
            known: vec![false; PLAYERS],
            ..Self::default()
        };
        if let Some(w) = c.world() {
            // Nothing is queued for a tick that has run.
            let t = w.current_tick().saturating_add(1);
            s.system = Stream { last_seq: w.globals.last_system_seq.0, last_tick: t };
            for st in &mut s.players {
                st.last_tick = t;
            }
            for p in w.players.iter() {
                let i = usize::from(p.index.0);
                s.players[i].last_seq = p.last_seq.0;
                s.input_gen[i] = p.input_gen;
                s.known[i] = true;
            }
        }
        s
    }

    /// The input generation the sequencer stamps for player `i` now.
    pub fn input_gen(&self, i: PlayerIndex) -> u16 {
        self.input_gen[usize::from(i.0)]
    }

    fn enqueue(
        &mut self,
        t: u32,
        player: Option<PlayerIndex>,
        ty: u16,
        payload: Vec<u8>,
    ) -> Result<Seq, OrderError> {
        let stream = match player {
            Some(p) => &mut self.players[usize::from(p.0)],
            None => &mut self.system,
        };
        if t < stream.last_tick {
            return Err(OrderError(format!(
                "{} queued for tick {t} after one for tick {} (D21: a stream's ticks never fall)",
                player.map_or_else(|| "a system action".to_owned(), |p| format!("player {}'s action", p.0)),
                stream.last_tick
            )));
        }
        let seq =
            stream.last_seq.checked_add(1).ok_or_else(|| OrderError("the seq passes u32::MAX".to_owned()))?;
        stream.last_seq = seq;
        stream.last_tick = t;
        self.queue.entry(t).or_default().push(Queued { player, seq, ty, payload });
        Ok(Seq(seq))
    }

    /// Queues a player's action for tick `t`, held inputs stamped with the player's tracked input generation;
    /// returns its seq (a creation id's `a`).
    pub fn push(&mut self, t: u32, player: PlayerIndex, a: &Action<'_>) -> Result<Seq, OrderError> {
        let a = a.with_input_gen(self.input_gen(player));
        let mut payload = Vec::new();
        a.encode(&mut Writer::new(&mut payload))
            .map_err(|e| OrderError(format!("the action does not encode: {e}")))?;
        let seq = self.enqueue(t, Some(player), a.action_type().value(), payload)?;
        self.known[usize::from(player.0)] = true;
        Ok(seq)
    }

    /// Queues a player's action as it is, its input generation left as given (tests of fencing).
    pub fn push_as_is(&mut self, t: u32, player: PlayerIndex, a: &Action<'_>) -> Result<Seq, OrderError> {
        let mut payload = Vec::new();
        a.encode(&mut Writer::new(&mut payload))
            .map_err(|e| OrderError(format!("the action does not encode: {e}")))?;
        let seq = self.enqueue(t, Some(player), a.action_type().value(), payload)?;
        self.known[usize::from(player.0)] = true;
        Ok(seq)
    }

    /// Queues a system action for tick `t`; a release or a leave raises the player's tracked input generation.
    pub fn push_system(&mut self, t: u32, a: &Action<'_>) -> Result<Seq, OrderError> {
        let mut payload = Vec::new();
        a.encode(&mut Writer::new(&mut payload))
            .map_err(|e| OrderError(format!("the action does not encode: {e}")))?;
        let seq = self.enqueue(t, None, a.action_type().value(), payload)?;
        if let Action::ReleaseInputs(x) = a {
            self.raise(x.player);
        }
        if let Action::PlayerLeft(x) = a {
            self.raise(x.player);
        }
        if let Action::PlayerJoined(x) = a
            && usize::from(x.player.0) < PLAYERS
        {
            self.known[usize::from(x.player.0)] = true;
        }
        Ok(seq)
    }

    fn raise(&mut self, p: PlayerIndex) {
        let i = usize::from(p.0);
        if i < PLAYERS && self.known[i] {
            self.input_gen[i] = self.input_gen[i].wrapping_add(1);
        }
    }

    /// Queues raw bytes as an action (malformed and unknown actions for refusal tests).
    pub fn push_raw(
        &mut self,
        t: u32,
        player: Option<PlayerIndex>,
        ty: u16,
        payload: Vec<u8>,
    ) -> Result<Seq, OrderError> {
        let seq = self.enqueue(t, player, ty, payload)?;
        if let Some(p) = player
            && usize::from(p.0) < PLAYERS
        {
            self.known[usize::from(p.0)] = true;
        }
        Ok(seq)
    }

    /// Whether anything is queued for a tick after `t`.
    pub fn has_later(&self, t: u32) -> bool {
        self.queue.range(t + 1..).next().is_some()
    }

    /// The closure of tick `t` (empty without actions): its actions in send order, consecutive actions of one
    /// stream in one batch.
    pub fn closure(&mut self, t: u32) -> Vec<u8> {
        let Some(actions) = self.queue.remove(&t) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut i = 0;
        while i < actions.len() {
            let (player, first) = (actions[i].player, actions[i].seq);
            let n = actions[i..]
                .iter()
                .enumerate()
                .take_while(|(k, a)| a.player == player && u64::from(a.seq) == u64::from(first) + *k as u64)
                .take(usize::from(u16::MAX))
                .count();
            let mut w = Writer::new(&mut out);
            BatchHeader {
                version: ACTION_SCHEMA_VERSION,
                flags: if player.is_none() { BatchFlags::SYSTEM } else { BatchFlags::EMPTY },
                player: player.unwrap_or(PlayerIndex(0xFFFF)),
                tick: Tick(t),
                first_seq: Seq(first),
                count: n as u16,
            }
            .write(&mut w, "BatchHeader")
            .expect("a batch header encodes");
            for a in &actions[i..i + n] {
                w.u16(a.ty);
                w.u16(a.payload.len() as u16);
                w.bytes(&a.payload);
            }
            i += n;
        }
        out
    }
}
