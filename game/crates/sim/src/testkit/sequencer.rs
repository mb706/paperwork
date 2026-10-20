//! The `TestSequencer` (10 §10.2, §15.3, §15.11): what the shell's `LocalSequencer` does for a scenario. It
//! queues actions for ticks, assigns each player's seqs in tick order above the module's watermarks, groups a
//! tick's consecutive actions of one player into a batch, and writes the closure of a tick (§15.3's framing).
//! Held-input actions are stamped with an input generation when they are queued (D22): a scenario that queues
//! an action for a later tick and releases the player's inputs in between gets it fenced, as R23 requires.

use crate::context::SimContext;
use schema::codec::{Fixed, Writer};
use schema::{ACTION_SCHEMA_VERSION, Action, BatchFlags, BatchHeader, PLAYERS, PlayerIndex, Seq, Tick};
use std::collections::BTreeMap;

/// One queued action: its player (`None` for the system) and its framed bytes' parts.
#[derive(Clone, Debug)]
struct Queued {
    player: Option<PlayerIndex>,
    ty: u16,
    payload: Vec<u8>,
}

/// The sequencer of a scenario.
#[derive(Clone, Debug, Default)]
pub struct TestSequencer {
    watermarks: Vec<u32>,
    system_seq: u32,
    queue: BTreeMap<u32, Vec<Queued>>,
}

impl TestSequencer {
    /// A sequencer that continues from a module's watermarks (`sim_meta`, §15.8): each player's `last_seq`
    /// and the system's.
    pub fn new(c: &SimContext) -> Self {
        let mut s = Self { watermarks: vec![0; PLAYERS], ..Self::default() };
        if let Some(w) = c.world() {
            s.watermarks.copy_from_slice(&w.players.last_seqs());
            s.system_seq = w.globals.last_system_seq.0;
        }
        s
    }

    /// Queues a player's action for tick `t`.
    pub fn push(&mut self, t: u32, player: PlayerIndex, a: &Action<'_>) {
        let mut payload = Vec::new();
        a.encode(&mut Writer::new(&mut payload)).expect("a valid action encodes");
        self.push_raw(t, Some(player), a.action_type().value(), payload);
    }

    /// Queues a system action for tick `t`.
    pub fn push_system(&mut self, t: u32, a: &Action<'_>) {
        let mut payload = Vec::new();
        a.encode(&mut Writer::new(&mut payload)).expect("a valid action encodes");
        self.push_raw(t, None, a.action_type().value(), payload);
    }

    /// Queues raw bytes as an action (malformed and unknown actions for refusal tests).
    pub fn push_raw(&mut self, t: u32, player: Option<PlayerIndex>, ty: u16, payload: Vec<u8>) {
        self.queue.entry(t).or_default().push(Queued { player, ty, payload });
    }

    /// Whether anything is queued for a tick after `t`.
    pub fn has_later(&self, t: u32) -> bool {
        self.queue.range(t + 1..).next().is_some()
    }

    /// The closure of tick `t` (empty without actions), its seqs above the watermarks.
    pub fn closure(&mut self, t: u32) -> Vec<u8> {
        let Some(actions) = self.queue.remove(&t) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut i = 0;
        while i < actions.len() {
            let player = actions[i].player;
            let n =
                actions[i..].iter().take_while(|a| a.player == player).take(usize::from(u16::MAX)).count();
            let mark = match player {
                Some(p) => &mut self.watermarks[usize::from(p.0)],
                None => &mut self.system_seq,
            };
            let first = *mark + 1;
            *mark += n as u32;
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
