//! A stub `gen.wasm` (C3's test fixture, pm/wp/C3-shell.md): the generated [`schema::GenAbi`] (10 §15.9)
//! implemented trivially, with the export shims of `schema::export_gen_abi!`, for the worldgen pool's tests.
//! `gen_init` checks its input and answers the world hash as the stub sim computes it (FNV-1a 64 of the seed and
//! `prototypes.bin`); `gen_chunk` answers a `chunk_data` record whose tiles follow a pattern of (cx, cy), so a
//! test can tell which worker generated what; `gen_chart` and `gen_preview` answer records of the right shape.

#[allow(dead_code)]
#[path = "../../common.rs"]
mod common;

use common::{ERR_INPUT, ERR_ORDER, FNV_OFFSET, Io, Out, fnv, log};
use schema::codec::{Fixed, Reader};
use schema::{ChunkData, GenAbi, GenInitInput, PreviewRequest, SurfaceIndex, TileId};
use std::cell::RefCell;

#[derive(Default)]
struct Stub {
    io: Io,
    world_hash: Option<u64>,
}

thread_local! {
    static STUB: RefCell<Stub> = RefCell::new(Stub::default());
}

fn with<T>(f: impl FnOnce(&mut Stub) -> T) -> T {
    STUB.with(|s| f(&mut s.borrow_mut()))
}

impl Stub {
    fn init(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else {
            return self.io.fail_env(ERR_INPUT, "input past the buffer");
        };
        let v = match GenInitInput::decode_exact(&req) {
            Ok(v) => v,
            Err(e) => return self.io.fail_env(ERR_INPUT, &format!("gen_init: {e:?}")),
        };
        common::install_panic_hook();
        let h = fnv(fnv(FNV_OFFSET, &v.world.seed.to_le_bytes()), v.protos);
        self.world_hash = Some(h);
        log(0, &format!("stub gen: init, seed {}", v.world.seed));
        let mut o = Out(Vec::new());
        o.u64(h);
        self.io.envelope(&o.0)
    }

    fn chunk(&mut self, surface: u32, cx: i32, cy: i32) -> u32 {
        let Some(world_hash) = self.world_hash else {
            return self.io.fail_env(ERR_ORDER, "gen_chunk before gen_init");
        };
        let mut c = ChunkData {
            world_hash,
            surface: SurfaceIndex(surface as u16),
            key: schema::chunk_key(cx, cy),
            theta: 14.0,
            sunlight: 1.0,
            decor_seed: (cx.wrapping_mul(31) ^ cy) as u32,
            ..ChunkData::default()
        };
        for (i, t) in c.tiles.iter_mut().enumerate() {
            *t = TileId(((i as i32 + cx * 7 + cy * 3).rem_euclid(4)) as u8);
        }
        let mut buf = Vec::new();
        if c.encode(&mut schema::codec::Writer::new(&mut buf)).is_err() {
            return self.io.fail_env(ERR_INPUT, "chunk_data");
        }
        self.io.envelope(&buf)
    }

    fn chart(&mut self, surface: u32, cx: i32, cy: i32) -> u32 {
        if self.world_hash.is_none() {
            return self.io.fail_env(ERR_ORDER, "gen_chart before gen_init");
        }
        let mut o = Out(Vec::new());
        o.u32(schema::chunk_key(cx, cy).0);
        o.u16(surface as u16);
        o.u16(0);
        o.u32(1);
        for i in 0..1024u32 {
            o.bytes(&[(i & 0xff) as u8, (cx & 0xff) as u8, (cy & 0xff) as u8, 255]);
        }
        self.io.envelope(&o.0)
    }

    fn preview(&mut self, len: u32) -> u32 {
        let Some(req) = self.io.request(len) else {
            return self.io.fail_env(ERR_INPUT, "input past the buffer");
        };
        let mut r = Reader::new(&req);
        let v = match PreviewRequest::read(&mut r, "PreviewRequest")
            .and_then(|v| r.finish("PreviewRequest").map(|()| v))
        {
            Ok(v) => v,
            Err(e) => return self.io.fail_env(ERR_INPUT, &format!("gen_preview: {e:?}")),
        };
        if self.world_hash.is_none() {
            return self.io.fail_env(ERR_ORDER, "gen_preview before gen_init");
        }
        let mut o = Out(Vec::new());
        o.u32(v.width);
        o.u32(v.height);
        o.bytes(&vec![128u8; (v.width * v.height * 4) as usize]);
        self.io.envelope(&o.0)
    }
}

struct StubGen;

impl GenAbi for StubGen {
    fn gen_abi_version() -> u32 {
        schema::GEN_ABI_VERSION
    }
    fn gen_schema_hash() -> u32 {
        with(|s| s.io.envelope(&schema::SCHEMA_HASH))
    }
    fn gen_input(len: u32) -> u32 {
        with(|s| s.io.input(len))
    }
    fn gen_last_error() -> u32 {
        with(|s| s.io.last_error())
    }
    fn gen_init(len: u32) -> u32 {
        with(|s| s.init(len))
    }
    fn gen_chunk(surface: u32, cx: i32, cy: i32) -> u32 {
        with(|s| s.chunk(surface, cx, cy))
    }
    fn gen_chart(surface: u32, cx: i32, cy: i32) -> u32 {
        with(|s| s.chart(surface, cx, cy))
    }
    fn gen_preview(len: u32) -> u32 {
        with(|s| s.preview(len))
    }
}

schema::export_gen_abi!(StubGen);
