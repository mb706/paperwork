//! `gen.wasm`: the worldgen workers' ABI over the `worldgen` crate (10 §15.9), written through the generated
//! `export_gen_abi!` (schema/abi.yaml), with §15.8's calling convention:
//!
//! - `gen_input(len)` hands out the input buffer (0 when memory cannot grow);
//! - an envelope export returns an 8-byte-aligned pointer to `{u32 len, bytes}`, or 0 with the error in
//!   `gen_last_error` (`u32 code`, then a UTF-8 message);
//! - `gen_init` loads `prototypes.bin` and one `new_world` record and answers the world hash; `gen_chunk`
//!   generates a chunk (`chunk_data`, the record the sim's inline generation makes too); `gen_chart` draws a
//!   pristine chunk's 32 × 32 chart image (tile map colours); `gen_preview` samples tiles over a rectangle;
//! - the panic hook passes a panic's message to `host_panic` before the module aborts (§3.6).
//!
//! **Feature `full-abi`**, as in `simabi`: without it the module is the M0 scaffold (`gen_abi_version` = 0, no
//! imports) until the Shell package's loaders land; the WebAssembly tests build with it.

use schema::abi::GenAbi;
use schema::codec::{Fixed, Packed, Writer};
use schema::{
    ChartChunk, ChunkKey, GenInitInput, GenInitOutput, PreviewFlags, PreviewImage, PreviewRequest, Protos,
    SimStatus, SurfaceIndex, chunk_key,
};
use std::cell::RefCell;

/// The module's state: the generator `gen_init` built and the buffers that cross the boundary.
#[derive(Default)]
struct Module {
    protos: Option<Protos>,
    generator: Option<worldgen::Generator>,
    input: Vec<u8>,
    out: Vec<u8>,
    err: Vec<u8>,
    err_at: usize,
}

thread_local! {
    static MODULE: RefCell<Module> = RefCell::new(Module::default());
}

fn with<R>(f: impl FnOnce(&mut Module) -> R) -> R {
    MODULE.with(|m| f(&mut m.borrow_mut()))
}

/// A refused call: the status and the message `gen_last_error` returns.
struct GenError(SimStatus, String);

type GenResult<T> = Result<T, GenError>;

fn input_err(m: impl Into<String>) -> GenError {
    GenError(SimStatus::ErrInput, m.into())
}

impl Module {
    fn set_error(&mut self, e: &GenError) {
        let msg = e.1.as_bytes();
        self.err.clear();
        if self.err.try_reserve(msg.len() + 16).is_err() {
            return;
        }
        let pad = (8 - self.err.as_ptr() as usize % 8) % 8;
        self.err.resize(pad, 0);
        self.err.extend_from_slice(&((msg.len() + 4) as u32).to_le_bytes());
        self.err.extend_from_slice(&e.0.value().to_le_bytes());
        self.err.extend_from_slice(msg);
        self.err_at = pad;
    }

    fn envelope(&mut self, r: GenResult<Vec<u8>>) -> u32 {
        match r {
            Ok(bytes) => {
                self.out.clear();
                let need = bytes.len() + 4 + 8;
                if self.out.capacity() < need && self.out.try_reserve_exact(need).is_err() {
                    self.set_error(&GenError(SimStatus::ErrLimit, "the output arena cannot grow".to_owned()));
                    return 0;
                }
                let pad = (8 - self.out.as_ptr() as usize % 8) % 8;
                self.out.resize(pad, 0);
                self.out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                self.out.extend_from_slice(&bytes);
                (self.out.as_ptr() as usize + pad) as u32
            }
            Err(e) => {
                self.set_error(&e);
                0
            }
        }
    }

    fn request(&self, len: u32) -> GenResult<&[u8]> {
        self.input.get(..len as usize).ok_or_else(|| input_err("the request is longer than the input buffer"))
    }

    fn generator(&self) -> GenResult<&worldgen::Generator> {
        self.generator
            .as_ref()
            .ok_or_else(|| GenError(SimStatus::ErrOrder, "gen_init has not run".to_owned()))
    }

    /// `gen_init` (§15.9): `prototypes.bin` and one `new_world` record; the world hash.
    fn init(&mut self, len: u32) -> GenResult<Vec<u8>> {
        let req = self.request(len)?.to_vec();
        let v = GenInitInput::decode_exact(&req).map_err(|e| input_err(format!("GenInitInput: {e}")))?;
        let protos = Protos::load(v.protos)
            .map_err(|e| GenError(SimStatus::ErrProtos, format!("prototypes.bin: {e}")))?;
        let w = &v.world;
        worldgen::check_settings(&w.map, &protos).map_err(|e| input_err(format!("new_world: {e}")))?;
        let hash = worldgen::world_hash(v.protos, w.seed, &w.map, &w.world);
        self.generator = Some(worldgen::Generator::new(&protos, w.seed, &w.map, &w.world, hash));
        self.protos = Some(protos);
        let mut out = Vec::new();
        GenInitOutput { world_hash: hash }
            .encode(&mut Writer::new(&mut out))
            .map_err(|e| input_err(e.to_string()))?;
        Ok(out)
    }

    /// `gen_chunk` (§15.9): the `chunk_data` record of chunk `(cx, cy)`.
    fn chunk(&self, surface: u32, cx: i32, cy: i32) -> GenResult<Vec<u8>> {
        let surface = chunk_surface(surface, cx, cy)?;
        let d = self.generator()?.chunk(surface, cx, cy);
        let mut out = Vec::new();
        d.encode(&mut Writer::new(&mut out)).map_err(|e| input_err(e.to_string()))?;
        Ok(out)
    }

    /// The RGBA of a tile's map colour (prototypes `map_color`, 0xRRGGBB).
    fn colour(&self, t: schema::TileId) -> [u8; 4] {
        let c =
            self.protos.as_ref().and_then(|p| p.tile.map_color.get(usize::from(t.0)).copied()).unwrap_or(0);
        [(c >> 16) as u8, (c >> 8) as u8, c as u8, 255]
    }

    /// `gen_chart` (§15.9, §5.19): a pristine chunk's 32 × 32 chart image, row-major, version 0.
    fn chart(&self, surface: u32, cx: i32, cy: i32) -> GenResult<Vec<u8>> {
        let s = chunk_surface(surface, cx, cy)?;
        let g = self.generator()?;
        let (theta, _) = g.climate(cx, cy);
        let mut rgba = [0u8; 4096];
        for ly in 0..32 {
            for lx in 0..32 {
                let (t, _) = g.tile(cx * 32 + lx, cy * 32 + ly, theta);
                let i = 4 * (ly * 32 + lx) as usize;
                rgba[i..i + 4].copy_from_slice(&self.colour(t));
            }
        }
        let c = ChartChunk { chunk_key: chunk_key(cx, cy), surface: s, version: 0, rgba };
        let mut out = Vec::new();
        c.write(&mut Writer::new(&mut out), "ChartChunk").map_err(|e| input_err(e.to_string()))?;
        Ok(out)
    }

    /// `gen_preview` (§5.18): one sample every `step` tiles over `width × height` samples from `(x0, y0)`:
    /// the tile's map colour, or with `ambient` the chunk's θ from blue (−15 °C) to red (35 °C).
    fn preview(&self, len: u32) -> GenResult<Vec<u8>> {
        let mut r = schema::codec::Reader::new(self.request(len)?);
        let q = PreviewRequest::read(&mut r, "PreviewRequest")
            .map_err(|e| input_err(format!("PreviewRequest: {e}")))?;
        r.finish("PreviewRequest").map_err(|e| input_err(format!("PreviewRequest: {e}")))?;
        let g = self.generator()?;
        let n = q.width as usize * q.height as usize;
        let mut rgba = Vec::new();
        rgba.try_reserve_exact(4 * n)
            .map_err(|_| GenError(SimStatus::ErrLimit, "the preview is too large".to_owned()))?;
        let at = |base: i32, k: u32| -> i32 {
            let v = i64::from(base) + i64::from(k) * i64::from(q.step);
            v.clamp(-(1 << 30), 1 << 30) as i32
        };
        for j in 0..q.height {
            for i in 0..q.width {
                let (tx, ty) = (at(q.x0, i), at(q.y0, j));
                let (cx, cy) = (tx.div_euclid(32), ty.div_euclid(32));
                let (theta, _) = g.climate(cx, cy);
                if q.flags.contains(PreviewFlags::AMBIENT) {
                    let f = (theta + 15.0) / 50.0;
                    #[allow(clippy::manual_clamp)] // f64::clamp is banned (10 §4.1): comparisons
                    let f = if f < 0.0 {
                        0.0
                    } else if f > 1.0 {
                        1.0
                    } else {
                        f
                    };
                    rgba.extend_from_slice(&[(255.0 * f) as u8, 64, (255.0 * (1.0 - f)) as u8, 255]);
                } else {
                    let (t, _) = g.tile(tx, ty, theta);
                    rgba.extend_from_slice(&self.colour(t));
                }
            }
        }
        let mut out = Vec::new();
        PreviewImage { width: q.width, height: q.height, rgba: &rgba }
            .encode(&mut Writer::new(&mut out))
            .map_err(|e| input_err(e.to_string()))?;
        Ok(out)
    }
}

/// A chunk request's surface and coordinates: surface 0–65,535 and chunk coordinates in the key range (§4.4).
fn chunk_surface(surface: u32, cx: i32, cy: i32) -> GenResult<SurfaceIndex> {
    let s = u16::try_from(surface).map_err(|_| input_err(format!("surface {surface}")))?;
    if !(-32_768..32_768).contains(&cx) || !(-32_768..32_768).contains(&cy) {
        return Err(input_err(format!("chunk ({cx}, {cy}) outside the key range")));
    }
    let _: ChunkKey = chunk_key(cx, cy);
    Ok(SurfaceIndex(s))
}

#[cfg(all(target_arch = "wasm32", feature = "full-abi"))]
mod host {
    #[link(wasm_import_module = "env")]
    unsafe extern "C" {
        fn host_panic(ptr: u32, len: u32);
    }

    /// §3.6: the message, file and line go to the host before the abort.
    pub fn install_panic_hook() {
        std::panic::set_hook(Box::new(|info| {
            let msg = info.to_string();
            // SAFETY: the host reads `len` bytes at `ptr` during the call; the string outlives it.
            unsafe { host_panic(msg.as_ptr() as u32, msg.len() as u32) };
        }));
    }
}

#[cfg(not(all(target_arch = "wasm32", feature = "full-abi")))]
mod host {
    pub fn install_panic_hook() {}
}

/// The `GenAbi` implementation.
pub struct Gen;

impl GenAbi for Gen {
    fn gen_abi_version() -> u32 {
        schema::GEN_ABI_VERSION
    }

    fn gen_schema_hash() -> u32 {
        with(|m| m.envelope(Ok(schema::SCHEMA_HASH.to_vec())))
    }

    fn gen_input(len: u32) -> u32 {
        with(|m| {
            m.input.clear();
            if m.input.try_reserve_exact(len as usize).is_err() {
                return 0;
            }
            m.input.resize(len as usize, 0);
            m.input.as_mut_ptr() as u32
        })
    }

    fn gen_last_error() -> u32 {
        MODULE.with(|m| {
            let m = m.borrow();
            if m.err.is_empty() { 0 } else { (m.err.as_ptr() as usize + m.err_at) as u32 }
        })
    }

    fn gen_init(len: u32) -> u32 {
        host::install_panic_hook();
        with(|m| {
            let r = m.init(len);
            m.envelope(r)
        })
    }

    fn gen_chunk(surface: u32, cx: i32, cy: i32) -> u32 {
        with(|m| {
            let r = m.chunk(surface, cx, cy);
            m.envelope(r)
        })
    }

    fn gen_chart(surface: u32, cx: i32, cy: i32) -> u32 {
        with(|m| {
            let r = m.chart(surface, cx, cy);
            m.envelope(r)
        })
    }

    fn gen_preview(len: u32) -> u32 {
        with(|m| {
            let r = m.preview(len);
            m.envelope(r)
        })
    }
}

#[cfg(feature = "full-abi")]
schema::export_gen_abi!(Gen);

/// The M0 scaffold's one export (see the module documentation).
#[cfg(not(feature = "full-abi"))]
#[unsafe(no_mangle)]
pub extern "C" fn gen_abi_version() -> u32 {
    0
}
