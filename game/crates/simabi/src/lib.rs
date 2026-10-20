//! `sim.wasm`: the C ABI of 10 §15.8 over `sim::SimContext`, written through the generated `export_sim_abi!`
//! (schema/abi.yaml), so an export that is missing or mistyped does not compile.
//!
//! - **Inputs**: `sim_input(len)` hands out the input buffer (0 when memory cannot grow); the shell writes the
//!   request there and passes its length to the export that reads it.
//! - **Envelopes**: an envelope export returns an 8-byte-aligned pointer to `{u32 len, bytes}` in the output
//!   arena, or 0 with the error in `sim_last_error` (its own small buffer: `u32 code`, then a UTF-8 message).
//! - **`sim_memory_epoch`** rises whenever the input buffer, the output arena or an exported pool column moves or
//!   changes length (§3.6, §15.8), so the shell reacquires its views.
//! - **The panic hook** passes a panic's message, file and line to `host_panic` before the module aborts (§3.6).
//! - **`sim_allocs`**: with `simcheck`, the module's global allocator counts allocations, deallocations, live and
//!   peak bytes (§2.5); without it the export is `ERR_ORDER`.
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
    /// What an export writes before it becomes the arena's envelope (reused: the steady state allocates
    /// nothing, §2.5).
    scratch: Vec<u8>,
    /// The last error's envelope, at offset `err_at` (8-byte aligned).
    err: Vec<u8>,
    err_at: usize,
    epoch: u32,
    /// Where the input buffer, the arena and the pool columns were when the shell last saw them.
    seen: (usize, usize, u64),
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

impl Module {
    /// Raises the memory epoch when the input buffer, the arena or a pool column moved (§3.6, §15.8).
    fn note_moves(&mut self) {
        let now = (self.input.as_ptr() as usize, self.out.as_ptr() as usize, self.ctx.column_fingerprint());
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
            Ok(bytes) => self.put(&bytes),
            Err(e) => {
                self.set_error(&e);
                0
            }
        }
    }

    /// [`Self::envelope`] of what the export wrote into `scratch`.
    fn scratch_envelope(&mut self, r: SimResult<()>) -> u32 {
        match r {
            Ok(()) => {
                let bytes = std::mem::take(&mut self.scratch);
                let at = self.put(&bytes);
                self.scratch = bytes;
                at
            }
            Err(e) => {
                self.set_error(&e);
                0
            }
        }
    }

    /// Copies `bytes` into the arena as an envelope; 0 (`ERR_LIMIT`) when the arena cannot grow.
    fn put(&mut self, bytes: &[u8]) -> u32 {
        self.out.clear();
        let need = bytes.len() + 4 + 8;
        if self.out.capacity() < need && self.out.try_reserve_exact(need).is_err() {
            self.set_error(&SimError::new(SimStatus::ErrLimit, "the output arena cannot grow"));
            return 0;
        }
        let pad = (8 - self.out.as_ptr() as usize % 8) % 8;
        self.out.resize(pad, 0);
        self.out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        self.out.extend_from_slice(bytes);
        (self.out.as_ptr() as usize + pad) as u32
    }
}

/// The module's linear memory in bytes (`DEBUG.memory_bytes`).
#[cfg(target_arch = "wasm32")]
fn memory_bytes() -> u32 {
    (core::arch::wasm32::memory_size(0) as u32).wrapping_mul(65_536)
}

#[cfg(not(target_arch = "wasm32"))]
fn memory_bytes() -> u32 {
    0
}

/// The counting allocator (§2.5, `sim_allocs`): `simcheck` builds of the module count every allocation.
#[cfg(feature = "simcheck")]
mod counting {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::sync::atomic::{AtomicU64, Ordering};

    pub static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
    pub static DEALLOCATIONS: AtomicU64 = AtomicU64::new(0);
    pub static LIVE: AtomicU64 = AtomicU64::new(0);
    pub static PEAK: AtomicU64 = AtomicU64::new(0);

    pub struct Counting;

    fn grew(n: u64) {
        let live = LIVE.fetch_add(n, Ordering::Relaxed) + n;
        if live > PEAK.load(Ordering::Relaxed) {
            PEAK.store(live, Ordering::Relaxed);
        }
    }

    // SAFETY: every call forwards to the system allocator unchanged; the counters are atomics that never
    // allocate.
    unsafe impl GlobalAlloc for Counting {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            grew(l.size() as u64);
            // SAFETY: the caller's contract is System's.
            unsafe { System.alloc(l) }
        }

        unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
            DEALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            LIVE.fetch_sub(l.size() as u64, Ordering::Relaxed);
            // SAFETY: as above.
            unsafe { System.dealloc(p, l) }
        }

        unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            DEALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            LIVE.fetch_sub(l.size() as u64, Ordering::Relaxed);
            grew(n as u64);
            // SAFETY: as above.
            unsafe { System.realloc(p, l, n) }
        }
    }

    #[global_allocator]
    static A: Counting = Counting;

    /// `AllocStats`' bytes, appended to `out` (read first, so that a growing `out` is not counted).
    pub fn stats_into(out: &mut Vec<u8>) {
        let v = [&ALLOCATIONS, &DEALLOCATIONS, &LIVE, &PEAK].map(|v| v.load(Ordering::Relaxed));
        for x in v {
            out.extend_from_slice(&x.to_le_bytes());
        }
    }
}

#[cfg(all(target_arch = "wasm32", feature = "full-abi"))]
mod host {
    #[link(wasm_import_module = "env")]
    unsafe extern "C" {
        fn host_panic(ptr: u32, len: u32);
        #[cfg(feature = "simcheck")]
        fn host_now() -> f64;
    }

    /// The host's clock in ms (`performance.now()`), for `PROFILE` in dev builds (§15.8).
    #[cfg(feature = "simcheck")]
    pub fn now() -> f64 {
        // SAFETY: an import without arguments or memory access.
        unsafe { host_now() }
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

    /// Native builds have no host clock here (simtool sets its own).
    #[cfg(feature = "simcheck")]
    pub fn now() -> f64 {
        0.0
    }
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
            m.ctx.set_memory_probe(memory_bytes);
            // PROFILE is for dev builds (§15.8): only they read the host's clock (D13, D15).
            #[cfg(feature = "simcheck")]
            m.ctx.set_clock(host::now);
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
            m.scratch.clear();
            let r = m.ctx.pending_chunks_into(&mut m.scratch);
            m.scratch_envelope(r)
        })
    }

    fn sim_extract(len: u32) -> u32 {
        with(|m| {
            let Module { ctx, input, scratch, .. } = m;
            scratch.clear();
            let r = match input.get(..len as usize) {
                Some(view) => ctx.extract_into(view, scratch),
                None => {
                    Err(SimError::new(SimStatus::ErrInput, "the request is longer than the input buffer"))
                }
            };
            m.scratch_envelope(r)
        })
    }

    fn sim_subscribe(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.subscribe(&req));
            m.status(r)
        })
    }

    fn sim_unsubscribe(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.unsubscribe(&req));
            m.status(r)
        })
    }

    fn sim_query(len: u32) -> u32 {
        with(|m| {
            let r = m.request(len).and_then(|req| m.ctx.query(&req));
            m.status(r)
        })
    }

    fn sim_query_step(units: u32) -> u32 {
        with(|m| {
            let r = m.ctx.query_step(units);
            m.envelope(r)
        })
    }

    fn sim_query_cancel(id: u32) -> u32 {
        with(|m| {
            let r = m.ctx.query_cancel(id);
            m.status(r)
        })
    }

    fn sim_digest() -> u32 {
        with(|m| {
            m.scratch.clear();
            let r = m.ctx.digest_into(&mut m.scratch);
            m.scratch_envelope(r)
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
        with(|m| {
            let r = m.ctx.pool_dir();
            m.envelope(r)
        })
    }

    fn sim_allocs() -> u32 {
        with(|m| {
            m.scratch.clear();
            #[cfg(feature = "simcheck")]
            let r: SimResult<()> = {
                counting::stats_into(&mut m.scratch);
                Ok(())
            };
            #[cfg(not(feature = "simcheck"))]
            let r: SimResult<()> =
                Err(SimError::new(SimStatus::ErrOrder, "sim_allocs needs a build with simcheck (§2.5)"));
            m.scratch_envelope(r)
        })
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
