//! A resumable full state hash (10 §4.8; §15.5's `hash` query; C2c-r1 finding 2). The canonical bytes of every
//! hashed section are produced and hashed in pieces of about the budget a query step grants, so one unit of query
//! work stays bounded whatever the state's size: a record, a block of column rows or slots at a time, never a
//! whole section. The bytes are exactly `save::encode_section`'s (tests compare them on many worlds), so a job
//! that runs within one tick gives `save::state_hash`'s value.
//!
//! The full hash prefixes each section with its length, so a section whose length is not a closed formula of
//! the World's sizes (GLOBALS, RNG, PLAYERS, CHUNKS, STATS) is first measured, piece by piece, then hashed. A job
//! that spans ticks reads the World as each piece finds it (§15.5: "a query that spans ticks reads the world as
//! each slice finds it"); its result names its first and last tick.

use crate::r#gen::{ContainerPool, EntityTable};
use crate::hash::Xxh64;
use crate::save::{SAVED_SECTIONS, StateHashes, encode_section};
use crate::world::World;
use schema::codec::{EncodeError, Fixed, Writer};
use schema::{SaveSection, Slot};

/// The rows of one column, slots or list records a piece writes at most at once, so a piece is bounded too.
const PIECE_ITEMS: usize = 4096;

/// Where a section's writer stands.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Cursor {
    stage: u8,
    i: usize,
    j: usize,
    /// Bytes of the section written so far (the column tables pad to 8 from the section's start).
    pos: usize,
}

/// A full state hash in progress.
#[derive(Clone, Debug, Default)]
pub struct HashJob {
    /// The section being worked on, as an index into `SAVED_SECTIONS`.
    sec: usize,
    /// Measuring the section's length (true) or hashing it.
    measuring: bool,
    started: bool,
    cursor: Cursor,
    len: u64,
    full: Xxh64,
    part: Xxh64,
    sections: Vec<(u32, u64)>,
    buf: Vec<u8>,
}

/// The encoded size of one record of a fixed-size list (its first; every record of these lists has the same).
fn record_len(encode: impl FnOnce(&mut Writer<'_>) -> Result<(), EncodeError>) -> Result<usize, EncodeError> {
    let mut b = Vec::new();
    encode(&mut Writer::new(&mut b))?;
    Ok(b.len())
}

/// A column table's directory: `u32` rows, `u16` columns, `u16` 0, then per column `u8` name length, the name,
/// `u8` type code, `u8` 0, `u32` offset and `u32` byte length, padded to 8 (crates/sim/src/gen/pools.rs `save`).
fn column_header(cols: &[(&'static str, u8, usize)], rows: usize, out: &mut Vec<u8>) -> usize {
    let mut w = Writer::new(out);
    w.u32(rows as u32);
    w.u16(cols.len() as u16);
    w.u16(0);
    let mut dir = 8usize;
    for (n, _, _) in cols {
        dir += 1 + n.len() + 1 + 1 + 4 + 4;
    }
    let mut at = dir;
    for &(n, code, width) in cols {
        at = at.next_multiple_of(8);
        w.u8(n.len() as u8);
        w.bytes(n.as_bytes());
        w.u8(code);
        w.u8(0);
        w.u32(at as u32);
        w.u32((rows * width) as u32);
        at += rows * width;
    }
    dir
}

/// A column table's whole length: the directory, then each column at an 8-byte boundary, then the final pad.
fn column_table_len(cols: &[(&'static str, u8, usize)], rows: usize) -> u64 {
    let mut dir = 8usize;
    for (n, _, _) in cols {
        dir += 1 + n.len() + 1 + 1 + 4 + 4;
    }
    let mut at = dir;
    for &(_, _, width) in cols {
        at = at.next_multiple_of(8) + rows * width;
    }
    at as u64
}

/// Rows `a..b` of entity-table column `k`, as `EntityTable::save` writes them.
fn entity_column(
    t: &EntityTable,
    k: usize,
    a: usize,
    b: usize,
    out: &mut Vec<u8>,
) -> Result<(), EncodeError> {
    fn put<T: Fixed>(v: &[T], out: &mut Vec<u8>) -> Result<(), EncodeError> {
        let mut w = Writer::new(out);
        for x in v {
            x.write(&mut w, "entity_table")?;
        }
        Ok(())
    }
    match EntityTable::SAVED_COLUMNS[k].0 {
        "proto" => put(&t.proto[a..b], out),
        "kind" => put(&t.kind[a..b], out),
        "surface" => put(&t.surface[a..b], out),
        "dir" => put(&t.dir[a..b], out),
        "flip" => put(&t.flip[a..b], out),
        "quality" => put(&t.quality[a..b], out),
        "built_by" => put(&t.built_by[a..b], out),
        "x2" => put(&t.x2[a..b], out),
        "y2" => put(&t.y2[a..b], out),
        "pool_slot" => put(&t.pool_slot[a..b], out),
        "flags" => put(&t.flags[a..b], out),
        "serial" => put(&t.serial[a..b], out),
        "gen" => put(&t.r#gen[a..b], out),
        "built_tick" => put(&t.built_tick[a..b], out),
        other => panic!("entity_table column {other} has no streaming encoding (hashjob.rs)"),
    }
}

/// Rows `a..b` of container-pool column `k`, as `ContainerPool::save` writes them (the entity as its serial).
fn container_column(w: &World, k: usize, a: usize, b: usize, out: &mut Vec<u8>) -> Result<(), EncodeError> {
    let mut wr = Writer::new(out);
    match ContainerPool::SAVED_COLUMNS[k].0 {
        "entity" => {
            for &h in &w.containers.entity[a..b] {
                wr.u32(w.serial_of(h).0);
            }
        }
        "inv" => {
            for x in &w.containers.inv[a..b] {
                x.write(&mut wr, "container.inv")?;
            }
        }
        other => panic!("container column {other} has no streaming encoding (hashjob.rs)"),
    }
    Ok(())
}

/// The length of section `s` when it is a closed formula of the World's sizes.
fn known_len(w: &World, s: SaveSection) -> Result<Option<u64>, EncodeError> {
    Ok(Some(match s {
        SaveSection::EntityTable => column_table_len(&EntityTable::SAVED_COLUMNS, w.entities.serial.len()),
        SaveSection::PoolContainer => {
            column_table_len(&ContainerPool::SAVED_COLUMNS, w.containers.entity.len())
        }
        SaveSection::SlotHeap => slot_heap_len(w),
        SaveSection::Generated => {
            let g = w.chunks.generated();
            let one = match g.first() {
                Some(x) => record_len(|wr| x.encode(wr))?,
                None => 0,
            };
            4 + (g.len() * one) as u64
        }
        SaveSection::Timers => {
            let t = w.timers();
            let one = match t.iter().next() {
                Some(k) => record_len(|wr| World::timer_record(k).encode(wr))?,
                None => 0,
            };
            4 + (t.len() * one) as u64
        }
        SaveSection::WorldgenPending => {
            let p = w.pending();
            let one = match p.iter().next() {
                Some(k) => record_len(|wr| World::pending_record(k).encode(wr))?,
                None => 0,
            };
            4 + (p.len() * one) as u64
        }
        SaveSection::Globals
        | SaveSection::Rng
        | SaveSection::Players
        | SaveSection::Chunks
        | SaveSection::Stats
        | SaveSection::Cold
        | SaveSection::Charted
        | SaveSection::Thermal
        | SaveSection::Networks
        | SaveSection::Research
        | SaveSection::Blueprints
        | SaveSection::Undo
        | SaveSection::ClosureLog
        | SaveSection::Thumbnail => return Ok(None),
    }))
}

/// One arena record's length in `SLOT_HEAP` (crates/sim/src/gen/state.rs `SlotArena::encode`): `u32` length,
/// then `(u16 id, u32 length, value)` for class (u8), block_slots (u16), blocks (u32) and the slots list.
fn arena_len(slots: usize) -> usize {
    4 + (6 + 1) + (6 + 2) + (6 + 4) + (6 + 4 + slots * Slot::SIZE)
}

/// `SLOT_HEAP`'s length: `u32` count 1, then the record (`u32` length, the arenas, filters and bars fields).
fn slot_heap_len(w: &World) -> u64 {
    let arenas: usize = w.heap.classes().map(|(_, n, blocks)| arena_len(n as usize * blocks as usize)).sum();
    let f1 = 4 + arenas;
    let f2 = 4 + w.heap.all_filters().len() * crate::r#gen::SlotFilter::SIZE;
    let f3 = 4 + w.heap.all_bars().len() * crate::r#gen::InvBar::SIZE;
    (4 + 4 + (6 + f1) + (6 + f2) + (6 + f3)) as u64
}

/// Appends about `want` bytes of section `s` (at least one record, row block or slot block) at `c`; `true`
/// once the section is complete.
fn piece(
    w: &World,
    s: SaveSection,
    c: &mut Cursor,
    want: usize,
    out: &mut Vec<u8>,
) -> Result<bool, EncodeError> {
    let start = out.len();
    let done = match s {
        SaveSection::Globals | SaveSection::Rng => {
            encode_section(w, s, out)?;
            true
        }
        SaveSection::Players => list(c, w.players.len(), want, start, out, |i, wr| {
            w.players.iter().nth(i).map_or(Ok(()), |p| p.encode(wr))
        })?,
        SaveSection::Chunks => list(c, w.chunks.modified_count(), want, start, out, |i, wr| {
            if i < w.chunks.modified_count() { w.chunks.modified_at(i).rec.encode(wr) } else { Ok(()) }
        })?,
        SaveSection::Stats => list(c, w.stats().len(), want, start, out, |i, wr| {
            w.stats().get(i).map_or(Ok(()), |x| x.encode(wr))
        })?,
        SaveSection::Generated => list(c, w.chunks.generated().len(), want, start, out, |i, wr| {
            w.chunks.generated().get(i).map_or(Ok(()), |x| x.encode(wr))
        })?,
        SaveSection::Timers => {
            sorted_list(c, w.timers(), want, start, out, |k, wr| World::timer_record(k).encode(wr))?
        }
        SaveSection::WorldgenPending => {
            sorted_list(c, w.pending(), want, start, out, |k, wr| World::pending_record(k).encode(wr))?
        }
        SaveSection::EntityTable => {
            let t = &w.entities;
            if c.stage == 0 && t.first_noncanonical().is_some() {
                // `encode_section` refuses a table that is not canonical (§4.5); so does the job.
                return encode_section(w, s, &mut Vec::new()).map(|()| true);
            }
            columns(c, &EntityTable::SAVED_COLUMNS, t.serial.len(), want, start, out, |k, a, b, o| {
                entity_column(t, k, a, b, o)
            })?
        }
        SaveSection::PoolContainer => {
            if c.stage == 0 && w.containers.first_noncanonical().is_some() {
                return encode_section(w, s, &mut Vec::new()).map(|()| true);
            }
            columns(
                c,
                &ContainerPool::SAVED_COLUMNS,
                w.containers.entity.len(),
                want,
                start,
                out,
                |k, a, b, o| container_column(w, k, a, b, o),
            )?
        }
        SaveSection::SlotHeap => slot_heap(w, c, want, start, out)?,
        SaveSection::Cold
        | SaveSection::Charted
        | SaveSection::Thermal
        | SaveSection::Networks
        | SaveSection::Research
        | SaveSection::Blueprints
        | SaveSection::Undo
        | SaveSection::ClosureLog
        | SaveSection::Thumbnail => {
            encode_section(w, s, out)?;
            true
        }
    };
    c.pos += out.len() - start;
    Ok(done)
}

/// A `u32` count, then `n` records by index.
fn list(
    c: &mut Cursor,
    n: usize,
    want: usize,
    start: usize,
    out: &mut Vec<u8>,
    mut record: impl FnMut(usize, &mut Writer<'_>) -> Result<(), EncodeError>,
) -> Result<bool, EncodeError> {
    if c.stage == 0 {
        Writer::new(out).u32(n as u32);
        c.stage = 1;
    }
    let mut k = 0;
    while c.i < n && (k == 0 || (out.len() - start < want && k < PIECE_ITEMS)) {
        record(c.i, &mut Writer::new(out))?;
        c.i += 1;
        k += 1;
    }
    Ok(c.i >= n)
}

/// A `u32` count, then the items of a sorted list from position `c.i` on.
fn sorted_list<T: Ord + Copy>(
    c: &mut Cursor,
    items: &crate::index::BlockList<T>,
    want: usize,
    start: usize,
    out: &mut Vec<u8>,
    mut record: impl FnMut(&T, &mut Writer<'_>) -> Result<(), EncodeError>,
) -> Result<bool, EncodeError> {
    if c.stage == 0 {
        Writer::new(out).u32(items.len() as u32);
        c.stage = 1;
    }
    for (k, x) in items.iter_from(c.i).enumerate() {
        if k > 0 && (out.len() - start >= want || k >= PIECE_ITEMS) {
            break;
        }
        record(x, &mut Writer::new(out))?;
        c.i += 1;
    }
    Ok(c.i >= items.len())
}

/// A column table: its directory (stage 0), then each column `c.j` from an 8-byte boundary (stage 1 pads,
/// stage 2 writes its rows from `c.i` on). There is no pad after the last column, as `save` writes it.
fn columns(
    c: &mut Cursor,
    cols: &[(&'static str, u8, usize)],
    rows: usize,
    want: usize,
    start: usize,
    out: &mut Vec<u8>,
    mut column: impl FnMut(usize, usize, usize, &mut Vec<u8>) -> Result<(), EncodeError>,
) -> Result<bool, EncodeError> {
    let at = |c: &Cursor, out: &Vec<u8>| c.pos + (out.len() - start);
    if c.stage == 0 {
        column_header(cols, rows, out);
        c.stage = 1;
        c.j = 0;
        c.i = 0;
    }
    while c.j < cols.len() {
        if c.stage == 1 {
            while at(c, out) % 8 != 0 {
                out.push(0);
            }
            c.stage = 2;
        }
        let width = cols[c.j].2.max(1);
        if c.i < rows {
            let room = (want.saturating_sub(out.len() - start) / width).clamp(1, PIECE_ITEMS);
            let b = rows.min(c.i + room);
            column(c.j, c.i, b, out)?;
            c.i = b;
        }
        if c.i >= rows {
            c.j += 1;
            c.i = 0;
            c.stage = 1;
        }
        if out.len() - start >= want {
            break;
        }
    }
    Ok(c.j >= cols.len())
}

/// `SLOT_HEAP` (crates/sim/src/gen/state.rs `SlotHeap::encode` and `SlotArena::encode`), streamed: stage 0 the
/// section count, the record's length and the arenas field's header; stage 1 arena `c.j`'s header (at `c.i` 0)
/// and its slots from `c.i` on; stage 2 the filters field; stage 3 the bars field.
fn slot_heap(
    w: &World,
    c: &mut Cursor,
    want: usize,
    start: usize,
    out: &mut Vec<u8>,
) -> Result<bool, EncodeError> {
    let h = &w.heap;
    let classes: usize = h.classes().count();
    if c.stage == 0 {
        let total = slot_heap_len(w) as usize;
        let arenas: usize = h.classes().map(|(_, n, blocks)| arena_len(n as usize * blocks as usize)).sum();
        let mut wr = Writer::new(out);
        wr.u32(1);
        wr.u32((total - 8) as u32);
        wr.u16(1);
        wr.u32((4 + arenas) as u32);
        wr.u32(classes as u32);
        c.stage = 1;
        c.j = 0;
        c.i = 0;
    }
    while c.stage == 1 {
        let Some((class, n, blocks)) = h.classes().nth(c.j) else {
            c.stage = 2;
            break;
        };
        let slots = h.arena_slots(class);
        let count = n as usize * blocks as usize;
        if c.i == 0 {
            let mut wr = Writer::new(out);
            wr.u32((arena_len(count) - 4) as u32);
            wr.u16(1);
            wr.u32(1);
            wr.u8(class);
            wr.u16(2);
            wr.u32(2);
            wr.u16(n as u16);
            wr.u16(3);
            wr.u32(4);
            wr.u32(blocks);
            wr.u16(4);
            wr.u32((4 + count * Slot::SIZE) as u32);
            wr.u32(count as u32);
        }
        let room = (want.saturating_sub(out.len() - start) / Slot::SIZE).clamp(1, PIECE_ITEMS);
        let b = count.min(c.i + room);
        let mut wr = Writer::new(out);
        for x in &slots[c.i.min(slots.len())..b.min(slots.len())] {
            x.write(&mut wr, "slot_arena.slots")?;
        }
        c.i = b;
        if c.i >= count {
            c.j += 1;
            c.i = 0;
        }
        if out.len() - start >= want {
            return Ok(false);
        }
    }
    if c.stage == 2 {
        let f = h.all_filters();
        let mut wr = Writer::new(out);
        wr.u16(2);
        wr.u32((4 + f.len() * crate::r#gen::SlotFilter::SIZE) as u32);
        wr.u32(f.len() as u32);
        for x in f {
            x.write(&mut wr, "slot_heap.filters")?;
        }
        c.stage = 3;
    }
    if c.stage == 3 {
        let b = h.all_bars();
        let mut wr = Writer::new(out);
        wr.u16(3);
        wr.u32((4 + b.len() * crate::r#gen::InvBar::SIZE) as u32);
        wr.u32(b.len() as u32);
        for x in b {
            x.write(&mut wr, "slot_heap.bars")?;
        }
        c.stage = 4;
    }
    Ok(c.stage == 4)
}

impl HashJob {
    pub fn new() -> Self {
        Self::default()
    }

    /// Works for at most about `*budget` bytes of canonical state (decremented); the result once every section
    /// is hashed.
    pub fn step(&mut self, w: &World, budget: &mut u64) -> Result<Option<StateHashes>, EncodeError> {
        while *budget > 0 {
            let Some(&s) = SAVED_SECTIONS.get(self.sec) else {
                return Ok(Some(StateHashes {
                    full: self.full.digest(),
                    sections: std::mem::take(&mut self.sections),
                }));
            };
            if !self.started {
                self.started = true;
                self.cursor = Cursor::default();
                self.part = Xxh64::new();
                match known_len(w, s)? {
                    Some(len) => {
                        self.len = len;
                        self.measuring = false;
                        self.full.u32(s.value());
                        self.full.u32(len as u32);
                    }
                    None => {
                        self.len = 0;
                        self.measuring = true;
                    }
                }
            }
            self.buf.clear();
            let want = (*budget).min(1 << 16) as usize;
            let done = piece(w, s, &mut self.cursor, want, &mut self.buf)?;
            let n = self.buf.len() as u64;
            *budget = budget.saturating_sub(n.max(1));
            if self.measuring {
                self.len += n;
                if done {
                    self.measuring = false;
                    self.cursor = Cursor::default();
                    self.full.u32(s.value());
                    self.full.u32(self.len as u32);
                }
                continue;
            }
            self.full.write(&self.buf);
            self.part.write(&self.buf);
            if done {
                self.sections.push((s.value(), self.part.digest()));
                self.sec += 1;
                self.started = false;
            }
        }
        if self.sec >= SAVED_SECTIONS.len() {
            return Ok(Some(StateHashes {
                full: self.full.digest(),
                sections: std::mem::take(&mut self.sections),
            }));
        }
        Ok(None)
    }
}
