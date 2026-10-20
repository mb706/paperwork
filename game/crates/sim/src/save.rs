//! Saves and checkpoints (10 §8.1–§8.3, §8.6; §15.8 `sim_save`/`sim_load`; golden README rules 29, 42).
//!
//! - **Sections.** `sim_save` writes every hashed section this build declares, in ascending id, empty ones
//!   included (rule 29), each in the container's framing with codec raw (`SectionFrame`), then the lineage r
//!   (`SaveOutput`). The IO worker adds the header and compresses (§8.1); Rust never reads the header.
//! - **The full state hash** (§4.8) is XXH64 over every hashed section in ascending id, each prefixed by its id
//!   and raw length (`u32` each); a section's own hash is XXH64 of its bytes (rule 27).
//! - **Loading** (`LoadInput`): the sections, the remap tables and the lineage. Two passes (§4.5): the entity
//!   table first, which gives every serial its handle, then every section that names entities by serial.
//!   Refusals, in order: a malformed input (`ERR_INPUT`); a section newer than this build, a missing, repeated
//!   or misordered section (`ERR_LOAD_FORMAT`); another worldgen version or worldgen data while a generated
//!   chunk is pristine (`ERR_WORLDGEN`, §4.4); bytes the schema cannot read (`ERR_LOAD_SCHEMA`); state that
//!   breaks the cross-section invariants (`ERR_LOAD_FORMAT`, "corrupt"); prototypes that cannot be remapped
//!   (`ERR_PROTOS`). A refused load changes nothing (the caller keeps its world).
//! - **Lineage** (§4.8 item 4): a plain load continues from the r it is given; a load with remap tables, and a
//!   load that moves a baked save to this build's worldgen rules, start a new lineage over the loaded state.

use crate::chunks::ChunkStore;
use crate::digest::lineage_of;
use crate::r#gen::{
    ContainerPool, EntityTable, decode_chunks, decode_generated, decode_globals, decode_players, decode_rng,
    decode_slot_heap, decode_stats, decode_timers, decode_worldgen_pending, encode_generated, encode_globals,
    encode_rng, encode_slot_heap, encode_stats,
};
use crate::hash::{Xxh64, xxh64};
use crate::heap::SlotHeap;
use crate::players::Players;
use crate::remap::{self, Remap, RemovedProto};
use crate::rng::RngStreams;
use crate::validate;
use crate::world::World;
use crate::{SimError, SimResult};
use schema::codec::{DecodeError, EResult, EncodeError, Packed, Reader, Writer};
use schema::{
    EntityHandle, InvRef, LoadInput, Protos, SaveSection, SectionCodec, SectionFlags, SectionFrame, Serial,
    SimStatus,
};
use std::sync::Arc;

/// The hashed sections every save holds, in ascending id (§8.1; rule 29).
pub const SAVED_SECTIONS: [SaveSection; 11] = [
    SaveSection::EntityTable,
    SaveSection::Globals,
    SaveSection::SlotHeap,
    SaveSection::Chunks,
    SaveSection::Timers,
    SaveSection::Rng,
    SaveSection::Players,
    SaveSection::Stats,
    SaveSection::WorldgenPending,
    SaveSection::Generated,
    SaveSection::PoolContainer,
];

/// The worldgen version this build implements (§4.4: raised by hand whenever a chunk's output could change;
/// golden rule 4).
pub const WORLDGEN_VERSION: u32 = 1;

/// The worldgen rules a build generates with (§4.4): the version and the hash of `prototypes.bin`'s
/// worldgen-relevant tables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorldgenId {
    pub version: u32,
    pub data_hash: [u8; 32],
}

/// The worldgen data hash (golden rule 4): SHA-256 of `prototypes.bin`'s PROTO_RESOURCE, PROTO_TILE and
/// PROTO_WORLD frames (ids 6–8, consecutive), from the first frame's header to the last frame's padding.
/// `None` when the file lacks them (`Protos::load` has refused such a file before this runs).
pub fn worldgen_data_hash(bin: &[u8]) -> Option<[u8; 32]> {
    let u32_at = |at: usize| -> Option<u32> {
        let b = bin.get(at..at + 4)?;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let count = u32_at(48)?;
    let mut at = schema::PROTOS_HEADER_SIZE;
    let (mut start, mut end) = (None, None);
    for _ in 0..count {
        let id = u32_at(at)?;
        let stored = u32_at(at + 12)? as usize;
        let next = at + 16 + stored + (8 - stored % 8) % 8;
        if id == 6 {
            start = Some(at);
        }
        if id == 8 {
            end = Some(next);
        }
        at = next;
    }
    let (s, e) = (start?, end?);
    Some(crate::sha256::sha256(bin.get(s..e)?))
}

fn enc(e: EncodeError) -> SimError {
    SimError::new(SimStatus::ErrOrder, format!("the state cannot be encoded: {e}"))
}

/// Writes one hashed section's bytes (§8.1) into `out` (appended).
pub fn encode_section(w: &World, s: SaveSection, out: &mut Vec<u8>) -> EResult {
    let mut wr = Writer::new(out);
    match s {
        SaveSection::EntityTable => w.entities.save(&mut wr),
        SaveSection::Globals => encode_globals(&mut wr, &w.globals),
        SaveSection::SlotHeap => encode_slot_heap(&mut wr, &w.heap.to_record()),
        SaveSection::Chunks => {
            // `encode_chunks` without collecting the records: the store keeps them sorted and unique.
            wr.u32(w.chunks.modified_count() as u32);
            for c in w.chunks.modified() {
                c.rec.encode(&mut wr)?;
            }
            Ok(())
        }
        SaveSection::Timers => {
            wr.u32(w.timers().len() as u32);
            for k in w.timers().iter() {
                World::timer_record(k).encode(&mut wr)?;
            }
            Ok(())
        }
        SaveSection::Rng => encode_rng(&mut wr, w.rng.records()),
        SaveSection::Players => {
            wr.u32(w.players.len() as u32);
            for p in w.players.iter() {
                p.encode(&mut wr)?;
            }
            Ok(())
        }
        SaveSection::Stats => encode_stats(&mut wr, w.stats()),
        SaveSection::WorldgenPending => {
            wr.u32(w.pending().len() as u32);
            for k in w.pending().iter() {
                World::pending_record(k).encode(&mut wr)?;
            }
            Ok(())
        }
        SaveSection::Generated => encode_generated(&mut wr, w.chunks.generated()),
        SaveSection::PoolContainer => w.containers.save(&mut wr, &|h| w.serial_of(h)),
        SaveSection::Cold
        | SaveSection::Charted
        | SaveSection::Thermal
        | SaveSection::Networks
        | SaveSection::Research
        | SaveSection::Blueprints
        | SaveSection::Undo
        | SaveSection::ClosureLog
        | SaveSection::Thumbnail => {
            Err(schema::codec::enc_err(schema::codec::ErrorKind::UnknownType, s.name()))
        }
    }
}

/// Every hashed section's bytes, ascending (what `sim_save` frames).
pub fn encode_sections(w: &World) -> SimResult<Vec<(SaveSection, Vec<u8>)>> {
    let mut out = Vec::with_capacity(SAVED_SECTIONS.len());
    for s in SAVED_SECTIONS {
        let mut b = Vec::new();
        encode_section(w, s, &mut b).map_err(enc)?;
        out.push((s, b));
    }
    Ok(out)
}

/// The full state hash and each section's (§4.8; `sim_state_hash`), computed one section at a time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateHashes {
    pub full: u64,
    pub sections: Vec<(u32, u64)>,
}

pub fn state_hash(w: &World) -> SimResult<StateHashes> {
    let mut h = Xxh64::new();
    let mut sections = Vec::with_capacity(SAVED_SECTIONS.len());
    let mut b = Vec::new();
    for s in SAVED_SECTIONS {
        b.clear();
        encode_section(w, s, &mut b).map_err(enc)?;
        h.u32(s.value());
        h.u32(b.len() as u32);
        h.write(&b);
        sections.push((s.value(), xxh64(&b)));
    }
    Ok(StateHashes { full: h.digest(), sections })
}

/// The full state hash of sections already encoded.
pub fn state_hash_of(sections: &[(SaveSection, Vec<u8>)]) -> u64 {
    let mut h = Xxh64::new();
    for (s, b) in sections {
        h.u32(s.value());
        h.u32(b.len() as u32);
        h.write(b);
    }
    h.digest()
}

/// `SaveOutput` (abi.yaml): `u32` count, each section in the container's framing (codec raw, the HASHED
/// flag), then the lineage `r`.
pub fn write_save_output(sections: &[(SaveSection, Vec<u8>)], r: u64, out: &mut Vec<u8>) -> SimResult<()> {
    let mut w = Writer::new(out);
    w.u32(sections.len() as u32);
    for (s, b) in sections {
        let f = SectionFrame {
            id: s.value(),
            version: s.version(),
            codec: SectionCodec::Raw,
            flags: if s.hashed() { SectionFlags::HASHED } else { SectionFlags::EMPTY },
            raw_length: b.len() as u32,
            data: b,
        };
        f.encode(&mut w).map_err(enc)?;
    }
    w.u64(r);
    Ok(())
}

/// A parsed `LoadInput`: the section frames, the remap tables and the lineage.
#[derive(Debug)]
pub struct LoadRequest<'a> {
    pub frames: Vec<SectionFrame<'a>>,
    pub remaps: Vec<Remap>,
    pub r: u64,
}

fn input(m: impl Into<String>) -> SimError {
    SimError::new(SimStatus::ErrInput, m)
}

fn schema_err(s: SaveSection, e: DecodeError) -> SimError {
    SimError::new(SimStatus::ErrLoadSchema, format!("{}: {e}", s.name()))
}

fn corrupt(m: impl Into<String>) -> SimError {
    SimError::new(SimStatus::ErrLoadFormat, format!("corrupt save: {}", m.into()))
}

/// Parses `sim_load`'s input (abi.yaml `LoadInput`): every frame raw with stored = raw length, the remap
/// tables well formed. Anything else is `ERR_INPUT`.
pub fn parse_load_input<'a>(bytes: &'a [u8], protos: &Protos) -> SimResult<LoadRequest<'a>> {
    let v = LoadInput::decode_exact(bytes).map_err(|e| input(format!("LoadInput: {e}")))?;
    let mut frames = Vec::with_capacity(v.sections.len());
    v.sections.for_each(|f| frames.push(*f));
    for f in &frames {
        if f.codec != SectionCodec::Raw || f.raw_length as usize != f.data.len() {
            return Err(input(format!(
                "section {}: sim_load takes raw sections (codec 0, stored = raw)",
                f.id
            )));
        }
    }
    let mut tables = Vec::with_capacity(v.remaps.len());
    v.remaps.for_each(|t| tables.push(*t));
    let remaps = remap::parse_tables(&tables, protos)?;
    Ok(LoadRequest { frames, remaps, r: v.r })
}

/// What a load produced.
#[derive(Debug)]
pub struct Loaded {
    pub world: World,
    /// The lineage the world continues (§4.8 item 4).
    pub r: u64,
    pub new_lineage: bool,
    /// The removed prototypes the state used, ascending by (kind, name) (rule 42).
    pub removed: Vec<RemovedProto>,
}

/// Loads a save's sections into a new World (§8.1, §8.3). `build` is this build's worldgen identity.
pub fn load(protos: &Arc<Protos>, build: &WorldgenId, req: &LoadRequest<'_>) -> SimResult<Loaded> {
    // Section ids: strictly ascending, known hashed sections at a version this build reads (§8.3: a newer
    // version is a newer format); unknown or unhashed sections are skipped unless they claim to be hashed.
    let mut found: [Option<&[u8]>; SAVED_SECTIONS.len()] = [None; SAVED_SECTIONS.len()];
    let mut last: Option<u32> = None;
    for f in &req.frames {
        if last.is_some_and(|l| f.id <= l) {
            return Err(corrupt(format!("section {} is out of order or repeated", f.id)));
        }
        last = Some(f.id);
        let known = SaveSection::from_value(f.id).filter(|s| s.is_declared());
        match known {
            Some(s) => {
                if f.version > s.version() {
                    return Err(SimError::new(
                        SimStatus::ErrLoadFormat,
                        format!(
                            "section {} has version {}; this build reads up to {}",
                            s.name(),
                            f.version,
                            s.version()
                        ),
                    ));
                }
                if f.flags != if s.hashed() { SectionFlags::HASHED } else { SectionFlags::EMPTY } {
                    return Err(corrupt(format!("section {}'s HASHED flag", s.name())));
                }
                if let Some(i) = SAVED_SECTIONS.iter().position(|x| *x == s) {
                    found[i] = Some(f.data);
                }
            }
            None if f.flags.contains(SectionFlags::HASHED) => {
                return Err(SimError::new(
                    SimStatus::ErrLoadFormat,
                    format!("section {} is unknown to this build (a newer format)", f.id),
                ));
            }
            None => {}
        }
    }
    let get = |s: SaveSection| -> SimResult<&[u8]> {
        let i = SAVED_SECTIONS.iter().position(|x| *x == s).unwrap_or(0);
        found[i].ok_or_else(|| {
            SimError::new(SimStatus::ErrLoadFormat, format!("the save lacks section {}", s.name()))
        })
    };
    // §4.4, rule 4: the worldgen pair. GLOBALS, CHUNKS and GENERATED decide; read them first.
    let mut globals =
        decode_globals(get(SaveSection::Globals)?).map_err(|e| schema_err(SaveSection::Globals, e))?;
    let chunks = decode_chunks(get(SaveSection::Chunks)?).map_err(|e| schema_err(SaveSection::Chunks, e))?;
    let generated =
        decode_generated(get(SaveSection::Generated)?).map_err(|e| schema_err(SaveSection::Generated, e))?;
    let same_rules =
        globals.worldgen_version == build.version && globals.worldgen_data_hash.bytes == build.data_hash;
    let pristine = generated
        .iter()
        .filter(|g| chunks.binary_search_by(|c| (c.surface, c.key).cmp(&(g.surface, g.key))).is_err())
        .count();
    if !same_rules && pristine > 0 {
        let hex = |b: &[u8; 32]| b.iter().take(8).map(|x| format!("{x:02x}")).collect::<String>();
        return Err(SimError::new(
            SimStatus::ErrWorldgen,
            format!(
                "the save's worldgen rules (version {}, data {}…) are not this build's (version {}, data {}…), and \
                 {pristine} of its chunks are pristine, which this build cannot regenerate faithfully: bake the \
                 save with its own build first (§4.4)",
                globals.worldgen_version,
                hex(&globals.worldgen_data_hash.bytes),
                build.version,
                hex(&build.data_hash)
            ),
        ));
    }
    // Pass 1: the entity table, which gives every serial its handle (§4.5).
    let mut entities = EntityTable::load(get(SaveSection::EntityTable)?)
        .map_err(|e| schema_err(SaveSection::EntityTable, e))?;
    let mut by_serial: Vec<(Serial, u32)> = (0..entities.rows())
        .filter(|&r| entities.is_live(r))
        .map(|r| (entities.serial[r as usize], r))
        .collect();
    by_serial.sort_unstable();
    if by_serial.windows(2).any(|w| w[0].0 == w[1].0) {
        return Err(corrupt("two entities share a serial"));
    }
    let handle_of = |s: Serial| -> Option<EntityHandle> {
        let i = by_serial.binary_search_by(|x| x.0.cmp(&s)).ok()?;
        let row = by_serial[i].1;
        Some(crate::handle::make(row, entities.r#gen[row as usize]))
    };
    // Pass 2: everything that names entities by serial, then the rest.
    let mut containers = ContainerPool::load(get(SaveSection::PoolContainer)?, &mut |s| handle_of(s))
        .map_err(|e| schema_err(SaveSection::PoolContainer, e))?;
    let mut heap =
        decode_slot_heap(get(SaveSection::SlotHeap)?).map_err(|e| schema_err(SaveSection::SlotHeap, e))?;
    let timers = decode_timers(get(SaveSection::Timers)?).map_err(|e| schema_err(SaveSection::Timers, e))?;
    let rng = decode_rng(get(SaveSection::Rng)?).map_err(|e| schema_err(SaveSection::Rng, e))?;
    let mut players =
        decode_players(get(SaveSection::Players)?).map_err(|e| schema_err(SaveSection::Players, e))?;
    let mut stats = decode_stats(get(SaveSection::Stats)?).map_err(|e| schema_err(SaveSection::Stats, e))?;
    let pending = decode_worldgen_pending(get(SaveSection::WorldgenPending)?)
        .map_err(|e| schema_err(SaveSection::WorldgenPending, e))?;
    let mut chunks = chunks;

    // References first, before a remap follows them (C2a-r1 finding 1).
    validate::check_references(&entities, &containers, &heap, &players).map_err(corrupt)?;
    // §8.3: remap every prototype id and item key of the state to this build's ids.
    let mut removed = Vec::new();
    if !req.remaps.is_empty() {
        let mut raw = remap::RawState {
            entities: &mut entities,
            containers: &mut containers,
            heap: &mut heap,
            players: &mut players,
            stats: &mut stats,
            chunks: &mut chunks,
            map: &mut globals.map,
        };
        removed = remap::apply(&mut raw, &req.remaps)?;
    }
    // The map settings bound generation (C2b-r1 finding 4): a pristine chunk regenerates from them.
    worldgen::check_settings(&globals.map, protos).map_err(corrupt)?;
    // Prototypes, coordinates and positions before any derived index uses them (C2a-r1 finding 2).
    validate::check_entities(&entities, protos, &globals).map_err(corrupt)?;
    validate::check_players(&players, &globals).map_err(corrupt)?;

    let mut owners: Vec<InvRef> = Vec::new();
    for slot in 0..containers.rows() {
        if containers.is_live(slot) {
            owners.push(containers.inv[slot as usize]);
        }
    }
    for p in &players {
        if !p.main.is_none() {
            owners.push(p.main);
        }
    }
    let heap = SlotHeap::from_record(heap, &owners).map_err(|e| corrupt(e.0))?;
    let chunk_store = ChunkStore::from_records(chunks, generated).map_err(corrupt)?;
    let mut world = World::new(protos.clone(), globals);
    world.entities = entities;
    world.containers = containers;
    world.heap = heap;
    world.chunks = chunk_store;
    world.players = Players::from_records(players);
    world.set_stats(stats);
    let timer_keys: Vec<_> = timers.iter().map(|t| (t.due, t.serial, t.event, t.owner)).collect();
    let pending_keys: Vec<_> = pending.iter().map(|q| (q.commit_tick, q.surface, q.cy, q.cx)).collect();
    world.set_timers_and_pending(&timer_keys, &pending_keys).map_err(corrupt)?;
    world.rng = RngStreams::from_records(rng);
    world.rebuild_derived();
    validate::check_schedules(&world).map_err(corrupt)?;
    validate::check_rule_state(&world).map_err(corrupt)?;
    world.check_invariants().map_err(corrupt)?;
    validate::check_inventories(&world).map_err(corrupt)?;
    check_records(&world).map_err(corrupt)?;

    // A baked save from other worldgen rules continues under this build's (§4.4): its pair becomes this build's,
    // so its later saves regenerate what this build generates; like a remap, that starts a new lineage.
    let moved = !same_rules;
    if moved {
        world.globals.worldgen_version = build.version;
        world.globals.worldgen_data_hash.bytes = build.data_hash;
    }
    let new_lineage = !req.remaps.is_empty() || moved;
    let r = if new_lineage { lineage_of(state_hash(&world)?.full, world.current_tick()) } else { req.r };
    Ok(Loaded { world, r, new_lineage, removed })
}

/// Invariants of the record sections that the decoders cannot see: the surfaces are 0 … n − 1, chunks and
/// players stand on existing surfaces, players' inventories are live blocks of a size that holds the
/// character's inventory, statistics carry the nine rings in precision order.
fn check_records(w: &World) -> Result<(), String> {
    for (i, s) in w.globals.surfaces.iter().enumerate() {
        if usize::from(s.index.0) != i {
            return Err(format!("surface {} is listed at position {i}", s.index.0));
        }
    }
    let surfaces = w.globals.surfaces.len();
    if let Some(c) = w.chunks.generated().iter().find(|c| usize::from(c.surface.0) >= surfaces) {
        return Err(format!("a generated chunk on the missing surface {}", c.surface.0));
    }
    for p in w.players.iter() {
        if p.character.0 != 0 && usize::from(p.surface.0) >= surfaces {
            return Err(format!("player {} stands on the missing surface {}", p.index.0, p.surface.0));
        }
        if p.character.0 == 0 && !p.main.is_none() {
            return Err(format!("player {} has an inventory without a character", p.index.0));
        }
        if p.character.0 != 0 && p.main.is_none() {
            return Err(format!("player {}'s character has no inventory", p.index.0));
        }
    }
    for s in w.stats() {
        let ok =
            s.rings.len() == 9 && s.rings.iter().enumerate().all(|(i, r)| r.precision.value() as usize == i);
        if !ok {
            return Err(format!("statistics key {:#x} lacks its nine rings", s.key.0));
        }
        if !stat_key_known(&w.protos, s.key) {
            return Err(format!("statistics key {:#x} names nothing the prototypes have", s.key.0));
        }
    }
    Ok(())
}

/// Whether a statistics key (§5.20: `(StatKind << 24) | id`) names something of these prototypes (C2c-r1 finding
/// 3): an item key of a known item at a known quality (0–4), a known fluid or entity; heat and papers keys (M1's
/// tabs) are categories, not prototypes. Another kind is refused.
pub fn stat_key_known(p: &Protos, key: schema::StatKey) -> bool {
    let id = key.0 & 0x00FF_FFFF;
    match schema::StatKind::from_value((key.0 >> 24) as u8) {
        Some(schema::StatKind::Item) => {
            id <= 0xFFFF && ((id >> 3) as usize) < p.item.stack_size.len() && id & 7 <= 4
        }
        Some(schema::StatKind::Fluid) => (id as usize) < p.fluid.len(),
        Some(schema::StatKind::Entity) => (id as usize) < p.entity.len(),
        Some(schema::StatKind::Heat | schema::StatKind::Papers) => true,
        None => false,
    }
}

/// Parses a raw `SaveOutput` (or `sim_load`'s sections without remaps): the frames and the lineage. For tests
/// and tools that hold `sim_save`'s bytes.
pub fn parse_save_output(bytes: &[u8]) -> Result<(Vec<SectionFrame<'_>>, u64), DecodeError> {
    let v = schema::SaveOutput::decode_exact(bytes)?;
    let mut frames = Vec::new();
    v.sections.for_each(|f| frames.push(*f));
    Ok((frames, v.r))
}

/// `LoadInput` bytes for `frames` with no remap tables and lineage `r` (the shell's job; tests and tools).
pub fn load_input(frames: &[SectionFrame<'_>], r: u64) -> Vec<u8> {
    let mut out = Vec::new();
    let mut w = Writer::new(&mut out);
    w.u32(frames.len() as u32);
    for f in frames {
        f.encode(&mut w).expect("a frame from a parsed save re-encodes");
    }
    w.u16(0);
    w.u64(r);
    out
}

/// A save container (§8.1) split into its header JSON and its frames as stored: raw (codec 0) or deflated (codec
/// 1, the IO worker's). The module never inflates (the IO worker hands `sim_load` raw frames); native tools that
/// read containers inflate them (`simtool`, C2c-r1 finding 7).
pub fn read_container(bytes: &[u8]) -> Result<(&str, Vec<SectionFrame<'_>>), String> {
    let mut r = Reader::new(bytes);
    let magic = r.take(8, "magic").map_err(|e| e.to_string())?;
    if magic != schema::SAVE_MAGIC {
        return Err("not a save container (magic)".to_owned());
    }
    let version = r.u32("formatVersion").map_err(|e| e.to_string())?;
    if version != schema::SAVE_FORMAT_VERSION {
        return Err(format!("container format {version}; this build reads {}", schema::SAVE_FORMAT_VERSION));
    }
    let n = r.u32("headerLength").map_err(|e| e.to_string())? as usize;
    let header = r.take(n, "header").map_err(|e| e.to_string())?;
    let header = core::str::from_utf8(header).map_err(|_| "the header is not UTF-8".to_owned())?;
    let mut frames = Vec::new();
    while !r.is_empty() {
        let f = SectionFrame::decode(&mut r).map_err(|e| e.to_string())?;
        frames.push(f);
    }
    Ok((header.trim_end(), frames))
}
