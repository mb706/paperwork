//! What the module remembers for its outputs (10 §3.6 `PresentationState`): never saved, never hashed, never
//! read by a rule. C2a holds the event queue the tick writes through (§15.6); extraction, subscriptions and
//! queries join it in C2c.

use schema::codec::{EResult, Writer};
use schema::events::{
    EVENT_QUEUE_MAX_BYTES, EVENT_QUEUE_MAX_EVENTS, EventFlags, EventHeader, EventPayload, write_event,
};
use schema::{PlayerIndex, Seq, Tick};
use std::collections::VecDeque;

/// The event queue (§15.6): events accumulate from the tick that produced them until an extraction drains
/// them, at most `EVENT_QUEUE_MAX_EVENTS` events or `EVENT_QUEUE_MAX_BYTES` of records; on overflow the
/// oldest are dropped and the next drain reports it (the packet's `EVENTS_DROPPED`). Events made while the
/// `HISTORICAL` flag is set carry it (catch-up and replay: no sound, no flying text, S10, D15).
#[derive(Clone, Debug, Default)]
pub struct EventSink {
    /// The records, back to back, from `head` on.
    bytes: Vec<u8>,
    head: usize,
    /// Each queued record's length, oldest first.
    lens: VecDeque<u32>,
    dropped: bool,
    pub historical: bool,
    scratch: Vec<u8>,
}

impl EventSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queues one event of tick `tick`, answering `(player, seq)` (seq 0: no action), on surface 0.
    pub fn push(&mut self, tick: Tick, seq: Seq, player: PlayerIndex, payload: &EventPayload) -> EResult {
        let header = EventHeader {
            r#type: payload.event_type(),
            len: 0,
            tick,
            seq,
            player,
            flags: if self.historical { EventFlags::HISTORICAL } else { EventFlags::EMPTY },
            surface: 0,
        };
        self.scratch.clear();
        write_event(&mut Writer::new(&mut self.scratch), &header, payload)?;
        self.bytes.extend_from_slice(&self.scratch);
        self.lens.push_back(self.scratch.len() as u32);
        while self.lens.len() > EVENT_QUEUE_MAX_EVENTS || self.bytes.len() - self.head > EVENT_QUEUE_MAX_BYTES
        {
            let n = self.lens.pop_front().unwrap_or(0) as usize;
            self.head += n;
            self.dropped = true;
        }
        if self.head > EVENT_QUEUE_MAX_BYTES {
            self.bytes.drain(..self.head);
            self.head = 0;
        }
        Ok(())
    }

    /// The number of queued events.
    pub fn len(&self) -> usize {
        self.lens.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lens.is_empty()
    }

    /// Appends the queued records to `out` without taking them; returns how many there are and whether any were
    /// dropped since the queue last emptied (extraction stages a packet before it is delivered, §15.4).
    pub fn peek(&self, out: &mut Vec<u8>) -> (usize, bool) {
        out.extend_from_slice(&self.bytes[self.head..]);
        (self.lens.len(), self.dropped)
    }

    /// Empties the queue (a packet carrying it was delivered).
    pub fn clear(&mut self) {
        self.bytes.clear();
        self.head = 0;
        self.lens.clear();
        self.dropped = false;
    }

    /// Appends the queued records to `out` and empties the queue; returns how many there were and whether
    /// any were dropped since the last drain.
    pub fn drain(&mut self, out: &mut Vec<u8>) -> (usize, bool) {
        out.extend_from_slice(&self.bytes[self.head..]);
        let n = self.lens.len();
        let dropped = self.dropped;
        self.bytes.clear();
        self.head = 0;
        self.lens.clear();
        self.dropped = false;
        (n, dropped)
    }
}

/// The module's presentation state (§3.6): never saved, never hashed, never read by a rule.
/// - the event queue, which the tick writes and extraction drains;
/// - each character's displacement in its last update (MOVERS' velocity, §15.4), which the tick writes;
/// - the extraction state: the held set, the sent versions, the subscriptions (extract.rs);
/// - the query continuations (query.rs);
/// - the last tick's per-phase times (`PROFILE`).
#[derive(Clone, Debug, Default)]
pub struct PresentationState {
    pub events: EventSink,
    pub moves: [crate::rules::Move; schema::PLAYERS],
    pub extract: crate::extract::Extractor,
    pub queries: crate::query::Queries,
    /// The last tick's µs per phase, with `PROFILE` and a host clock (§10.6; `DEBUG.phase_us`).
    pub phase_us: Option<[f32; crate::tick::PHASES]>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use schema::events::{ActionFailedEvent, read_event};
    use schema::{FailReason, FinePos, Serial};

    fn failed(i: u32) -> EventPayload {
        EventPayload::ActionFailed(ActionFailedEvent {
            reason: FailReason::TargetGone,
            pos: FinePos { x: i as i32, y: 0 },
            serial: Serial(i),
        })
    }

    #[test]
    fn queues_drains_and_drops_the_oldest() {
        let mut s = EventSink::new();
        s.push(Tick(1), Seq(1), PlayerIndex(0), &failed(1)).expect("encodes");
        s.historical = true;
        s.push(Tick(1), Seq(2), PlayerIndex(0), &failed(2)).expect("encodes");
        let mut out = Vec::new();
        assert_eq!(s.drain(&mut out), (2, false));
        let mut r = schema::codec::Reader::new(&out);
        let (h1, _) = read_event(&mut r).expect("a record");
        let (h2, _) = read_event(&mut r).expect("a record");
        assert_eq!((h1.flags, h2.flags), (EventFlags::EMPTY, EventFlags::HISTORICAL));
        assert!(r.is_empty());
        for i in 0..(EVENT_QUEUE_MAX_EVENTS as u32 + 5) {
            s.push(Tick(2), Seq(i), PlayerIndex(0), &failed(i)).expect("encodes");
        }
        assert_eq!(s.len(), EVENT_QUEUE_MAX_EVENTS);
        out.clear();
        let (n, dropped) = s.drain(&mut out);
        assert_eq!((n, dropped), (EVENT_QUEUE_MAX_EVENTS, true));
        let (h, _) = read_event(&mut schema::codec::Reader::new(&out)).expect("a record");
        assert_eq!(h.seq, Seq(5), "the five oldest were dropped");
    }
}
