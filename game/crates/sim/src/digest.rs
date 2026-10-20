//! Digests (10 §4.8; S7; golden README rules 27, 37–42): the per-tick digest d_t, the slice hash of one of
//! 3,600 shards per tick, the rolling digest r_t and the lineage helpers.
//!
//! **The slice members** (rules 37–41; sections.yaml's shard rules). Every byte of every hashed section
//! belongs to exactly one member, each member to one shard:
//! - a table (`ENTITY_TABLE`, `POOL_CONTAINER`): a header member (`u32` rows) at its `header_shard`, key 0;
//!   one member per row (`u32` row index, then the row's saved columns in directory order), keyed and sharded
//!   by its entity's serial when live, by `2³² + index` and `index mod 3,600` when free;
//! - a `records` section: a count member (`u32`) at shard `3,000 + id`, key 0; one member per record (its
//!   stored bytes), key = position + 1, sharded by the section's rule;
//! - `SLOT_HEAP`: per arena in use, a header (`u8` class, `u16` block slots, `u32` blocks) at `3,100 + class`,
//!   key `class × 2³²`; per block (key `class × 2³² + 1 + block`) its slots, its limit-bar entry and its
//!   filters, each list after its `u32` count, at its owner's shard (a container's serial, a player's
//!   `(1,800 + 97 × index)`, a free block's `InvRef mod 3,600`);
//! - `GLOBALS` and `RNG`: their bytes in 4-KiB pieces, piece i at `(base + i) mod 3,600`, key i.
//!
//! Slice t hashes shard `t mod 3,600`'s members **sorted by (section id, key)**, each framed as `u32` section,
//! `u64` key, `u32` length, bytes (GATE-r2 finding 1). [`Slicer`] computes one shard from per-shard indexes
//! (live serials per shard, generated chunks per shard), touching only that shard's members; [`members`] is
//! the plain reference that enumerates everything, which the tests hold the slicer to.

use crate::r#gen::{EntityTable, encode_globals, encode_rng};
use crate::hash::{Xxh64, xxh64};
use crate::heap::{inv_block, inv_class, inv_ref};
use crate::save::{SAVED_SECTIONS, encode_section};
use crate::world::World;
use schema::codec::{EResult, Fixed, Writer};
use schema::{InvRef, PoolKind, RngWords, SHARDS, SaveSection, StatCounter, StatKey, TechId, Tick};

/// A table's free rows key above every serial (rule 37).
const FREE_ROW_KEY: u64 = 1 << 32;
const PIECE: usize = crate::r#gen::SHARD_PIECE_BYTES;

/// r₀ = XXH64(u32 worldSeed ‖ u32 0) (§4.8 item 3): a new world's lineage.
pub fn lineage0(seed: u32) -> u64 {
    let mut h = Xxh64::new();
    h.u32(seed);
    h.u32(0);
    h.digest()
}

/// A new lineage (§4.8 item 4: a remapped or migrated load, a baked save): XXH64(u64 stateHash ‖ u32 tick).
pub fn lineage_of(state_hash: u64, tick: u32) -> u64 {
    let mut h = Xxh64::new();
    h.u64(state_hash);
    h.u32(tick);
    h.digest()
}

/// r_t = XXH64(r_{t−1} ‖ d_t ‖ slice_t), three little-endian `u64` (§4.8 item 3).
pub fn roll(r: u64, d: u64, slice: u64) -> u64 {
    let mut h = Xxh64::new();
    h.u64(r);
    h.u64(d);
    h.u64(slice);
    h.digest()
}

/// The shard of player `index` (sections.yaml `player`).
pub const fn player_shard(index: u16) -> u32 {
    (1800 + 97 * index as u32) % SHARDS
}

/// The count member's shard of a `records` section (rule 38).
pub const fn count_shard(section: u32) -> u32 {
    (3000 + section) % SHARDS
}

/// An arena header's shard (rule 39).
pub const fn arena_shard(class: u8) -> u32 {
    (3100 + class as u32) % SHARDS
}

/// This tick's statistics counters (§5.20), by stat key: what phase 15 flushes and d_t hashes (§4.8).
/// Each list stays sorted by key; nothing is allocated once the lists have grown to a tick's needs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Counters {
    pub produced: Vec<(StatKey, f64)>,
    pub consumed: Vec<(StatKey, f64)>,
    pub handcrafted: Vec<(StatKey, f64)>,
}

impl Counters {
    pub fn clear(&mut self) {
        self.produced.clear();
        self.consumed.clear();
        self.handcrafted.clear();
    }

    /// Adds `v` to `key` in `list` (one of the three).
    pub fn add(list: &mut Vec<(StatKey, f64)>, key: StatKey, v: f64) {
        match list.binary_search_by(|x| x.0.cmp(&key)) {
            Ok(i) => list[i].1 += v,
            Err(i) => list.insert(i, (key, v)),
        }
    }
}

/// d_t's preimage (§4.8 item 1, rule 27; abi.yaml `TickDigestHead` … `TickDigestTail`): the tick and the
/// closure's hash; every RNG stream's state in `RngStream` order (no count); the live entity count; this
/// tick's nonzero produced and consumed counters, ascending, each list after its `u32` count; for each online
/// player in index order (no count) its index, position and inventory version; the current research. M0's
/// GLOBALS mark no field `digest: tick`.
pub fn write_preimage(w: &World, closure_hash: u64, c: &Counters, out: &mut Vec<u8>) -> EResult {
    let mut wr = Writer::new(out);
    schema::TickDigestHead { tick: Tick(w.current_tick()), closure_hash }.write(&mut wr, "TickDigestHead")?;
    for s in w.rng.records() {
        RngWords { s0: s.state[0], s1: s.state[1], s2: s.state[2], s3: s.state[3] }
            .write(&mut wr, "RngWords")?;
    }
    wr.u32(w.entity_count());
    for list in [&c.produced, &c.consumed] {
        let n = list.iter().filter(|x| x.1 != 0.0).count();
        wr.u32(n as u32);
        for &(key, value) in list.iter().filter(|x| x.1 != 0.0) {
            StatCounter { key, value }.write(&mut wr, "StatCounter")?;
        }
    }
    for p in w.players.iter().filter(|p| p.online) {
        schema::PlayerDigest { index: p.index, x: p.x, y: p.y, inventory_version: p.inventory_version }
            .write(&mut wr, "PlayerDigest")?;
    }
    // M0 has no research: technology none, progress 0 (§5.12 arrives in M1).
    schema::TickDigestTail { research_tech: TechId::NONE, research_progress: 0.0 }
        .write(&mut wr, "TickDigestTail")?;
    Ok(())
}

/// Frames one member into the slice hash (rule 41).
#[inline]
fn frame(h: &mut Xxh64, section: SaveSection, key: u64, bytes: &[u8]) {
    h.u32(section.value());
    h.u64(key);
    h.u32(bytes.len() as u32);
    h.write(bytes);
}

/// An entity-table row's member bytes: `u32` index, then the saved columns in directory order (rule 37).
/// The columns are matched by name, so a column added to the schema fails loudly here and in the tests.
fn entity_row(t: &EntityTable, i: usize, out: &mut Vec<u8>) {
    out.extend_from_slice(&(i as u32).to_le_bytes());
    for (name, _, _) in EntityTable::SAVED_COLUMNS {
        match name {
            "proto" => out.extend_from_slice(&t.proto[i].0.to_le_bytes()),
            "kind" => out.push(t.kind[i].value()),
            "surface" => out.push(t.surface[i]),
            "dir" => out.push(t.dir[i].value()),
            "flip" => out.push(t.flip[i]),
            "quality" => out.push(t.quality[i]),
            "built_by" => out.push(t.built_by[i]),
            "x2" => out.extend_from_slice(&t.x2[i].to_le_bytes()),
            "y2" => out.extend_from_slice(&t.y2[i].to_le_bytes()),
            "pool_slot" => out.extend_from_slice(&t.pool_slot[i].to_le_bytes()),
            "flags" => out.extend_from_slice(&t.flags[i].bits().to_le_bytes()),
            "serial" => out.extend_from_slice(&t.serial[i].0.to_le_bytes()),
            "gen" => out.extend_from_slice(&t.r#gen[i].to_le_bytes()),
            "built_tick" => out.extend_from_slice(&t.built_tick[i].0.to_le_bytes()),
            other => panic!("entity_table column {other} has no slice encoding (digest.rs)"),
        }
    }
}

/// A container-pool row's member bytes (rule 37): `u32` index, the entity as its serial, the `InvRef`.
fn container_row(w: &World, i: usize, out: &mut Vec<u8>) {
    out.extend_from_slice(&(i as u32).to_le_bytes());
    for (name, _, _) in crate::r#gen::ContainerPool::SAVED_COLUMNS {
        match name {
            "entity" => out.extend_from_slice(&w.serial_of(w.containers.entity[i]).0.to_le_bytes()),
            "inv" => out.extend_from_slice(&w.containers.inv[i].0.to_le_bytes()),
            other => panic!("container column {other} has no slice encoding (digest.rs)"),
        }
    }
}

/// Computes slice hashes from the World's per-shard indexes, with reused buffers: only the members of the
/// requested shard are encoded (§4.8: "about 1/3,600 of the state" per tick).
#[derive(Clone, Debug, Default)]
pub struct Slicer {
    buf: Vec<u8>,
    blocks: Vec<(u64, InvRef)>,
    free: Vec<u32>,
    /// Records of the keyed sections (`TIMERS`, `STATS`, `WORLDGEN_PENDING`) the last slice looked at: only
    /// its shard's (C2a-r1 finding 10).
    visited: usize,
}

impl Slicer {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many `TIMERS`, `STATS` and `WORLDGEN_PENDING` records the last slice looked at.
    pub fn last_visited(&self) -> usize {
        self.visited
    }

    /// The slice hash of shard `shard` of `w` (rule 41).
    pub fn slice_hash(&mut self, w: &World, shard: u32) -> Result<u64, schema::codec::EncodeError> {
        let mut h = Xxh64::new();
        self.visited = 0;
        let bucket = w.shards.bucket(shard);
        // 1 ENTITY_TABLE: header, live rows by serial, free rows by index.
        let rows = w.entities.rows();
        if shard == header_shard(SaveSection::EntityTable) {
            frame(&mut h, SaveSection::EntityTable, 0, &rows.to_le_bytes());
        }
        for &s in bucket {
            let row = crate::handle::slot(w.serials.get(s).expect("a bucketed serial is live")) as usize;
            self.buf.clear();
            entity_row(&w.entities, row, &mut self.buf);
            frame(&mut h, SaveSection::EntityTable, u64::from(s.0), &self.buf);
        }
        let mut i = shard;
        while i < rows {
            if !w.entities.is_live(i) {
                self.buf.clear();
                entity_row(&w.entities, i as usize, &mut self.buf);
                frame(&mut h, SaveSection::EntityTable, FREE_ROW_KEY + u64::from(i), &self.buf);
            }
            i += SHARDS;
        }
        // 2 GLOBALS: pieces from shard 0.
        self.buf.clear();
        encode_globals(&mut Writer::new(&mut self.buf), &w.globals)?;
        pieces(&mut h, SaveSection::Globals, &self.buf, 0, shard);
        // 3 SLOT_HEAP: arena headers and blocks, sorted by key.
        self.blocks.clear();
        for (c, _, _) in w.heap.classes() {
            if arena_shard(c) == shard {
                self.blocks.push((u64::from(c) << 32, InvRef::NONE));
            }
            self.free.clear();
            w.heap.free_blocks_in_shard(c, shard, SHARDS, &mut self.free);
            for &b in &self.free {
                self.blocks.push(((u64::from(c) << 32) + 1 + u64::from(b), inv_ref(c, b)));
            }
        }
        for &s in bucket {
            let row = crate::handle::slot(w.serials.get(s).expect("live")) as usize;
            match w.entities.kind[row] {
                PoolKind::Container => {
                    let inv = w.containers.inv[w.entities.pool_slot[row] as usize];
                    self.blocks.push((block_key(inv), inv));
                }
            }
        }
        for p in w.players.iter() {
            if !p.main.is_none() && player_shard(p.index.0) == shard {
                self.blocks.push((block_key(p.main), p.main));
            }
        }
        self.blocks.sort_unstable_by_key(|x| x.0);
        for k in 0..self.blocks.len() {
            let (key, inv) = self.blocks[k];
            self.buf.clear();
            if inv.is_none() {
                let c = (key >> 32) as u8;
                let (_, slots, blocks) = w.heap.classes().find(|x| x.0 == c).expect("a class in use");
                self.buf.push(c);
                self.buf.extend_from_slice(&(slots as u16).to_le_bytes());
                self.buf.extend_from_slice(&blocks.to_le_bytes());
            } else {
                w.heap.write_block_member(inv, &mut Writer::new(&mut self.buf))?;
            }
            frame(&mut h, SaveSection::SlotHeap, key, &self.buf);
        }
        // 5 CHUNKS: count, then the modified chunks of this shard by position.
        if shard == count_shard(SaveSection::Chunks.value()) {
            frame(&mut h, SaveSection::Chunks, 0, &(w.chunks.modified_count() as u32).to_le_bytes());
        }
        for &(surface, key) in w.chunks.generated_in_shard(shard) {
            if let Ok(pos) = w.chunks.modified_index(surface, key) {
                self.buf.clear();
                w.chunks.modified_at(pos).rec.encode(&mut Writer::new(&mut self.buf))?;
                frame(&mut h, SaveSection::Chunks, pos as u64 + 1, &self.buf);
            }
        }
        // 9 TIMERS: by serial, or owner when the serial is 0; this shard's timers from its bucket, each at its
        // position in fire order (C2a-r1 finding 10: no scan of every timer).
        if shard == count_shard(SaveSection::Timers.value()) {
            frame(&mut h, SaveSection::Timers, 0, &(w.timers().len() as u32).to_le_bytes());
        }
        for k in w.timer_shards.bucket(shard) {
            self.visited += 1;
            let j = w.timers().rank(k).expect("a bucketed timer is scheduled");
            self.buf.clear();
            World::timer_record(k).encode(&mut Writer::new(&mut self.buf))?;
            frame(&mut h, SaveSection::Timers, j as u64 + 1, &self.buf);
        }
        // 10 RNG: pieces from shard 1,801.
        self.buf.clear();
        encode_rng(&mut Writer::new(&mut self.buf), w.rng.records())?;
        pieces(&mut h, SaveSection::Rng, &self.buf, 1801, shard);
        // 11 PLAYERS.
        if shard == count_shard(SaveSection::Players.value()) {
            frame(&mut h, SaveSection::Players, 0, &(w.players.len() as u32).to_le_bytes());
        }
        for (j, p) in w.players.iter().enumerate() {
            if player_shard(p.index.0) == shard {
                self.buf.clear();
                p.encode(&mut Writer::new(&mut self.buf))?;
                frame(&mut h, SaveSection::Players, j as u64 + 1, &self.buf);
            }
        }
        // 13 STATS: by stat key, from this shard's bucket.
        if shard == count_shard(SaveSection::Stats.value()) {
            frame(&mut h, SaveSection::Stats, 0, &(w.stats().len() as u32).to_le_bytes());
        }
        for key in w.stat_shards.bucket(shard) {
            self.visited += 1;
            let j = w.stat_position(*key).expect("a bucketed key has a record");
            self.buf.clear();
            w.stats()[j].encode(&mut Writer::new(&mut self.buf))?;
            frame(&mut h, SaveSection::Stats, j as u64 + 1, &self.buf);
        }
        // 16 WORLDGEN_PENDING: by the chunk key of (cx, cy), from this shard's bucket.
        if shard == count_shard(SaveSection::WorldgenPending.value()) {
            frame(&mut h, SaveSection::WorldgenPending, 0, &(w.pending().len() as u32).to_le_bytes());
        }
        for k in w.pending_shards.bucket(shard) {
            self.visited += 1;
            let j = w.pending().rank(k).expect("a bucketed request is pending");
            self.buf.clear();
            World::pending_record(k).encode(&mut Writer::new(&mut self.buf))?;
            frame(&mut h, SaveSection::WorldgenPending, j as u64 + 1, &self.buf);
        }
        // 17 GENERATED.
        if shard == count_shard(SaveSection::Generated.value()) {
            frame(&mut h, SaveSection::Generated, 0, &(w.chunks.generated().len() as u32).to_le_bytes());
        }
        for &(surface, key) in w.chunks.generated_in_shard(shard) {
            let pos = w.chunks.generated_index(surface, key).expect("a bucketed chunk is generated");
            self.buf.clear();
            w.chunks.generated()[pos].encode(&mut Writer::new(&mut self.buf))?;
            frame(&mut h, SaveSection::Generated, pos as u64 + 1, &self.buf);
        }
        // 32 POOL_CONTAINER: header, live rows by serial, free rows by index.
        let rows = w.containers.rows();
        if shard == header_shard(SaveSection::PoolContainer) {
            frame(&mut h, SaveSection::PoolContainer, 0, &rows.to_le_bytes());
        }
        for &s in bucket {
            let row = crate::handle::slot(w.serials.get(s).expect("live")) as usize;
            if w.entities.kind[row] == PoolKind::Container {
                self.buf.clear();
                container_row(w, w.entities.pool_slot[row] as usize, &mut self.buf);
                frame(&mut h, SaveSection::PoolContainer, u64::from(s.0), &self.buf);
            }
        }
        let mut i = shard;
        while i < rows {
            if !w.containers.is_live(i) {
                self.buf.clear();
                container_row(w, i as usize, &mut self.buf);
                frame(&mut h, SaveSection::PoolContainer, FREE_ROW_KEY + u64::from(i), &self.buf);
            }
            i += SHARDS;
        }
        Ok(h.digest())
    }
}

/// A table section's header shard (sections.yaml `header_shard`).
fn header_shard(s: SaveSection) -> u32 {
    let info = crate::r#gen::SECTIONS.iter().find(|x| x.section == s);
    info.and_then(|x| x.header_shard).expect("a table section has a header shard") % SHARDS
}

/// A slot-heap block's member key (rule 39).
fn block_key(r: InvRef) -> u64 {
    (u64::from(inv_class(r)) << 32) + 1 + u64::from(inv_block(r))
}

/// The pieces of `bytes` that fall in `shard` (rule 40), in key order.
fn pieces(h: &mut Xxh64, section: SaveSection, bytes: &[u8], base: u32, shard: u32) {
    let n = bytes.len().div_ceil(PIECE).max(1);
    let mut i = ((shard + SHARDS - base % SHARDS) % SHARDS) as usize;
    while i < n {
        let end = ((i + 1) * PIECE).min(bytes.len());
        frame(h, section, i as u64, &bytes[(i * PIECE).min(end)..end]);
        i += SHARDS as usize;
    }
}

/// One member of the canonical state (the reference enumeration).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    pub section: u32,
    pub key: u64,
    pub shard: u32,
    pub bytes: Vec<u8>,
}

/// Every member of the canonical state, section by section, in no particular order within a section. The
/// reference the slicer is tested against: it reads the **encoded sections** (column tables by their
/// directories, records by their framing), so it shares no code path with [`Slicer`] beyond the encoders.
pub fn members(w: &World) -> Vec<Member> {
    let mut out = Vec::new();
    for s in SAVED_SECTIONS {
        let mut bytes = Vec::new();
        encode_section(w, s, &mut bytes).expect("an encodable state");
        let id = s.value();
        match s {
            SaveSection::EntityTable | SaveSection::PoolContainer => {
                let rows = table_rows(&bytes);
                out.push(Member { section: id, key: 0, shard: header_shard(s), bytes: bytes[..4].to_vec() });
                for (i, row) in rows.into_iter().enumerate() {
                    // The live column: the entity table's serial, the pool's entity (saved as its serial).
                    let col = if s == SaveSection::EntityTable { "serial" } else { "entity" };
                    let serial = column_u32(&bytes, col, i);
                    let (key, shard) = if serial != 0 {
                        (u64::from(serial), serial % SHARDS)
                    } else {
                        (FREE_ROW_KEY + i as u64, i as u32 % SHARDS)
                    };
                    let mut b = (i as u32).to_le_bytes().to_vec();
                    b.extend_from_slice(&row);
                    out.push(Member { section: id, key, shard, bytes: b });
                }
            }
            SaveSection::Globals | SaveSection::Rng => {
                let base = if s == SaveSection::Globals { 0 } else { 1801 };
                let n = bytes.len().div_ceil(PIECE).max(1);
                for i in 0..n {
                    let end = ((i + 1) * PIECE).min(bytes.len());
                    out.push(Member {
                        section: id,
                        key: i as u64,
                        shard: (base + i as u32) % SHARDS,
                        bytes: bytes[(i * PIECE).min(end)..end].to_vec(),
                    });
                }
            }
            SaveSection::SlotHeap => heap_members(w, &mut out),
            SaveSection::Chunks
            | SaveSection::Timers
            | SaveSection::Players
            | SaveSection::Stats
            | SaveSection::WorldgenPending
            | SaveSection::Generated => {
                out.push(Member { section: id, key: 0, shard: count_shard(id), bytes: bytes[..4].to_vec() });
                let mut at = 4;
                let mut j = 0u64;
                while at < bytes.len() {
                    let len =
                        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize;
                    let rec = &bytes[at..at + 4 + len];
                    let shard = record_shard(w, s, j as usize);
                    j += 1;
                    out.push(Member { section: id, key: j, shard, bytes: rec.to_vec() });
                    at += 4 + len;
                }
            }
            SaveSection::Cold
            | SaveSection::Charted
            | SaveSection::Thermal
            | SaveSection::Networks
            | SaveSection::Research
            | SaveSection::Blueprints
            | SaveSection::Undo
            | SaveSection::ClosureLog
            | SaveSection::Thumbnail => unreachable!("not a saved section"),
        }
    }
    out
}

/// The shard of record `j` of a `records` section (sections.yaml's rules).
fn record_shard(w: &World, s: SaveSection, j: usize) -> u32 {
    match s {
        SaveSection::Chunks => w.chunks.modified_at(j).key().0 % SHARDS,
        SaveSection::Timers => crate::world::timer_shard(w.timers().iter().nth(j).expect("a timer")),
        SaveSection::Players => player_shard(w.players.iter().nth(j).expect("a player").index.0),
        SaveSection::Stats => w.stats()[j].key.0 % SHARDS,
        SaveSection::WorldgenPending => {
            crate::world::pending_shard(w.pending().iter().nth(j).expect("a request"))
        }
        SaveSection::Generated => w.chunks.generated()[j].key.0 % SHARDS,
        SaveSection::EntityTable
        | SaveSection::Globals
        | SaveSection::SlotHeap
        | SaveSection::Rng
        | SaveSection::PoolContainer
        | SaveSection::Cold
        | SaveSection::Charted
        | SaveSection::Thermal
        | SaveSection::Networks
        | SaveSection::Research
        | SaveSection::Blueprints
        | SaveSection::Undo
        | SaveSection::ClosureLog
        | SaveSection::Thumbnail => unreachable!("not a records section"),
    }
}

/// A column table's rows as each row's column bytes in directory order (§8.1's layout, read generically).
fn table_rows(t: &[u8]) -> Vec<Vec<u8>> {
    let u32_at = |at: usize| u32::from_le_bytes([t[at], t[at + 1], t[at + 2], t[at + 3]]) as usize;
    let rows = u32_at(0);
    let n = usize::from(u16::from_le_bytes([t[4], t[5]]));
    let mut cols = Vec::with_capacity(n);
    let mut at = 8;
    for _ in 0..n {
        let len = usize::from(t[at]);
        at += 1 + len + 2;
        let off = u32_at(at);
        let bytes = u32_at(at + 4);
        at += 8;
        cols.push((off, bytes.checked_div(rows).unwrap_or(0)));
    }
    (0..rows)
        .map(|i| {
            let mut row = Vec::new();
            for &(off, width) in &cols {
                row.extend_from_slice(&t[off + i * width..off + (i + 1) * width]);
            }
            row
        })
        .collect()
}

/// A `u32` column's value at row `i`, found by name in the table's directory.
fn column_u32(t: &[u8], name: &str, i: usize) -> u32 {
    let u32_at = |at: usize| u32::from_le_bytes([t[at], t[at + 1], t[at + 2], t[at + 3]]);
    let n = usize::from(u16::from_le_bytes([t[4], t[5]]));
    let mut at = 8;
    for _ in 0..n {
        let len = usize::from(t[at]);
        let cname = &t[at + 1..at + 1 + len];
        at += 1 + len + 2;
        let off = u32_at(at) as usize;
        at += 8;
        if cname == name.as_bytes() {
            return u32_at(off + 4 * i);
        }
    }
    panic!("no column {name}")
}

/// The slot heap's members, from its record (rule 39).
fn heap_members(w: &World, out: &mut Vec<Member>) {
    let id = SaveSection::SlotHeap.value();
    let rec = w.heap.to_record();
    let mut owner: Vec<(InvRef, u32)> = Vec::new();
    for slot in 0..w.containers.rows() {
        if w.containers.is_live(slot) {
            let s = w.serial_of(w.containers.entity[slot as usize]).0;
            owner.push((w.containers.inv[slot as usize], s % SHARDS));
        }
    }
    for p in w.players.iter() {
        if !p.main.is_none() {
            owner.push((p.main, player_shard(p.index.0)));
        }
    }
    for a in &rec.arenas {
        let base = u64::from(a.class) << 32;
        let mut hb = vec![a.class];
        hb.extend_from_slice(&a.block_slots.to_le_bytes());
        hb.extend_from_slice(&a.blocks.to_le_bytes());
        out.push(Member { section: id, key: base, shard: arena_shard(a.class), bytes: hb });
        let n = usize::from(a.block_slots);
        for b in 0..a.blocks {
            let r = inv_ref(a.class, b);
            let mut bytes = Vec::new();
            let mut wr = Writer::new(&mut bytes);
            for s in &a.slots[b as usize * n..(b as usize + 1) * n] {
                s.write(&mut wr, "slot").expect("a slot");
            }
            let bars: Vec<_> = rec.bars.iter().filter(|x| x.inv == r).collect();
            wr.u32(bars.len() as u32);
            for x in bars {
                x.write(&mut wr, "bar").expect("a bar");
            }
            let filters: Vec<_> = rec.filters.iter().filter(|x| x.inv == r).collect();
            wr.u32(filters.len() as u32);
            for x in filters {
                x.write(&mut wr, "filter").expect("a filter");
            }
            let shard = owner.iter().find(|o| o.0 == r).map_or(r.0 % SHARDS, |o| o.1);
            out.push(Member { section: id, key: base + 1 + u64::from(b), shard, bytes });
        }
    }
}

/// The reference slice hash: the members of `shard`, sorted by (section, key), framed and hashed.
pub fn slice_reference(all: &[Member], shard: u32) -> u64 {
    let mut ms: Vec<&Member> = all.iter().filter(|m| m.shard == shard).collect();
    ms.sort_by_key(|m| (m.section, m.key));
    let mut h = Xxh64::new();
    for m in ms {
        h.u32(m.section);
        h.u64(m.key);
        h.u32(m.bytes.len() as u32);
        h.write(&m.bytes);
    }
    h.digest()
}

/// The hash of a member's bytes, as the golden members files list it.
pub fn member_hash(m: &Member) -> u64 {
    xxh64(&m.bytes)
}
