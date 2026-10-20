//! A stub `sim.wasm` (C3's test fixture, pm/wp/C3-shell.md): the generated [`schema::SimAbi`] (10 §15.8)
//! implemented trivially, with the export shims of `schema::export_sim_abi!`. It keeps no game state; it records
//! what the shell sends and answers in the ABI's formats, so the worker shell is tested against a real
//! WebAssembly instance before and beside the real module:
//! - the call order and input checks of §15.8 (`ERR_ORDER`, `ERR_INPUT` from the generated decoders, `ERR_PROTOS`
//!   for a `prototypes.bin` of another schema);
//! - `sim_tick` runs the generated preflight (§15.3) against its seq watermarks, moves them for every action,
//!   and keeps the system actions' bookkeeping (online flags, input generations). Its per-tick digest is
//!   d_t = FNV-1a 64 over (u32 tick, the closure's bytes) and r_t = FNV-1a 64 over (r_{t−1}, d_t), so a test
//!   can check the framing and order of every closure the shell sent (test/helpers/stubs.ts);
//! - packets are a header only (`FULL` first after a world call, `COALESCED` after a gap), unless a test asks
//!   for a large one;
//! - saves hold two sections, GLOBALS (tick, seed, last_system_seq) and PLAYERS (index, online, input_gen,
//!   last_seq), and loads read those fields from any save's records, the golden ones included;
//! - a new world requests four chunks for tick 2 (§15.9); a supplied answer or inline generation settles each,
//!   and the stub logs which;
//! - `debug_dump` ids from 0xFFFF_0000 are test commands (see [`Stub::command`]); 0xFFFF_FFFF is the dev panic
//!   (C3's proposal to the sim package: the same id panics in `simcheck` builds of the real module).
#![allow(clippy::missing_const_for_fn)]

#[allow(dead_code)]
#[path = "../../common.rs"]
mod common;

use common::{
    ERR_BLOB_MISSING, ERR_FRAMING, ERR_INPUT, ERR_LIMIT, ERR_LOAD_FORMAT, ERR_ORDER, ERR_PROTOS, FNV_OFFSET,
    Io, OK, Out, fnv, le, log,
};
use schema::codec::{Fixed, Packed, Reader};
use schema::{
    Action, ChunkData, InitInput, LoadInput, NewWorld, PacketBuilder, PacketFlags, PacketSection,
    PreflightError, QueryInput, SaveInput, SimAbi, SubscribeInput, UnsubscribeInput, ViewRequest,
};
use std::cell::RefCell;

/// The dev panic's `debug_dump` id (C3's proposal for the real module's `simcheck` builds).
const DEV_PANIC: u32 = 0xFFFF_FFFF;
/// Test commands (`debug_dump` ids).
const CMD_GROW: u32 = 0xFFFF_0001;
const CMD_BIG_PACKET: u32 = 0xFFFF_0002;
const CMD_UNREACHABLE: u32 = 0xFFFF_0003;

const PLAYERS: usize = 32;

#[derive(Clone, Copy)]
struct Request {
    cx: i32,
    cy: i32,
    commit: u32,
    supplied: bool,
}

struct World {
    tick: u32,
    seed: u32,
    d: u64,
    r: u64,
    world_hash: u64,
    last_seq: [u32; PLAYERS],
    present: [bool; PLAYERS],
    online: [bool; PLAYERS],
    input_gen: [u16; PLAYERS],
    last_system_seq: u32,
    requests: Vec<Request>,
    unreported: Vec<Request>,
    extracted: bool,
    last_extract: u32,
}

impl World {
    fn new(seed: u32, tick: u32, r: u64, world_hash: u64) -> Self {
        Self {
            tick,
            seed,
            d: 0,
            r,
            world_hash,
            last_seq: [0; PLAYERS],
            present: [false; PLAYERS],
            online: [false; PLAYERS],
            input_gen: [0; PLAYERS],
            last_system_seq: 0,
            requests: Vec::new(),
            unreported: Vec::new(),
            extracted: false,
            last_extract: tick,
        }
    }

    /// The two saved sections' bytes: GLOBALS (2) and PLAYERS (11), in the record encodings of §8.1.
    fn sections(&self) -> [(u32, Vec<u8>); 2] {
        let mut g = Out(Vec::new());
        g.u32(1);
        g.u32(3 * 10);
        for (id, v) in [(1u16, self.tick), (2, self.seed), (10, self.last_system_seq)] {
            g.u16(id);
            g.u32(4);
            g.u32(v);
        }
        let mut p = Out(Vec::new());
        let ids: Vec<usize> = (0..PLAYERS).filter(|&i| self.present[i]).collect();
        p.u32(ids.len() as u32);
        for i in ids {
            p.u32(8 + 7 + 8 + 10);
            p.u16(1);
            p.u32(2);
            p.u16(i as u16);
            p.u16(2);
            p.u32(1);
            p.u8(u8::from(self.online[i]));
            p.u16(4);
            p.u32(2);
            p.u16(self.input_gen[i]);
            p.u16(5);
            p.u32(4);
            p.u32(self.last_seq[i]);
        }
        [(2, g.0), (11, p.0)]
    }

    fn state_hash(&self) -> u64 {
        let mut h = FNV_OFFSET;
        for (id, b) in self.sections() {
            h = fnv(h, &id.to_le_bytes());
            h = fnv(h, &(b.len() as u32).to_le_bytes());
            h = fnv(h, &b);
        }
        h
    }

    /// Reads tick, seed, last_system_seq and the players from a save's GLOBALS and PLAYERS records.
    fn read(&mut self, id: u32, data: &[u8]) -> Result<(), &'static str> {
        let count = le(data, 0, 4).ok_or("short section")? as usize;
        let mut at = 4;
        for _ in 0..count {
            let len = le(data, at, 4).ok_or("short record")? as usize;
            let body = data.get(at + 4..at + 4 + len).ok_or("short record")?;
            at += 4 + len;
            let mut fields: Vec<(u16, &[u8])> = Vec::new();
            let mut f = 0;
            while f + 6 <= body.len() {
                let fid = le(body, f, 2).ok_or("short triple")? as u16;
                let flen = le(body, f + 2, 4).ok_or("short triple")? as usize;
                fields.push((fid, body.get(f + 6..f + 6 + flen).ok_or("short triple")?));
                f += 6 + flen;
            }
            let get = |want: u16, n: usize| -> u64 {
                fields.iter().find(|(i, _)| *i == want).and_then(|(_, v)| le(v, 0, n)).unwrap_or(0)
            };
            if id == 2 {
                self.tick = get(1, 4) as u32;
                self.seed = get(2, 4) as u32;
                self.last_system_seq = get(10, 4) as u32;
            } else {
                let i = get(1, 2) as usize;
                if i >= PLAYERS {
                    return Err("player index out of range");
                }
                self.present[i] = true;
                self.online[i] = get(2, 1) != 0;
                self.input_gen[i] = get(4, 2) as u16;
                self.last_seq[i] = get(5, 4) as u32;
            }
        }
        Ok(())
    }
}

#[derive(Default)]
struct Stub {
    io: Io,
    protos: Option<Vec<u8>>,
    flags: u32,
    world: Option<World>,
    /// The last world call: 1 new world, 2 load (`sim_load_report` answers only after a load).
    last_world_call: u8,
    report: Option<(bool, u64)>,
    blobs: Vec<[u8; 32]>,
    queries: Vec<(u32, u16, u32)>,
    subscriptions: usize,
    big_packet: bool,
    /// Memory a test asked to grow by (`debug_dump` CMD_GROW).
    ballast: Vec<Vec<u8>>,
    /// The one column `sim_pool_dir` exports (entity_table.serial, POOL_COLUMNS id 15).
    column: Vec<u32>,
}

thread_local! {
    static STUB: RefCell<Stub> = RefCell::new(Stub { column: vec![1, 2, 3, 4], ..Stub::default() });
}

fn with<T>(f: impl FnOnce(&mut Stub) -> T) -> T {
    STUB.with(|s| f(&mut s.borrow_mut()))
}

impl Stub {
    fn world_or_order(&mut self) -> Result<&mut World, u32> {
        match self.world.as_mut() {
            Some(w) => Ok(w),
            None => Err(self.io.fail(ERR_ORDER, "no world")),
        }
    }

    fn init(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        let v = match InitInput::decode_exact(&req) {
            Ok(v) => v,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("init: {e:?}")),
        };
        if v.protos.get(0..8) != Some(b"PWPROTO\0".as_slice()) {
            return self.io.fail(ERR_PROTOS, "prototypes.bin: bad magic");
        }
        if v.protos.get(12..44) != Some(schema::SCHEMA_HASH.as_slice()) {
            return self.io.fail(ERR_PROTOS, "prototypes.bin: another schema's hash");
        }
        self.protos = Some(v.protos.to_vec());
        self.flags = v.flags.bits();
        self.world = None;
        self.last_world_call = 0;
        self.report = None;
        self.queries.clear();
        common::install_panic_hook();
        log(0, &format!("stub: init, {} bytes of prototypes", v.protos.len()));
        OK
    }

    fn world_hash(&self, seed: u32) -> u64 {
        fnv(fnv(FNV_OFFSET, &seed.to_le_bytes()), self.protos.as_deref().unwrap_or(&[]))
    }

    fn new_world(&mut self, len: u32) -> u32 {
        if self.protos.is_none() {
            return self.io.fail(ERR_ORDER, "sim_new_world before sim_init");
        }
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        let mut r = Reader::new(&req);
        let nw = match NewWorld::decode(&mut r, true).and_then(|v| r.finish("new_world").map(|()| v)) {
            Ok(v) => v,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("new_world: {e:?}")),
        };
        let r0 = fnv(FNV_OFFSET, &nw.seed.to_le_bytes());
        let mut w = World::new(nw.seed, 0, r0, self.world_hash(nw.seed));
        for (cx, cy) in [(-1, -1), (0, -1), (-1, 0), (0, 0)] {
            let q = Request { cx, cy, commit: 2, supplied: false };
            w.requests.push(q);
            w.unreported.push(q);
        }
        self.world = Some(w);
        self.last_world_call = 1;
        self.report = None;
        self.queries.clear();
        self.subscriptions = 0;
        OK
    }

    fn load(&mut self, len: u32) -> u32 {
        if self.protos.is_none() {
            return self.io.fail(ERR_ORDER, "sim_load before sim_init");
        }
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        let v = match LoadInput::decode_exact(&req) {
            Ok(v) => v,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("load: {e:?}")),
        };
        let mut w = World::new(0, 0, v.r, 0);
        let mut problem: Option<(u32, String)> = None;
        v.sections.for_each(|f| {
            if problem.is_some() {
                return;
            }
            if f.version > 1 {
                problem = Some((ERR_LOAD_FORMAT, format!("section {} at version {}", f.id, f.version)));
            } else if (f.id == 2 || f.id == 11)
                && let Err(e) = w.read(f.id, f.data)
            {
                problem = Some((ERR_LOAD_FORMAT, format!("section {}: {e}", f.id)));
            }
        });
        if let Some((code, msg)) = problem {
            return self.io.fail(code, &msg);
        }
        w.world_hash = self.world_hash(w.seed);
        w.last_extract = w.tick;
        let remapped = !v.remaps.is_empty();
        if remapped {
            w.r = fnv(w.state_hash(), &w.tick.to_le_bytes());
        }
        self.report = Some((remapped, w.r));
        log(0, &format!("stub: loaded tick {} seed {}", w.tick, w.seed));
        self.world = Some(w);
        self.last_world_call = 2;
        self.queries.clear();
        self.subscriptions = 0;
        OK
    }

    fn tick(&mut self, len: u32) -> u32 {
        let Some(closure) = self.io.request(len) else {
            return self.io.fail(ERR_INPUT, "input past the buffer");
        };
        let blobs = std::mem::take(&mut self.blobs);
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(code) => return code,
        };
        let tick = w.tick + 1;
        let has = |h: &[u8; 32]| blobs.contains(h);
        if let Err(e) = schema::preflight(&closure, tick, &w.last_seq, w.last_system_seq, &has) {
            return match e {
                PreflightError::Framing { at, reason } => {
                    self.io.fail(ERR_FRAMING, &format!("preflight at byte {at}: {reason}"))
                }
                PreflightError::BlobMissing { at } => self
                    .io
                    .fail(ERR_BLOB_MISSING, &format!("preflight at byte {at}: a blob was not supplied")),
            };
        }
        let mut commands = Vec::new();
        for a in schema::ClosureIter::new(&closure) {
            if a.system {
                w.last_system_seq = a.seq;
                match Action::decode(a.ty, a.payload) {
                    Ok(Action::PlayerJoined(x)) => {
                        let p = usize::from(x.player.0);
                        if p < PLAYERS {
                            w.present[p] = true;
                            w.online[p] = true;
                        }
                    }
                    Ok(Action::PlayerLeft(x)) => {
                        let p = usize::from(x.player.0);
                        if p < PLAYERS && w.present[p] {
                            w.online[p] = false;
                            w.input_gen[p] = w.input_gen[p].wrapping_add(1);
                        }
                    }
                    Ok(Action::ReleaseInputs(x)) => {
                        let p = usize::from(x.player.0);
                        if p < PLAYERS && w.present[p] {
                            w.input_gen[p] = w.input_gen[p].wrapping_add(1);
                        }
                    }
                    Ok(Action::DebugDump(x)) => commands.push(x.dump_id),
                    _ => {}
                }
            } else {
                let p = usize::from(a.player.0);
                w.last_seq[p] = a.seq;
                w.present[p] = true;
            }
        }
        w.tick = tick;
        w.d = fnv(fnv(FNV_OFFSET, &tick.to_le_bytes()), &closure);
        w.r = fnv(fnv(FNV_OFFSET, &w.r.to_le_bytes()), &w.d.to_le_bytes());
        // Chunks committed at this tick (§5.18): a supplied answer, or generated inline.
        let due: Vec<Request> = w.requests.iter().copied().filter(|q| q.commit == tick).collect();
        w.requests.retain(|q| q.commit != tick);
        for q in due {
            let how = if q.supplied { "supplied" } else { "generated inline" };
            log(0, &format!("stub: chunk {},{} {how} at tick {tick}", q.cx, q.cy));
        }
        for c in commands {
            self.command(c, tick);
        }
        OK
    }

    /// `debug_dump` commands for the shell's tests. The dev panic and the traps end the instance (10 §3.6).
    fn command(&mut self, id: u32, tick: u32) {
        match id {
            DEV_PANIC => panic!("dev panic requested by debug_dump at tick {tick}"),
            CMD_UNREACHABLE => common::trap(),
            CMD_GROW => {
                // Grow linear memory, and move the exported column (both invalidate the shell's views).
                self.ballast.push(vec![0u8; 4 << 20]);
                let moved = self.column.clone();
                self.column = moved;
                self.io.moved();
            }
            CMD_BIG_PACKET => self.big_packet = true,
            _ => log(0, &format!("stub: debug_dump {id} at tick {tick}")),
        }
    }

    fn extract(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else {
            return self.io.fail_env(ERR_INPUT, "input past the buffer");
        };
        let mut r = Reader::new(&req);
        if let Err(e) = ViewRequest::read(&mut r, "ViewRequest").and_then(|_| r.finish("ViewRequest")) {
            return self.io.fail_env(ERR_INPUT, &format!("view: {e:?}"));
        }
        let big = std::mem::take(&mut self.big_packet);
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let mut flags = PacketFlags::EMPTY;
        if !w.extracted {
            flags = flags.union(PacketFlags::FULL);
        }
        if w.tick > w.last_extract + 1 {
            flags = flags.union(PacketFlags::COALESCED);
        }
        w.extracted = true;
        w.last_extract = w.tick;
        let tick = w.tick;
        let mut buf = Vec::new();
        let mut wr = schema::codec::Writer::new(&mut buf);
        let sections = usize::from(big);
        let mut p = PacketBuilder::begin(&mut wr, sections, tick, flags, 65535);
        if big {
            // 600 CHUNK_TILES records (about 607 KiB): more than a 256-KiB packet buffer holds (§15.4).
            if p.section(&mut wr, PacketSection::ChunkTiles).is_err() {
                return self.io.fail_env(ERR_INPUT, "packet");
            }
            for i in 0..600u32 {
                wr.u32(i);
                wr.u16(0);
                wr.u16(0);
                wr.u32(1);
                wr.zeros(1024);
            }
            if p.end(&mut wr, 600).is_err() {
                return self.io.fail_env(ERR_INPUT, "packet");
            }
        }
        if p.finish(&mut wr).is_err() {
            return self.io.fail_env(ERR_INPUT, "packet");
        }
        self.io.envelope(&buf)
    }

    fn save(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else {
            return self.io.fail_env(ERR_INPUT, "input past the buffer");
        };
        let mut r = Reader::new(&req);
        let v = match SaveInput::decode(&mut r).and_then(|v| r.finish("SaveInput").map(|()| v)) {
            Ok(v) => v,
            Err(e) => return self.io.fail_env(ERR_INPUT, &format!("save: {e:?}")),
        };
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let bake = v.flags.contains(schema::SaveFlags::BAKE);
        let lineage = if bake { fnv(w.state_hash(), &w.tick.to_le_bytes()) } else { w.r };
        let mut o = Out(Vec::new());
        let sections = w.sections();
        o.u32(sections.len() as u32);
        for (id, data) in &sections {
            let start = o.0.len();
            o.u32(*id);
            o.u16(1);
            o.u8(0);
            o.u8(1);
            o.u32(data.len() as u32);
            o.u32(data.len() as u32);
            o.bytes(data);
            o.pad(start, 8);
        }
        o.u64(lineage);
        self.io.envelope(&o.0)
    }

    fn meta(&mut self) -> u32 {
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let players: Vec<schema::PlayerMeta> = (0..PLAYERS)
            .filter(|&i| w.present[i])
            .map(|i| schema::PlayerMeta {
                index: schema::PlayerIndex(i as u16),
                online: w.online[i],
                last_seq: schema::Seq(w.last_seq[i]),
                input_gen: w.input_gen[i],
            })
            .collect();
        let m = schema::SimMeta {
            tick: schema::Tick(w.tick),
            seed: w.seed,
            last_system_seq: schema::Seq(w.last_system_seq),
            worldgen_version: 1,
            r: w.r,
            players,
        };
        let mut buf = Vec::new();
        if m.encode(&mut schema::codec::Writer::new(&mut buf)).is_err() {
            return self.io.fail_env(ERR_INPUT, "sim_meta");
        }
        self.io.envelope(&buf)
    }

    fn load_report(&mut self) -> u32 {
        let (true, Some((new_lineage, r))) = (self.last_world_call == 2, self.report) else {
            return self.io.fail_env(ERR_ORDER, "no load");
        };
        let rep = schema::LoadReport { new_lineage, r, removed: Vec::new() };
        let mut buf = Vec::new();
        if rep.encode(&mut schema::codec::Writer::new(&mut buf)).is_err() {
            return self.io.fail_env(ERR_INPUT, "load_report");
        }
        self.io.envelope(&buf)
    }

    fn digest(&mut self) -> u32 {
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let mut o = Out(Vec::new());
        o.u32(w.tick);
        o.u64(w.d);
        o.u64(w.r);
        self.io.envelope(&o.0)
    }

    fn state_hash_bytes(w: &World) -> Vec<u8> {
        let mut o = Out(Vec::new());
        o.u64(w.state_hash());
        let sections = w.sections();
        o.u32(sections.len() as u32);
        for (id, b) in &sections {
            o.u32(*id);
            o.u64(fnv(FNV_OFFSET, b));
        }
        o.0
    }

    fn state_hash(&mut self) -> u32 {
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let b = Self::state_hash_bytes(w);
        self.io.envelope(&b)
    }

    fn subscribe(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        if self.world.is_none() {
            return self.io.fail(ERR_ORDER, "no world");
        }
        let v = match SubscribeInput::decode_exact(&req) {
            Ok(v) => v,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("subscribe: {e:?}")),
        };
        let mut zero = false;
        v.subs.for_each(|s| zero |= s.sub_id.0 == 0);
        if zero {
            return self.io.fail(ERR_INPUT, "sub_id 0 is the hover projection");
        }
        self.subscriptions += v.subs.len();
        OK
    }

    fn unsubscribe(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        if self.world.is_none() {
            return self.io.fail(ERR_ORDER, "no world");
        }
        match UnsubscribeInput::decode_exact(&req) {
            Ok(_) => OK,
            Err(e) => self.io.fail(ERR_INPUT, &format!("unsubscribe: {e:?}")),
        }
    }

    fn query(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        let tick = match self.world_or_order() {
            Ok(w) => w.tick,
            Err(code) => return code,
        };
        let v = match QueryInput::decode_exact(&req) {
            Ok(v) => v,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("query: {e:?}")),
        };
        if self.queries.len() >= 4 {
            return self.io.fail(ERR_LIMIT, "4 queries are running");
        }
        self.queries.push((v.id.0, v.header.kind.value(), tick));
        OK
    }

    fn query_step(&mut self, units: u32) -> u32 {
        let (tick, hash, d, r) = match self.world_or_order() {
            Ok(w) => (w.tick, Self::state_hash_bytes(w), w.d, w.r),
            Err(_) => return 0,
        };
        let n = (units as usize).min(self.queries.len());
        let done: Vec<(u32, u16, u32)> = self.queries.drain(..n).collect();
        let mut o = Out(Vec::new());
        o.u32(done.len() as u32);
        for (id, kind, first) in done {
            let start = o.0.len();
            let body = match kind {
                7 => Some(hash.clone()),
                8 => {
                    let mut b = Out(Vec::new());
                    b.u32(tick);
                    b.u64(d);
                    b.u64(r);
                    Some(b.0)
                }
                _ => None,
            };
            o.u32(id);
            o.u8(u8::from(body.is_some()));
            o.u8(0);
            o.u16(0);
            o.u32(first);
            o.u32(tick);
            let body = body.unwrap_or_else(|| 1u16.to_le_bytes().to_vec());
            o.u32(body.len() as u32);
            o.bytes(&body);
            o.pad(start, 4);
        }
        self.io.envelope(&o.0)
    }

    fn pending_chunks(&mut self) -> u32 {
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(_) => return 0,
        };
        let qs = std::mem::take(&mut w.unreported);
        let mut o = Out(Vec::new());
        o.u32(qs.len() as u32);
        for q in qs {
            o.u16(0);
            o.u16(0);
            o.i32(q.cx);
            o.i32(q.cy);
            o.u32(q.commit);
        }
        self.io.envelope(&o.0)
    }

    fn supply_chunk(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        let mut r = Reader::new(&req);
        let c = match ChunkData::decode(&mut r, true).and_then(|c| r.finish("chunk_data").map(|()| c)) {
            Ok(c) => c,
            Err(e) => return self.io.fail(ERR_INPUT, &format!("chunk_data: {e:?}")),
        };
        let w = match self.world_or_order() {
            Ok(w) => w,
            Err(code) => return code,
        };
        if c.world_hash != w.world_hash {
            log(1, "stub: a chunk of another world: ignored");
            return OK;
        }
        let key = c.key.0;
        match w.requests.iter_mut().find(|q| schema::chunk_key(q.cx, q.cy).0 == key && !q.supplied) {
            Some(q) => {
                q.supplied = true;
                log(0, &format!("stub: chunk {},{} supplied for tick {}", q.cx, q.cy, q.commit));
            }
            None => log(0, &format!("stub: chunk key {key} answers no request: ignored")),
        }
        OK
    }

    fn set_flags(&mut self, flags: u32) -> u32 {
        if flags & !schema::SimFlags::ALL.bits() != 0 {
            return self.io.fail(ERR_INPUT, "undeclared SimFlags bits");
        }
        self.flags = flags;
        OK
    }

    fn blob_put(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else { return self.io.fail(ERR_INPUT, "input past the buffer") };
        if req.len() < 32 {
            return self.io.fail(ERR_INPUT, "BlobPut shorter than its hash");
        }
        let mut h = [0u8; 32];
        h.copy_from_slice(&req[..32]);
        self.blobs.push(h);
        OK
    }

    fn pool_dir(&mut self) -> u32 {
        let mut o = Out(Vec::new());
        o.u32(15);
        o.u32(self.column.as_ptr() as u32);
        o.u32((self.column.len() * 4) as u32);
        self.io.envelope(&o.0)
    }
}

/// The stub behind the generated export shims.
struct StubSim;

impl SimAbi for StubSim {
    fn sim_abi_version() -> u32 {
        schema::ABI_VERSION
    }
    fn sim_schema_hash() -> u32 {
        with(|s| s.io.envelope(&schema::SCHEMA_HASH))
    }
    fn sim_input(len: u32) -> u32 {
        with(|s| s.io.input(len))
    }
    fn sim_init(len: u32) -> u32 {
        with(|s| s.init(len))
    }
    fn sim_new_world(len: u32) -> u32 {
        with(|s| s.new_world(len))
    }
    fn sim_load(len: u32) -> u32 {
        with(|s| s.load(len))
    }
    fn sim_tick(len: u32) -> u32 {
        with(|s| s.tick(len))
    }
    fn sim_set_flags(flags: u32) -> u32 {
        with(|s| s.set_flags(flags))
    }
    fn sim_blob_put(len: u32) -> u32 {
        with(|s| s.blob_put(len))
    }
    fn sim_supply_chunk(len: u32) -> u32 {
        with(|s| s.supply_chunk(len))
    }
    fn sim_pending_chunks() -> u32 {
        with(Stub::pending_chunks)
    }
    fn sim_extract(len: u32) -> u32 {
        with(|s| s.extract(len))
    }
    fn sim_subscribe(len: u32) -> u32 {
        with(|s| s.subscribe(len))
    }
    fn sim_unsubscribe(len: u32) -> u32 {
        with(|s| s.unsubscribe(len))
    }
    fn sim_query(len: u32) -> u32 {
        with(|s| s.query(len))
    }
    fn sim_query_step(units: u32) -> u32 {
        with(|s| s.query_step(units))
    }
    fn sim_query_cancel(id: u32) -> u32 {
        with(|s| {
            s.queries.retain(|q| q.0 != id);
            OK
        })
    }
    fn sim_digest() -> u32 {
        with(Stub::digest)
    }
    fn sim_state_hash() -> u32 {
        with(Stub::state_hash)
    }
    fn sim_save(len: u32) -> u32 {
        with(|s| s.save(len))
    }
    fn sim_meta() -> u32 {
        with(Stub::meta)
    }
    fn sim_load_report() -> u32 {
        with(Stub::load_report)
    }
    fn sim_last_error() -> u32 {
        with(|s| s.io.last_error())
    }
    fn sim_memory_epoch() -> u32 {
        with(|s| s.io.epoch)
    }
    fn sim_pool_dir() -> u32 {
        with(Stub::pool_dir)
    }
    fn sim_allocs() -> u32 {
        with(|s| s.io.fail(ERR_ORDER, "the stub has no counting allocator (simcheck)"))
    }
}

schema::export_sim_abi!(StubSim);
