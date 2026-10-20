//! Queries (10 §15.5): one-off, read-only, never delaying a tick. `sim_query` starts one (at most 4 run at once,
//! else `ERR_LIMIT`); `sim_query_step(units)` advances the running ones in arrival order and returns those that
//! finished; `sim_query_cancel` drops one (an unknown id is ignored). A result's first tick is the tick it started
//! in, its last the tick it finished in; an unsupported kind finishes with ok 0 and reason 1. M0's kinds (dev
//! builds): `inspect` (every saved field of one entity, rule 36), `hash` and `digest`.
//!
//! **The cost model** (golden README rule 44 leaves it open; C2c-r1 finding 2): a unit is about [`UNIT_BYTES`]
//! bytes of work, so one unit is bounded whatever the World's size. `hash` is a [`HashJob`] continuation that
//! encodes and hashes the canonical state a piece at a time; `inspect` and `digest` are one unit each, and a
//! refused query one unit. `units` 0 does nothing; 0xFFFFFFFF finishes everything (the golden traces pin both).
//! The shell turns its 2 ms into units by its own measurements (src/simworker/queries.ts).

use crate::digest::{container_row, entity_row};
use crate::r#gen::{ContainerPool, EntityTable};
use crate::hashjob::HashJob;
use crate::world::World;
use crate::{SimError, SimResult};
use schema::codec::{List, MsgList, Packed, Writer};
use schema::projections::{
    DigestResult, InspectField, InspectResult, QUERIES_RUNNING, QueryKind, StateHash, UiInvalidReason,
};
use schema::{
    QueryId, QueryResult, QueryResultFlags, SaveSection, SectionHash, Serial, SimStatus, Tick,
    query_supported,
};

/// One unit of query work: about this many bytes of state read, encoded and hashed.
pub const UNIT_BYTES: u64 = 1024;

#[derive(Clone, Debug)]
struct Query {
    id: u32,
    kind: QueryKind,
    flags: u16,
    /// The parameters, or `None` when they are longer than any M0 kind takes ([`PARAMS_KEPT`]): such a query
    /// finishes with reason 2 without its bytes being kept.
    params: Option<Vec<u8>>,
    first: u32,
    /// A `hash` query's continuation.
    job: Option<HashJob>,
}

/// The longest parameters a query keeps: M0's kinds take at most 4 bytes (`inspect`'s serial).
pub const PARAMS_KEPT: usize = 64;

/// The query continuations of `PresentationState` (§3.6).
#[derive(Clone, Debug, Default)]
pub struct Queries {
    running: Vec<Query>,
}

/// One finished query.
struct Finished {
    id: u32,
    ok: bool,
    first: u32,
    body: Vec<u8>,
}

impl Queries {
    pub fn new() -> Self {
        Self::default()
    }

    /// `sim_query`: starts a query at tick `tick`; `ERR_LIMIT` with 4 running.
    pub fn start(&mut self, id: u32, kind: QueryKind, flags: u16, params: &[u8], tick: u32) -> SimResult<()> {
        if self.running.len() >= QUERIES_RUNNING {
            return Err(SimError::new(SimStatus::ErrLimit, format!("{QUERIES_RUNNING} queries are running")));
        }
        let params = (params.len() <= PARAMS_KEPT).then(|| params.to_vec());
        self.running.push(Query { id, kind, flags, params, first: tick, job: None });
        Ok(())
    }

    /// `sim_query_cancel`: drops the query; an unknown id is ignored.
    pub fn cancel(&mut self, id: u32) {
        self.running.retain(|q| q.id != id);
    }

    pub fn running(&self) -> usize {
        self.running.len()
    }

    /// `sim_query_step(units)`: works on the running queries in arrival order for at most `units` units and
    /// writes `QueryStepOutput` with those that finished.
    pub fn step(&mut self, w: &World, units: u32, d: u64, r: u64, out: &mut Vec<u8>) -> SimResult<()> {
        let mut budget = u64::from(units).saturating_mul(UNIT_BYTES);
        let mut done: Vec<Finished> = Vec::new();
        while budget > 0 && !self.running.is_empty() {
            let q = &mut self.running[0];
            let Some(answer) = advance(w, q, d, r, &mut budget) else { break };
            let q = self.running.remove(0);
            done.push(match answer {
                Ok(body) => Finished { id: q.id, ok: true, first: q.first, body },
                Err(reason) => Finished {
                    id: q.id,
                    ok: false,
                    first: q.first,
                    body: reason.value().to_le_bytes().to_vec(),
                },
            });
        }
        let tick = Tick(w.current_tick());
        let results: Vec<QueryResult<'_>> = done
            .iter()
            .map(|f| QueryResult {
                id: QueryId(f.id),
                ok: f.ok,
                flags: QueryResultFlags::EMPTY,
                first_tick: Tick(f.first),
                last_tick: tick,
                body: &f.body,
            })
            .collect();
        schema::QueryStepOutput { results: MsgList::from_slice(&results) }
            .encode(&mut Writer::new(out))
            .map_err(|e| SimError::new(SimStatus::ErrOrder, format!("a query result does not encode: {e}")))
    }
}

/// Advances one query within `budget` (decremented): its record or the reason it failed once it finishes.
fn advance(
    w: &World,
    q: &mut Query,
    d: u64,
    r: u64,
    budget: &mut u64,
) -> Option<Result<Vec<u8>, UiInvalidReason>> {
    let checked = (|| {
        if !query_supported(q.kind) {
            return Err(UiInvalidReason::Unsupported);
        }
        let params = q.params.as_deref().ok_or(UiInvalidReason::BadParameters)?;
        if q.flags != 0 {
            return Err(UiInvalidReason::BadParameters);
        }
        Ok(params)
    })();
    let params = match checked {
        Ok(p) => p,
        Err(reason) => {
            *budget = budget.saturating_sub(UNIT_BYTES);
            return Some(Err(reason));
        }
    };
    let mut out = Vec::new();
    match q.kind {
        QueryKind::Hash => {
            if !params.is_empty() {
                *budget = budget.saturating_sub(UNIT_BYTES);
                return Some(Err(UiInvalidReason::BadParameters));
            }
            let job = q.job.get_or_insert_with(HashJob::new);
            // A state that does not encode cannot be hashed (as `sim_state_hash` refuses it): reason 2.
            let h = match job.step(w, budget) {
                Ok(Some(h)) => h,
                Ok(None) => return None,
                Err(_) => return Some(Err(UiInvalidReason::BadParameters)),
            };
            let list: Vec<SectionHash> =
                h.sections.iter().map(|&(section, hash)| SectionHash { section, hash }).collect();
            let rec = StateHash { hash: h.full, sections: List::from_slice(&list) };
            if rec.encode(&mut Writer::new(&mut out)).is_err() {
                return Some(Err(UiInvalidReason::OverLimit));
            }
        }
        QueryKind::Digest => {
            *budget = budget.saturating_sub(UNIT_BYTES);
            if !params.is_empty() {
                return Some(Err(UiInvalidReason::BadParameters));
            }
            use schema::codec::Fixed;
            let rec = DigestResult { tick: Tick(w.current_tick()), d, r };
            if rec.write(&mut Writer::new(&mut out), "DigestResult").is_err() {
                return Some(Err(UiInvalidReason::OverLimit));
            }
        }
        QueryKind::Inspect => {
            *budget = budget.saturating_sub(UNIT_BYTES);
            let Ok(b) = <[u8; 4]>::try_from(params) else {
                return Some(Err(UiInvalidReason::BadParameters));
            };
            if !inspect(w, u32::from_le_bytes(b), &mut out) {
                return Some(Err(UiInvalidReason::OverLimit));
            }
        }
        QueryKind::Rates
        | QueryKind::MapSearch
        | QueryKind::TotalRaw
        | QueryKind::WhereMade
        | QueryKind::PatchInfo => {
            *budget = budget.saturating_sub(UNIT_BYTES);
            return Some(Err(UiInvalidReason::Unsupported));
        }
    }
    Some(Ok(out))
}

/// `inspect` (§3.5, §15.5; rule 36): the entity-table row's saved columns, then the pool row's, each with its type
/// code and its value's little-endian bytes (a handle as the serial); a serial that is no entity is not found.
/// `false` when the record does not encode.
fn inspect(w: &World, serial: u32, out: &mut Vec<u8>) -> bool {
    let row = (serial != 0).then(|| w.entity(Serial(serial))).flatten().map(crate::handle::slot);
    let mut erow = Vec::new();
    let mut crow = Vec::new();
    let mut fields: Vec<InspectField<'_>> = Vec::new();
    if let Some(row) = row {
        entity_row(&w.entities, row as usize, &mut erow);
        container_row(w, w.entities.pool_slot[row as usize] as usize, &mut crow);
    }
    if row.is_some() {
        let mut at = 4; // after the row index
        for (name, code, width) in EntityTable::SAVED_COLUMNS {
            fields.push(InspectField {
                section: SaveSection::EntityTable.value(),
                r#type: schema::TypeCode::from_value(code).expect("a type code"),
                name,
                value: &erow[at..at + width],
            });
            at += width;
        }
        let mut at = 4;
        for (name, code, width) in ContainerPool::SAVED_COLUMNS {
            fields.push(InspectField {
                section: SaveSection::PoolContainer.value(),
                r#type: schema::TypeCode::from_value(code).expect("a type code"),
                name,
                value: &crow[at..at + width],
            });
            at += width;
        }
    }
    InspectResult { serial: Serial(serial), found: row.is_some(), fields: MsgList::from_slice(&fields) }
        .encode(&mut Writer::new(out))
        .is_ok()
}
