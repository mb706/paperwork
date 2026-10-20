//! Queries (10 §15.5): one-off, read-only, never delaying a tick. `sim_query` starts one (at most 4 run at once,
//! else `ERR_LIMIT`); `sim_query_step(units)` advances the running ones in arrival order and returns those that
//! finished; `sim_query_cancel` drops one (an unknown id is ignored). Every M0 query is one unit of work, so
//! `units` queries finish per step: the golden traces pin 0 units (none) and 0xFFFFFFFF (all), which every cost
//! model agrees on (golden README rule 44). A result's first tick is the tick it started in, its last the tick it
//! finished in; an unsupported kind finishes with ok 0 and reason 1. M0's kinds (dev builds): `inspect` (every
//! saved field of one entity, rule 36), `hash` and `digest`.

use crate::digest::{container_row, entity_row};
use crate::r#gen::{ContainerPool, EntityTable};
use crate::save::state_hash;
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

#[derive(Clone, Debug, PartialEq, Eq)]
struct Query {
    id: u32,
    kind: QueryKind,
    flags: u16,
    /// The parameters, or `None` when they are longer than any M0 kind takes ([`PARAMS_KEPT`]): such a query
    /// finishes with reason 2 without its bytes being kept.
    params: Option<Vec<u8>>,
    first: u32,
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
        self.running.push(Query { id, kind, flags, params, first: tick });
        Ok(())
    }

    /// `sim_query_cancel`: drops the query; an unknown id is ignored.
    pub fn cancel(&mut self, id: u32) {
        self.running.retain(|q| q.id != id);
    }

    pub fn running(&self) -> usize {
        self.running.len()
    }

    /// `sim_query_step(units)`: finishes up to `units` queries in arrival order and writes `QueryStepOutput`.
    pub fn step(&mut self, w: &World, units: u32, d: u64, r: u64, out: &mut Vec<u8>) -> SimResult<()> {
        let n = (units as usize).min(self.running.len());
        let done: Vec<Finished> = self
            .running
            .drain(..n)
            .map(|q| match run(w, &q, d, r) {
                Ok(body) => Finished { id: q.id, ok: true, first: q.first, body },
                Err(reason) => Finished {
                    id: q.id,
                    ok: false,
                    first: q.first,
                    body: reason.value().to_le_bytes().to_vec(),
                },
            })
            .collect();
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

/// Runs one query to completion: its record, or the reason it failed.
fn run(w: &World, q: &Query, d: u64, r: u64) -> Result<Vec<u8>, UiInvalidReason> {
    if !query_supported(q.kind) {
        return Err(UiInvalidReason::Unsupported);
    }
    let Some(params) = q.params.as_deref() else {
        return Err(UiInvalidReason::BadParameters);
    };
    if q.flags != 0 {
        return Err(UiInvalidReason::BadParameters);
    }
    let mut out = Vec::new();
    let enc = |e: schema::codec::EncodeError| panic!("a query record does not encode: {e}");
    match q.kind {
        QueryKind::Hash => {
            if !params.is_empty() {
                return Err(UiInvalidReason::BadParameters);
            }
            let h = state_hash(w).unwrap_or_else(|e| panic!("the state hashes: {e}"));
            let list: Vec<SectionHash> =
                h.sections.iter().map(|&(section, hash)| SectionHash { section, hash }).collect();
            StateHash { hash: h.full, sections: List::from_slice(&list) }
                .encode(&mut Writer::new(&mut out))
                .unwrap_or_else(enc);
        }
        QueryKind::Digest => {
            if !params.is_empty() {
                return Err(UiInvalidReason::BadParameters);
            }
            use schema::codec::Fixed;
            DigestResult { tick: Tick(w.current_tick()), d, r }
                .write(&mut Writer::new(&mut out), "DigestResult")
                .unwrap_or_else(enc);
        }
        QueryKind::Inspect => {
            let Ok(b) = <[u8; 4]>::try_from(params) else {
                return Err(UiInvalidReason::BadParameters);
            };
            inspect(w, u32::from_le_bytes(b), &mut out);
        }
        QueryKind::Rates
        | QueryKind::MapSearch
        | QueryKind::TotalRaw
        | QueryKind::WhereMade
        | QueryKind::PatchInfo => {
            return Err(UiInvalidReason::Unsupported);
        }
    }
    Ok(out)
}

/// `inspect` (§3.5, §15.5; rule 36): the entity-table row's saved columns, then the pool row's, each with its type
/// code and its value's little-endian bytes (a handle as the serial); a serial that is no entity is not found.
fn inspect(w: &World, serial: u32, out: &mut Vec<u8>) {
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
        .unwrap_or_else(|e| panic!("an inspect record does not encode: {e}"));
}
