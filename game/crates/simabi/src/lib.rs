//! `sim.wasm`: the C ABI of 10 §15.8 over `sim::SimContext`, written through the generated `export_sim_abi!`
//! (schema/abi.yaml), so an export that is missing or mistyped does not compile.
//!
//! - **Inputs**: `sim_input(len)` hands out the input buffer (0 when memory cannot grow); the shell writes the
//!   request there and passes its length to the export that reads it.
//! - **Envelopes**: an envelope export returns an 8-byte-aligned pointer to `{u32 len, bytes}` in the output
//!   arena, or 0 with the error in `sim_last_error` (its own small buffer: `u32 code`, then a UTF-8 message).
//! - **`sim_memory_epoch`** rises whenever the input buffer or the output arena moves (§3.6).
//! - **The panic hook** passes a panic's message, file and line to `host_panic` before the module aborts (§3.6).
//!
//! C2b scope: the world, tick, save and digest exports. Extraction, subscriptions, queries, the pool directory
//! and the allocation counter arrive with C2c; until then they fail with `ERR_ORDER` and say so.
//!
//! **Feature `full-abi`** (default since the Shell package's loaders landed, C3-r1). The table above is
//! exported only with it. Without it the module is the M0 scaffold (one export, `sim_abi_version` = 0, no
//! imports), which the shell's handshake refuses; the implementation is compiled (and linted) either way.

use schema::abi::SimAbi;
use schema::{SimFlags, SimStatus};
use sim::{SimContext, SimError, SimResult};
use std::cell::RefCell;

/// The module's state: the sim context and the buffers that cross the boundary.
#[derive(Default)]
struct Module {
    ctx: SimContext,
    input: Vec<u8>,
    out: Vec<u8>,
    /// The last error's envelope, at offset `err_at` (8-byte aligned).
    err: Vec<u8>,
    err_at: usize,
    epoch: u32,
    /// Where the input buffer and the arena were when the shell last saw them.
    seen: (usize, usize),
}

thread_local! {
    // One instance per worker and no threads (D19): a thread-local is the module's static state.
    static MODULE: RefCell<Module> = RefCell::new(Module::default());
}

fn with<R>(f: impl FnOnce(&mut Module) -> R) -> R {
    MODULE.with(|m| {
        let mut m = m.borrow_mut();
        let r = f(&mut m);
        m.note_moves();
        r
    })
}

fn not_yet(what: &str) -> SimError {
    SimError::new(SimStatus::ErrOrder, format!("{what} arrives with the Sim package's phase C2c"))
}

impl Module {
    /// Raises the memory epoch when the input buffer or the arena moved (§3.6, §15.8).
    fn note_moves(&mut self) {
        let now = (self.input.as_ptr() as usize, self.out.as_ptr() as usize);
        if now != self.seen {
            self.seen = now;
            self.epoch = self.epoch.wrapping_add(1);
        }
    }

    /// The error envelope (abi.yaml `ErrorEnvelope`): `u32 len`, then `u32 code` and the UTF-8 message.
    fn set_error(&mut self, e: &SimError) {
        let msg = e.message.as_bytes();
        self.err.clear();
        if self.err.try_reserve(msg.len() + 16).is_err() {
            return;
        }
        let pad = (8 - self.err.as_ptr() as usize % 8) % 8;
        self.err.resize(pad, 0);
        self.err.extend_from_slice(&((msg.len() + 4) as u32).to_le_bytes());
        self.err.extend_from_slice(&e.status.value().to_le_bytes());
        self.err.extend_from_slice(msg);
        self.err_at = pad;
    }

    /// The request the shell wrote into the input buffer.
    fn request(&self, len: u32) -> SimResult<Vec<u8>> {
        self.input
            .get(..len as usize)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| SimError::new(SimStatus::ErrInput, "the request is longer than the input buffer"))
    }

    fn status(&mut self, r: SimResult<()>) -> u32 {
        match r {
            Ok(()) => SimStatus::Ok.value(),
            Err(e) => {
                self.set_error(&e);
                e.status.value()
            }
        }
    }

    /// Writes `{u32 len, bytes}` at an 8-byte-aligned address of the arena and returns that address.
    fn envelope(&mut self, r: SimResult<Vec<u8>>) -> u32 {
        match r {
            Ok(bytes) => {
                self.out.clear();
                let need = bytes.len() + 4 + 8;
                if self.out.capacity() < need && self.out.try_reserve_exact(need).is_err() {
                    self.set_error(&SimError::new(SimStatus::ErrLimit, "the output arena cannot grow"));
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
    /// Native builds (tests link the crate) report panics the usual way.
    pub fn install_panic_hook() {}
}

/// The `SimAbi` implementation.
pub struct Abi;

impl SimAbi for Abi {
    fn sim_abi_version() -> u32 {
        schema::ABI_VERSION
    }

    fn sim_schema_hash() -> u32 {
        with(|m| m.envelope(Ok(schema::SCHEMA_HASH.to_vec())))
    }

    fn sim_input(len: u32) -> u32 {
        with(|m| {
            m.input.clear();
            if m.input.try_reserve_exact(len as usize).is_err() {
                return 0;
            }
            m.input.resize(len as usize, 0);
            m.input.as_mut_ptr() as u32
        })
    }

    fn sim_init(len: u32) -> u32 {
        host::install_panic_hook();
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.init(&req));
            m.status(r)
        })
    }

    fn sim_new_world(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.new_world(&req));
            m.status(r)
        })
    }

    fn sim_load(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.load(&req));
            m.status(r)
        })
    }

    fn sim_tick(len: u32) -> u32 {
        with(|m| {
            let Module { ctx, input, .. } = m;
            let r = match input.get(..len as usize) {
                Some(closure) => ctx.tick(closure),
                None => {
                    Err(SimError::new(SimStatus::ErrInput, "the closure is longer than the input buffer"))
                }
            };
            m.status(r)
        })
    }

    fn sim_set_flags(flags: u32) -> u32 {
        with(|m| {
            let r = m.ctx.set_flags(flags);
            m.status(r)
        })
    }

    fn sim_blob_put(len: u32) -> u32 {
        with(|m| {
            let Module { ctx, input, .. } = m;
            let r = match input.get(..len as usize) {
                Some(b) => ctx.blob_put(b),
                None => Err(SimError::new(SimStatus::ErrInput, "the blob is longer than the input buffer")),
            };
            m.status(r)
        })
    }

    fn sim_supply_chunk(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.supply_chunk(&req));
            m.status(r)
        })
    }

    fn sim_pending_chunks() -> u32 {
        with(|m| {
            let r = m.ctx.pending_chunks();
            m.envelope(r)
        })
    }

    fn sim_extract(_len: u32) -> u32 {
        with(|m| m.envelope(Err(not_yet("sim_extract"))))
    }

    fn sim_subscribe(_len: u32) -> u32 {
        with(|m| m.status(Err(not_yet("sim_subscribe"))))
    }

    fn sim_unsubscribe(_len: u32) -> u32 {
        with(|m| m.status(Err(not_yet("sim_unsubscribe"))))
    }

    fn sim_query(_len: u32) -> u32 {
        with(|m| m.status(Err(not_yet("sim_query"))))
    }

    fn sim_query_step(_units: u32) -> u32 {
        with(|m| m.envelope(Err(not_yet("sim_query_step"))))
    }

    fn sim_query_cancel(_id: u32) -> u32 {
        with(|m| m.status(Err(not_yet("sim_query_cancel"))))
    }

    fn sim_digest() -> u32 {
        with(|m| {
            let r = m.ctx.digest();
            m.envelope(r)
        })
    }

    fn sim_state_hash() -> u32 {
        with(|m| {
            let r = m.ctx.state_hash();
            m.envelope(r)
        })
    }

    fn sim_save(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.save(&req));
            m.envelope(r)
        })
    }

    fn sim_meta() -> u32 {
        with(|m| {
            let r = m.ctx.meta();
            m.envelope(r)
        })
    }

    fn sim_load_report() -> u32 {
        with(|m| {
            let r = m.ctx.load_report();
            m.envelope(r)
        })
    }

    fn sim_last_error() -> u32 {
        // §15.8: never moves memory, and the error envelope lives in its own buffer.
        MODULE.with(|m| {
            let m = m.borrow();
            if m.err.is_empty() { 0 } else { (m.err.as_ptr() as usize + m.err_at) as u32 }
        })
    }

    fn sim_memory_epoch() -> u32 {
        MODULE.with(|m| m.borrow().epoch)
    }

    fn sim_pool_dir() -> u32 {
        with(|m| m.envelope(Err(not_yet("sim_pool_dir"))))
    }

    fn sim_allocs() -> u32 {
        with(|m| m.envelope(Err(not_yet("sim_allocs"))))
    }
}

#[cfg(feature = "full-abi")]
schema::export_sim_abi!(Abi);

/// The M0 scaffold's one export (see the module documentation).
#[cfg(not(feature = "full-abi"))]
#[unsafe(no_mangle)]
pub extern "C" fn sim_abi_version() -> u32 {
    0
}

/// The flags `sim_init` accepts, for the shell's own checks.
pub const KNOWN_FLAGS: u32 = SimFlags::ALL.bits();
